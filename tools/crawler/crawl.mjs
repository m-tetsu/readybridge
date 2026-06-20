// 公的支援情報のスコープ付き再帰クローラ（雛形）。
//
// 役割：crawl-config.json のシードURLを起点に、許可ドメイン(.go.jp/.lg.jp)内を
//       深さ・ページ数の上限つきで辿り、HTML/PDF の本文を Markdown 化して保存。
//       前回との差分（新規・更新）を検知して要約を出力する。
//
// 反映フロー（論点③）：クロールは自動、Vectorize への反映は差分PR→レビュー→マージ。
//       実際の埋め込み/upsert は tools/crawler/upsert.mjs（別ステップ）。
//
// 実行：node tools/crawler/crawl.mjs  （npm run crawl）
//
// 注意：このリポジトリのこの環境では外部ネットワークに出られないため未実行。
//       実データでの動作確認は GitHub Actions / ローカルで行う。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { extractHtml, extractPdf } from './lib/extract.mjs';
import { isAllowed } from './lib/robots.mjs';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'tools/crawler/crawl-config.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

function hostAllowed(url, suffixes) {
  try {
    const h = new URL(url).hostname;
    return suffixes.some((suf) => h === suf.replace(/^\./, '') || h.endsWith(suf));
  } catch {
    return false;
  }
}

function slugFor(url) {
  const u = new URL(url);
  const p = (u.pathname + (u.search || '')).replace(/[^a-zA-Z0-9/_.-]/g, '_').replace(/\/+/g, '_').replace(/^_|_$/g, '') || 'index';
  return path.join(u.hostname, p.endsWith('.pdf') ? p : `${p}.md`).replace(/\.md\.md$/, '.md');
}

function frontmatter(meta) {
  const esc = (v) => String(v ?? '').replace(/"/g, '\\"');
  return [
    '---',
    `url: "${esc(meta.url)}"`,
    `source_name: "${esc(meta.source_name)}"`,
    `title: "${esc(meta.title)}"`,
    `pillar: "${esc(meta.pillar)}"`,
    `category: "${esc(meta.category)}"`,
    `disaster_scope: "${esc(meta.disaster_scope)}"`,
    `content_type: "${esc(meta.content_type)}"`,
    `content_hash: "${esc(meta.content_hash)}"`,
    `fetched_at: "${esc(meta.fetched_at)}"`,
    '---',
    '',
  ].join('\n');
}

async function fetchOnce(url, cfg) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': cfg.userAgent,
        accept: 'text/html,application/xhtml+xml,application/pdf,*/*',
        'accept-language': 'ja,en;q=0.8',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) return { skip: `status ${res.status}` };
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (ct.includes('application/pdf') || url.toLowerCase().endsWith('.pdf')) {
      return { type: 'pdf', buffer: buf };
    }
    if (ct.includes('html') || ct.includes('text/plain') || ct === '') {
      return { type: 'html', html: decodeBuf(buf, detectCharset(ct, buf)) };
    }
    return { skip: `content-type ${ct || 'unknown'}` };
  } catch (e) {
    return { skip: `${e.name || 'error'}: ${(e.message || '').slice(0, 60)}` };
  } finally {
    clearTimeout(t);
  }
}

async function fetchResource(url, cfg) {
  const first = await fetchOnce(url, cfg);
  if (!first.skip) return first;
  await sleep(3000);
  return fetchOnce(url, cfg);
}

// content-type または HTML の meta から文字コードを推定する。
function detectCharset(ct, buf) {
  const m = ct.match(/charset=["']?([\w-]+)/);
  if (m) return m[1].toLowerCase();
  const head = buf.subarray(0, 2048).toString('latin1').toLowerCase();
  const mm = head.match(/charset=["']?([\w-]+)/);
  return mm ? mm[1].toLowerCase() : 'utf-8';
}

// Shift_JIS / EUC-JP / UTF-8 をデコードする（Node の full-ICU 前提）。
function decodeBuf(buf, charset) {
  const norm = charset === 'shift-jis' || charset === 'x-sjis' ? 'shift_jis' : charset;
  try {
    return new TextDecoder(norm).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

async function main() {
  const cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const outDir = path.join(ROOT, cfg.outDir);
  await mkdir(outDir, { recursive: true });

  const manifestPath = path.join(outDir, 'manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : {};

  const visited = new Set();
  const seen = new Set(); // 今回取得できたURL
  const queue = [];
  for (const seed of cfg.seeds) {
    queue.push({ url: seed.url, depth: 0, seed, seedHost: new URL(seed.url).hostname });
  }

  const result = { new: [], changed: [], unchanged: [], skipped: [] };
  let pages = 0;

  while (queue.length && pages < cfg.maxPagesPerRun) {
    const item = queue.shift();
    const { url, depth, seed, seedHost } = item;
    if (visited.has(url)) continue;
    visited.add(url);

    if (!hostAllowed(url, cfg.allowedDomainSuffixes)) { result.skipped.push([url, 'domain']); continue; }
    // pathPrefix はシードと同一ホストのときだけ適用（外部省庁・自治体へは越境を許可）。
    if (seed.pathPrefix && new URL(url).hostname === seedHost && !new URL(url).pathname.startsWith(seed.pathPrefix)) {
      result.skipped.push([url, 'pathPrefix']); continue;
    }
    if (!(await isAllowed(url, cfg.userAgent, fetch, cfg.requestTimeoutMs))) { result.skipped.push([url, 'robots']); continue; }

    const fetched = await fetchResource(url, cfg);
    await sleep(cfg.requestDelayMs); // 礼儀：リクエスト間隔
    if (!fetched || fetched.skip) { result.skipped.push([url, fetched?.skip || 'fetch']); continue; }

    let extracted;
    if (fetched.type === 'pdf') extracted = await extractPdf(fetched.buffer);
    else extracted = extractHtml(fetched.html, url);

    if (!extracted.text || extracted.text.length < 40) { result.skipped.push([url, 'empty']); continue; }

    pages++;
    seen.add(url);

    const hash = sha256(extracted.text);
    const meta = {
      url,
      source_name: cfg.hostNames[new URL(url).hostname] || seed.source_name,
      title: extracted.title || url,
      pillar: seed.pillar,
      category: seed.category,
      disaster_scope: seed.disaster_scope,
      content_type: fetched.type,
      content_hash: hash,
      fetched_at: today(),
    };

    const prev = manifest[url];
    if (!prev) result.new.push(url);
    else if (prev.hash !== hash) result.changed.push(url);
    else { result.unchanged.push(url); }

    // 本文を保存（新規・更新・不変いずれも最新を書き出す）。
    const outPath = path.join(outDir, slugFor(url));
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, frontmatter(meta) + extracted.text + '\n', 'utf8');
    manifest[url] = { hash, title: meta.title, fetched_at: meta.fetched_at, file: path.relative(ROOT, outPath) };

    // リンク展開（HTMLのみ・深さ上限内）。
    const maxDepth = seed.maxDepth ?? cfg.maxDepth;
    if (fetched.type === 'html' && depth < maxDepth) {
      for (const link of extracted.links) {
        if (!visited.has(link) && hostAllowed(link, cfg.allowedDomainSuffixes)) {
          queue.push({ url: link, depth: depth + 1, seed, seedHost });
        }
      }
    }
  }

  // ※ 削除/移動の検知（前回あって今回消えたURL）は段階導入とし、ここでは未実装。

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const summary = {
    ran_at: new Date().toISOString(),
    pages_fetched: pages,
    new: result.new.length,
    changed: result.changed.length,
    unchanged: result.unchanged.length,
    skipped: result.skipped.length,
  };
  await writeFile(path.join(outDir, 'last-run.json'), JSON.stringify({ summary, ...result }, null, 2) + '\n', 'utf8');

  console.log('收集サマリ:', JSON.stringify(summary, null, 2));
  if (result.new.length) console.log('新規:', result.new.slice(0, 20));
  if (result.changed.length) console.log('更新:', result.changed.slice(0, 20));
}

main().catch((err) => {
  console.error('crawl failed:', err);
  process.exit(1);
});
