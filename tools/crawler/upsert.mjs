// 収集済み Markdown を チャンク分割 → Workers AI で埋め込み → Vectorize へ upsert する。
//
// ⚠️ 未検証：このスクリプトは Cloudflare REST API のシェイプに基づく雛形。
//    実行には環境変数 CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN（Workers AI + Vectorize 権限）が必要。
//    初回は少数ファイルで挙動を確認し、APIのレスポンス形に合わせて調整すること。
//
// 実行：CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node tools/crawler/upsert.mjs

import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const INDEX = process.env.VECTORIZE_INDEX || 'readybridge-rag';
const EMBED_MODEL = '@cf/baai/bge-m3';
const OUT_DIR = path.join(process.cwd(), 'data/collected');
const CHUNK_CHARS = 800;
const CHUNK_OVERLAP = 120;

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

async function main() {
  const vectors = [];
  for await (const file of walk(OUT_DIR)) {
    const { meta, body } = parseDoc(await readFile(file, 'utf8'));
    if (!meta.url) continue;
    const parts = chunk(body);
    const embeds = await embed(parts);
    parts.forEach((text, i) => {
      if (!embeds[i]) return; // 埋め込みに失敗したチャンクは今回は見送る（次回再挑戦）
      vectors.push({
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
      });
    });
  }
  // 100件ずつ upsert
  for (let i = 0; i < vectors.length; i += 100) {
    const batch = vectors.slice(i, i + 100);
    const r = await upsertNdjson(batch);
    console.log(`upserted ${i + batch.length}/${vectors.length}`, r?.mutationId || '');
  }
  console.log('done:', vectors.length, 'vectors', skippedChunks ? `（skip ${skippedChunks}）` : '');
  // 一部だけの失敗は許容するが、大量に失敗した回は障害とみなしてジョブを失敗させる
  const total = vectors.length + skippedChunks;
  if (total === 0 || skippedChunks / total > 0.05) {
    throw new Error(`埋め込み失敗が多すぎます: ${skippedChunks}/${total}`);
  }
  if (skippedChunks) {
    console.log(`::warning title=一部チャンクを見送り::埋め込みに失敗した ${skippedChunks} チャンクを今回は反映していません（次回再挑戦）。`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
