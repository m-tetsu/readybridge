# AI相談の相談ログ（D1）

`/api/chat` は1リクエストごとに、D1 データベース `readybridge-chat` のテーブル `chat_logs` へ1行を記録する（`wrangler.toml` の `CHAT_DB` バインディング）。

- **保存期間は無期限**（削除しない限り残る）。
- **質問と回答の本文も保存する**。目的はサイト改善のための統計分析（よく聞かれるテーマ、答えられなかった質問、回答の質の確認）。`/chat` のフォーム注記と `/about`「AI相談の記録について」に明記済み。
- 保存前に **メールアドレス → `[メール]`、電話番号（0/+81 始まり 10〜11 桁）→ `[電話]`** に置き換える。IP アドレスなど送信者を特定する情報は保存しない。
- テーブルは初回書き込み時に `CREATE TABLE IF NOT EXISTS` で自動作成される（マイグレーション作業は不要）。
- 書き込みは `waitUntil` でレスポンス後に行うので、回答の速さには影響しない。失敗しても回答は返る。
- 費用：Workers Free の D1 無料枠（保存 5GB・書き込み 10万行/日）の範囲内。1件は数KB。

## 列

| 列 | 内容 |
|---|---|
| `created_at` | 記録日時（UTC, ISO 8601） |
| `outcome` | `ok` / `invalid_json` / `empty_question` / `not_configured` / `embedding_failed` / `generation_failed` / `empty_answer` / `internal_error` |
| `question` / `answer` | 質問・回答の本文（伏せ字処理後。質問は 1000 字で切り詰め） |
| `sources` | 提示した出典（`[{title, url}]` の JSON） |
| `disaster_scope` | 検索ヒットした災害の範囲（`general` 以外のとき） |
| `model` | 生成モデル |
| `question_len` / `source_count` / `latency_ms` | 質問の文字数・出典数・処理時間（ms） |
| `input_tokens` / `output_tokens` | トークン数（生成まで進んだ場合） |

## 見方

### ダッシュボード（いちばん手軽）

Cloudflare ダッシュボード → **Storage & Databases → D1 → readybridge-chat → Console** で SQL を実行できる。

```sql
-- 結果別の件数
SELECT outcome, COUNT(*) FROM chat_logs GROUP BY outcome;
-- 直近の質問と回答
SELECT created_at, question, answer FROM chat_logs ORDER BY id DESC LIMIT 20;
-- 出典ゼロだった質問（記事追加の候補）
SELECT created_at, question FROM chat_logs WHERE outcome = 'ok' AND source_count = 0 ORDER BY id DESC;
```

### コマンド

```bash
export CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=...   # トークンに D1: Read 権限が必要
npm run chat:stats              # 累計＋直近30日の集計
npm run chat:stats -- 7         # 直近7日
npm run chat:stats -- export    # 全件を chat-logs-YYYYMMDD.csv に書き出し（.gitignore 済み・コミットしない）
```

書き出した CSV を Claude に渡せば、テーマ分類や記事追加（B5）の候補出しができる。

## 削除

特定の行を消す場合は Console で `DELETE FROM chat_logs WHERE id = ...;`。全消去は `DELETE FROM chat_logs;`。
