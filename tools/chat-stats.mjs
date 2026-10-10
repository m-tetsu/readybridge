// AI相談（/api/chat）の利用状況を Analytics Engine から集計して表示する。
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run chat:stats [-- 日数]
// トークンには「Account Analytics: Read」権限が必要。詳細は docs/chat-analytics.md。

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DAYS = Number(process.argv[2] ?? 30);
const DATASET = 'readybridge_chat';

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN を設定してください。');
  process.exit(1);
}
if (!Number.isInteger(DAYS) || DAYS < 1 || DAYS > 90) {
  console.error('日数は 1〜90 の整数で指定してください（保存期間は約3か月）。');
  process.exit(1);
}

async function sql(query) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`,
    { method: 'POST', headers: { Authorization: `Bearer ${API_TOKEN}` }, body: query },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${text}`);
  return JSON.parse(text).data;
}

const range = `timestamp > NOW() - INTERVAL '${DAYS}' DAY`;

// _sample_interval を掛けてサンプリング分を補正した件数にする
const byOutcome = await sql(`
  SELECT blob1 AS outcome, SUM(_sample_interval) AS count
  FROM ${DATASET} WHERE ${range}
  GROUP BY outcome ORDER BY count DESC`);

const byDay = await sql(`
  SELECT toDate(timestamp) AS day,
         SUM(_sample_interval) AS total,
         SUM(IF(blob1 = 'ok', _sample_interval, 0)) AS ok
  FROM ${DATASET} WHERE ${range}
  GROUP BY day ORDER BY day`);

const okStats = await sql(`
  SELECT SUM(_sample_interval * double3) / SUM(_sample_interval) AS avg_ms,
         SUM(_sample_interval * double4) AS input_tokens,
         SUM(_sample_interval * double5) AS output_tokens
  FROM ${DATASET} WHERE ${range} AND blob1 = 'ok'`);

console.log(`\n■ 直近 ${DAYS} 日の AI 相談\n`);
console.log('結果別:');
console.table(byOutcome);
console.log('日別:');
console.table(byDay);
const s = okStats[0] ?? {};
console.log('成功分の平均処理時間(ms):', Math.round(Number(s.avg_ms ?? 0)));
console.log('成功分の入力/出力トークン:', Number(s.input_tokens ?? 0), '/', Number(s.output_tokens ?? 0));
