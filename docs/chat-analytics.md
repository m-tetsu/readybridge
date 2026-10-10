# AI相談の利用状況（Analytics Engine）

`/api/chat` は1リクエストごとに、Workers Analytics Engine のデータセット `readybridge_chat` へ1行を記録する（`wrangler.toml` の `CHAT_LOG` バインディング）。

- **質問の本文は保存しない**。`/chat` の「送信内容は回答の生成にのみ使われます」という表記と整合させるため。記録するのは文字数などのメタ情報だけ。
- 記録に失敗しても回答は止めない（`record()` 内で握りつぶす）。
- 保存期間は約3か月（Analytics Engine の仕様）。長期で残したい場合は、月次で集計値を控える。
- 費用：Workers Free プランの範囲内（書き込み・クエリとも無料枠あり）。

## 列

| 列 | 内容 |
|---|---|
| `index1` / `blob1` | 結果：`ok` / `invalid_json` / `empty_question` / `not_configured` / `embedding_failed` / `generation_failed` / `empty_answer` / `internal_error` |
| `blob2` | 生成モデル |
| `blob3` | 検索ヒットした `disaster_scope`（`general` 以外のときのみ） |
| `double1` | 質問の文字数（1000字で切り詰め後） |
| `double2` | 出典数 |
| `double3` | 処理時間（ms） |
| `double4` / `double5` | 入力 / 出力トークン（生成まで進んだ場合） |

## 見方

### コマンドで集計する

```bash
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run chat:stats        # 直近30日
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run chat:stats -- 7   # 直近7日
```

API トークンには **Account → Account Analytics → Read** の権限が必要。upsert 用の既存トークンに無い場合は、ダッシュボードの「My Profile → API Tokens」で権限を追加するか、閲覧専用のトークンを別に作る。

### SQL を直接投げる

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -d "SELECT blob1 AS outcome, SUM(_sample_interval) AS count
      FROM readybridge_chat WHERE timestamp > NOW() - INTERVAL '30' DAY
      GROUP BY outcome"
```

件数は `count()` ではなく `SUM(_sample_interval)` で数える（大量アクセス時のサンプリング補正）。
