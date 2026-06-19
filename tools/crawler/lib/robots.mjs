// robots.txt の最小実装（User-agent: * の Disallow のみ評価）。
// 注意：ワイルドカード(*)・Allow の優先規則・クロール遅延指定などは未対応の簡易版。
// 公的サイトの一般的な Disallow を尊重する用途には十分だが、将来必要なら拡張する。

const cache = new Map(); // origin -> { disallow: string[] }

export async function isAllowed(url, userAgent, fetchImpl = fetch, timeoutMs = 20000) {
  const u = new URL(url);
  if (!cache.has(u.origin)) {
    cache.set(u.origin, await loadRobots(u.origin, userAgent, fetchImpl, timeoutMs));
  }
  const { disallow } = cache.get(u.origin);
  const path = u.pathname || '/';
  for (const rule of disallow) {
    if (rule && path.startsWith(rule)) return false;
  }
  return true;
}

async function loadRobots(origin, userAgent, fetchImpl, timeoutMs) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetchImpl(origin + '/robots.txt', {
      headers: { 'user-agent': userAgent },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (!res.ok) return { disallow: [] };
    return parseRobots(await res.text());
  } catch {
    // robots.txt が取れない場合は「制限なし」とみなす（安全側に倒すなら逆も可）。
    return { disallow: [] };
  }
}

function parseRobots(txt) {
  const disallow = [];
  let active = false; // User-agent: * のブロック内か
  for (let line of txt.split(/\r?\n/)) {
    line = line.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      active = val === '*';
    } else if (key === 'disallow' && active && val) {
      disallow.push(val);
    }
  }
  return { disallow };
}
