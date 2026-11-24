// 収集済み Markdown を チャンク分割 → Workers AI で埋め込み → Vectorize へ upsert する。
//
// ⚠️ 未検証：このスクリプトは Cloudflare REST API のシェイプに基づく雛形。
//    実行には環境変数 CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN（Workers AI + Vectorize 権限）が必要。
//    初回は少数ファイルで挙動を確認し、APIのレスポンス形に合わせて調整すること。
//
// 実行：CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node tools/crawler/upsert.mjs
//
// 差分反映：反映済みの文書ごとの内容ハッシュを RAG_STATE（既定 .cache/rag-state.json）に記録し、
// 前回から変わっていない文書は埋め込み・upsert を省く。記録が無い（初回・キャッシュ消失）ときは全件。
// 全件やり直したいとき：RAG_FULL=1（Actions では upsert.yml の手動実行で full にチェック）。
// チャンク分割やメタデータの作りを変えたら STATE_VERSION を上げる（全件が再反映される）。

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const INDEX = process.env.VECTORIZE_INDEX || 'readybridge-rag';
const EMBED_MODEL = '@cf/baai/bge-m3';
const OUT_DIR = path.join(process.cwd(), 'data/collected');
const CHUNK_CHARS = 800;
const CHUNK_OVERLAP = 120;
const STATE_VERSION = 1;
const STATE_FILE = process.env.RAG_STATE || path.join(process.cwd(), '.cache/rag-state.json');
const FULL = process.env.RAG_FULL === '1' || process.env.RAG_FULL === 'true';

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN が必要です。');
  process.exit(1);
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 24);

function parseDoc(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^(\w+):\s*"?(.*?)"?$/);
    if (mm) meta[mm[1]] = mm[2];
  }
  return { meta, body: m[2].trim() };
}

function chunk(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS - CHUNK_OVERLAP) {
    const part = text.slice(i, i + CHUNK_CHARS).trim();
    if (part.length >= 40) chunks.push(part);
    if (i + CHUNK_CHARS >= text.length) break;
  }
  return chunks;
}

async function* walk(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    // 収集物は拡張子に関わらず frontmatter＋抽出テキスト。PDF由来は .pdf 名で
    // 保存される（中身はテキスト）ため .md と .pdf の両方を対象にする。
    // README.md は url frontmatter が無いため後段の `if (!meta.url) continue` で除外。
    else if (ent.name.endsWith('.md') || ent.name.endsWith('.pdf')) yield p;
  }
}

const EMBED_BATCH = 50; // Workers AI は1リクエストあたりのテキスト数に上限がある（100目安）。安全側に。

const MAX_RETRIES = 4; // 1回目＋再試行4回
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function embedOnce(texts) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${EMBED_MODEL}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: texts }),
    }
  );
  // 5xx 時に HTML が返ることもあるため、JSON でなくても例外の内容を残す
  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`embed failed: HTTP ${res.status} ${raw.slice(0, 200)}`);
  }
  if (!json.success) throw new Error('embed failed: ' + JSON.stringify(json.errors));
  return json.result.data; // number[][]
}

// Workers AI は「Cog prediction failed（code 8007）」など一時的な失敗を時々返す。
// 1回の失敗で全件の反映が止まらないよう、待ち時間を伸ばしながら再試行する。
async function embedWithRetry(texts) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(2000 * 2 ** (attempt - 1)); // 2s,4s,8s,16s
    try {
      return await embedOnce(texts);
    } catch (e) {
      lastErr = e;
      console.warn(`embed retry ${attempt + 1}/${MAX_RETRIES + 1} (${texts.length}件): ${e.message}`);
    }
  }
  throw lastErr;
}

let skippedChunks = 0;

// 再試行しても失敗するバッチは半分に割って再挑戦し、特定のチャンクだけが原因なら
// そのチャンクのみ飛ばす（null を返す）。全体は止めない。
async function embedBatch(texts) {
  try {
    return await embedWithRetry(texts);
  } catch (e) {
    if (texts.length === 1) {
      skippedChunks++;
      console.warn(`skip chunk（埋め込み不可）: ${e.message} / 先頭: ${texts[0].slice(0, 60)}`);
      return [null];
    }
    const mid = Math.ceil(texts.length / 2);
    return [...(await embedBatch(texts.slice(0, mid))), ...(await embedBatch(texts.slice(mid)))];
  }
}

// 大型ドキュメント（多チャンク）でも上限を超えないよう分割して埋め込む。
async function embed(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const part = await embedBatch(texts.slice(i, i + EMBED_BATCH));
    out.push(...part);
  }
  return out;
}

async function upsertNdjson(lines) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${INDEX}/upsert`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${API_TOKEN}`, 'content-type': 'application/x-ndjson' },
      body: lines.map((o) => JSON.stringify(o)).join('\n'),
    }
  );
  const json = await res.json();
  if (!json.success) throw new Error('upsert failed: ' + JSON.stringify(json.errors));
  return json.result;
}

async function deleteByIds(ids) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${INDEX}/delete_by_ids`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    }
  );
  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`delete failed: HTTP ${res.status} ${raw.slice(0, 200)}`);
  }
  if (!json.success) throw new Error('delete failed: ' + JSON.stringify(json.errors));
  return json.result;
}

const chunkIds = (url, from, to) => Array.from({ length: Math.max(0, to - from) }, (_, k) => `${sha(url)}-${from + k}`);

// 前回より文書数がこの割合以上（かつ6文書以上）減った回は、収集側の不具合を疑って削除を保留する（full なら実行）
const MASS_DELETE_RATIO = 0.2;

async function loadState() {
  try {
    const s = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    if (s.version !== STATE_VERSION || s.index !== INDEX) return { docs: {}, deletes: [] };
    // full でも「削除待ち」と「消えた文書の検出」のために記録自体は読む
    return { docs: s.docs || {}, deletes: s.deletes || [] };
  } catch {
    return { docs: {}, deletes: [] }; // 記録なし → 全件
  }
}

async function saveState(docs, deletes) {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify({ version: STATE_VERSION, index: INDEX, docs, deletes }));
}

async function main() {
  const loaded = await loadState();
  const known = loaded.docs; // 反映済みの記録（消えた文書の検出に使う）
  const prev = FULL ? {} : known; // 差分判定に使う記録（full のときは空＝全件埋め込み直し）
  const deletes = new Set(loaded.deletes); // Vectorize から消すべきID（失敗しても次回に持ち越す）
  console.log(
    Object.keys(prev).length
      ? `反映記録 ${Object.keys(prev).length} 件を読み込み（差分のみ反映）`
      : '反映記録なし（または full）：全件を反映します'
  );

  const state = {}; // 今回の結果（現存する文書のみ。消えた文書は記録から落とす）
  const seen = new Set();
  const saveState_ = () => saveState(state, [...deletes]);
  let pending = []; // まだ upsert していないベクトル
  let pendingDocs = []; // pending に含まれる文書の [url, 記録]
  let unchangedDocs = 0;
  let embeddedDocs = 0;
  let upserted = 0;

  // pending を Vectorize に送り、送り終えた文書だけを反映済みとして記録する。
  // 途中で失敗しても、送り終えた分は記録に残るので次回やり直さずに済む。
  const flush = async () => {
    for (let i = 0; i < pending.length; i += 100) {
      const batch = pending.slice(i, i + 100);
      const r = await upsertNdjson(batch);
      upserted += batch.length;
      console.log(`upserted ${upserted}`, r?.mutationId || '');
    }
    for (const [url, rec] of pendingDocs) {
      // 文書が短くなってチャンク数が減ったら、余った古いチャンクを削除待ちに入れる
      const old = known[url]?.chunks || 0;
      for (const id of chunkIds(url, rec.chunks, old)) deletes.add(id);
      state[url] = rec;
    }
    pending = [];
    pendingDocs = [];
    await saveState_();
  };

  try {
    for await (const file of walk(OUT_DIR)) {
      const raw = await readFile(file, 'utf8');
      const { meta, body } = parseDoc(raw);
      if (!meta.url) continue;
      seen.add(meta.url);
      const hash = sha(raw);
      if (prev[meta.url]?.hash === hash) {
        state[meta.url] = prev[meta.url];
        unchangedDocs++;
        continue;
      }
      const parts = chunk(body);
      const embeds = await embed(parts);
      if (embeds.some((e) => !e)) {
        // 一部でも埋め込めなかった文書は丸ごと見送る（記録を更新しないので次回再挑戦）
        if (known[meta.url]) state[meta.url] = { ...known[meta.url], hash: '' };
        continue;
      }
      embeddedDocs++;
      const docVectors = parts.map((text, i) => ({
        id: `${sha(meta.url)}-${i}`,
        values: embeds[i],
        metadata: {
          text,
          source_name: meta.source_name || '',
          title: meta.title || '',
          url: meta.url,
          updated_at: meta.fetched_at || '',
          pillar: meta.pillar || '',
          category: meta.category || '',
          disaster_scope: meta.disaster_scope || 'general',
        },
      }));
      pending.push(...docVectors);
      pendingDocs.push([meta.url, { hash, chunks: parts.length }]);
      if (pending.length >= 100) await flush();
    }
    await flush();
  } catch (e) {
    // 途中までの成果は残す。まだ見ていない文書は前回の記録をそのまま引き継ぐ
    await saveState({ ...known, ...state }, [...deletes]).catch(() => {});
    throw e;
  }

  // 収集対象から消えた文書（記録にあるが data/collected に無い）のチャンクを削除待ちに入れる
  const removed = Object.keys(known).filter((url) => !seen.has(url));
  let removedDocs = 0;
  const mass = removed.length > 5 && removed.length >= Object.keys(known).length * MASS_DELETE_RATIO;
  if (mass && !FULL) {
    // 一度に大量に消えるのは収集側の不具合の可能性が高い。消さずに記録を残して警告する
    for (const url of removed) state[url] = known[url];
    console.log(
      `::warning title=削除を保留::前回反映した ${Object.keys(known).length} 文書のうち ${removed.length} 文書が見当たりません。` +
        `収集の不具合の可能性があるため Vectorize からは削除していません。意図した削除なら upsert.yml を full で手動実行してください。`
    );
  } else {
    for (const url of removed) {
      for (const id of chunkIds(url, 0, known[url].chunks || 0)) deletes.add(id);
      console.log(`removed: ${url}`);
      removedDocs++;
    }
  }
  await saveState_();

  // 削除待ちを Vectorize から消す（成功した分だけ記録から外す）
  const ids = [...deletes];
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const r = await deleteByIds(batch); // 失敗したら削除待ちは記録に残ったまま次回再挑戦
    for (const id of batch) deletes.delete(id);
    deleted += batch.length;
    await saveState_();
    console.log(`deleted ${deleted}/${ids.length}`, r?.mutationId || '');
  }

  console.log(
    `done: 変更なし ${unchangedDocs} 文書・反映 ${embeddedDocs} 文書（${upserted} vectors）` +
      `・削除 ${removedDocs} 文書（${deleted} vectors）` +
      (skippedChunks ? `・見送り ${skippedChunks} チャンク` : '')
  );
  // 一部だけの失敗は許容するが、大量に失敗した回は障害とみなしてジョブを失敗させる
  const total = upserted + skippedChunks;
  if (total > 0 && skippedChunks / total > 0.05) {
    throw new Error(`埋め込み失敗が多すぎます: ${skippedChunks}/${total}`);
  }
  if (skippedChunks) {
    console.log(`::warning title=一部文書を見送り::埋め込みに失敗した ${skippedChunks} チャンクを含む文書を今回は反映していません（次回再挑戦）。`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
