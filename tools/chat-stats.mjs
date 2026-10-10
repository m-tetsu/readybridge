// AI相談（/api/chat）の相談ログを D1 から集計・書き出しする。
//   npm run chat:stats              # 直近30日の集計
//   npm run chat:stats -- 7         # 直近7日の集計
//   npm run chat:stats -- export    # 全件を CSV に書き出し（chat-logs-YYYYMMDD.csv）
// 環境変数 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN（D1: Read 権限）が必要。
// database_id は wrangler.toml から読む。詳細は docs/chat-logs.md。

import { readFileSync, writeFileSync } from 'node:fs';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const arg = process.argv[2] ?? '30';

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN を設定してください。');
  process.exit(1);
}

const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const DB_ID = toml.match(/binding\s*=\s*"CHAT_DB"[\s\S]*?database_id\s*=\s*"([^"]+)"/)?.[1];
if (!DB_ID || DB_ID.startsWith('REPLACE')) {
  console.error('wrangler.toml の CHAT_DB に database_id が設定されていません。');
  process.exit(1);
}

async function sql(query, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql: query, params }),
    },
  );
  const body = await res.json();
  if (!res.ok || !body.success) throw new Error(`D1 API ${res.status}: ${JSON.stringify(body.errors)}`);
  return body.result[0].results;
}

if (arg === 'export') {
  const rows = await sql('SELECT * FROM chat_logs ORDER BY id');
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const esc = (v) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const file = `chat-logs-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;
  // BOM 付きで Excel でも文字化けしないようにする
  writeFileSync(file, '﻿' + csv + '\n');
  console.log(`${rows.length} 件を ${file} に書き出しました。`);
  process.exit(0);
}

const DAYS = Number(arg);
if (!Number.isInteger(DAYS) || DAYS < 1) {
  console.error('引数は日数（1以上の整数）か export を指定してください。');
  process.exit(1);
}
const since = new Date(Date.now() - DAYS * 86400_000).toISOString();

const total = await sql('SELECT COUNT(*) AS count, MIN(created_at) AS first FROM chat_logs');
const byOutcome = await sql(
  'SELECT outcome, COUNT(*) AS count FROM chat_logs WHERE created_at >= ? GROUP BY outcome ORDER BY count DESC',
  [since],
);
const byDay = await sql(
  `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS total, SUM(outcome = 'ok') AS ok
   FROM chat_logs WHERE created_at >= ? GROUP BY day ORDER BY day`,
  [since],
);
const okStats = await sql(
  `SELECT ROUND(AVG(latency_ms)) AS avg_ms, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
   FROM chat_logs WHERE created_at >= ? AND outcome = 'ok'`,
  [since],
);

console.log(`\n■ 累計 ${total[0].count} 件（記録開始 ${total[0].first ?? '—'}）`);
console.log(`■ 直近 ${DAYS} 日\n`);
console.log('結果別:');
console.table(byOutcome);
console.log('日別（日付は UTC）:');
console.table(byDay);
const s = okStats[0] ?? {};
console.log('成功分の平均処理時間(ms):', s.avg_ms ?? 0);
console.log('成功分の入力/出力トークン:', s.input_tokens ?? 0, '/', s.output_tokens ?? 0);
