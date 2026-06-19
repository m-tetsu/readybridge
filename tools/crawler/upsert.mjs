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
    else if (ent.name.endsWith('.md')) yield p;
  }
}

async function embed(texts) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${EMBED_MODEL}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: texts }),
    }
  );
  const json = await res.json();
  if (!json.success) throw new Error('embed failed: ' + JSON.stringify(json.errors));
  return json.result.data; // number[][]
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
  console.log('done:', vectors.length, 'vectors');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
