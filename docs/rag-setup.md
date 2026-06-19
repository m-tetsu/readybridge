# RAG（AI相談）セットアップ手順

> AI相談（RAG）機能を動かすために、Cloudflare 側で一度だけ行う設定手順。
> 設計の全体像は `docs/rag-plan.md`、巡回ソースは `docs/rag-source-ledger.md` を参照。
> ステータス：**手順ドラフト（実装着手時に確定）**。コマンドはバージョンにより細部が変わるので、実行時に `wrangler` の最新ヘルプも確認する。

## 前提

- ホスティング：Cloudflare Workers（Static Assets）。本番URL `https://readybridge.tetsu315.workers.dev`。
- 現状はフロント（Astro 静的サイト）のみ。RAG では Worker 側の API（`/api/chat`）と、Vectorize・Workers AI・Secrets のバインディングを追加する。

## 1. API キー（Anthropic）

論点⑤の決定どおり、**Workers Secrets（暗号化）** で保存する。`wrangler.toml` の `vars`（平文）には**入れない**。

```bash
# 本番に登録（値は対話入力。画面には二度と出ない）
npx wrangler secret put ANTHROPIC_API_KEY
```

- Anthropic コンソールで**この用途専用のキー**を発行する（漏洩時に即無効化できるよう用途を分ける）。
- ローカル開発は `.dev.vars`（`.dev.vars.example` をコピーして作成。`.gitignore` 済み）。
- Worker 内では `env.ANTHROPIC_API_KEY` で参照する。
- 使用モデルは Claude Haiku 4.5（`claude-haiku-4-5`）。将来の Opus 切替に備えモデルIDはコード内で定数化する（論点⑥）。

## 2. ベクトルストア（Cloudflare Vectorize）

論点①の決定。多言語埋め込み `@cf/baai/bge-m3` の次元は **1024**、距離は **cosine** を想定。

```bash
# インデックス作成（次元と距離はembeddingモデルに合わせる）
npx wrangler vectorize create readybridge-rag --dimensions=1024 --metric=cosine

# メタデータでの絞り込み（category / pillar / disaster_scope）に使うインデックスを作成
npx wrangler vectorize create-metadata-index readybridge-rag --property-name=category --type=string
npx wrangler vectorize create-metadata-index readybridge-rag --property-name=pillar --type=string
npx wrangler vectorize create-metadata-index readybridge-rag --property-name=disaster_scope --type=string
```

## 3. 埋め込み（Workers AI）

論点②の決定。Workers AI を有効化し、Worker にバインドする。鍵は不要（同一アカウント内）。

## 4. SSR アダプタ（実装済み）と wrangler.toml（バインディング）

`/api/chat`（AI相談のバックエンド）はオンデマンド実行（SSR）が必要なため、**`@astrojs/cloudflare` アダプタを導入済み**（`astro.config.mjs`）。

- 既定は静的生成のまま。SSR が必要なルートだけ `export const prerender = false`（`/api/chat` で設定済み）。
- `npm run build` の出力は `dist/_worker.js`（SSRエントリ）＋静的アセット。
- **デプロイ設定はリポジトリの `wrangler.toml` に定義済み**（Worker名 `readybridge`、`main`、`[assets]`、`VECTORIZE`/`AI` バインディング）。`npx wrangler deploy` がこれを読んでデプロイする。`public/.assetsignore` で `_worker.js` 等を公開アセットから除外している。
- `ANTHROPIC_API_KEY` は Secret として別途登録（`wrangler.toml` には書かない）。Secret はデプロイをまたいで保持される。
- バインディング（`VECTORIZE`/`AI`）は `wrangler.toml` 側が正となる。ダッシュボードで設定済みでも、`wrangler deploy` 時は設定ファイルの内容が適用される（名前は一致させてある）。
- 未設定（バインディング/鍵欠落）の場合、`/api/chat` は `503 not_configured` を返し、フロントは「準備中」表示にフォールバックする（サイトは正常稼働）。

下記はバインディングの設定内容（`wrangler.toml` と対応）。

```toml
# name / compatibility_date 等は実装時に設定

# ベクトルストア
[[vectorize]]
binding = "VECTORIZE"
index_name = "readybridge-rag"

# 埋め込み・（必要なら）生成補助
[ai]
binding = "AI"

# 簡易レート制限・スナップショット保存などに使う想定（任意）
# [[kv_namespaces]]
# binding = "RAG_KV"
# id = "..."

# 機密値は vars ではなく Secrets で登録する：
#   npx wrangler secret put ANTHROPIC_API_KEY
```

## 5. 収集パイプライン（GitHub Actions）

第2フェーズで追加。日次 cron で公的ソースを取得 → Markdown 化 → 差分検知 → 埋め込み生成 → Vectorize へ upsert → 重要な変更は PR 起票。巡回先と運用ルールは `docs/rag-source-ledger.md` を参照。Actions からは Vectorize/Workers AI を叩くため、必要な API トークンを Actions Secrets に登録する（実装時に確定）。

## チェックリスト（実行時）

- [ ] Anthropic 専用キー発行 → `wrangler secret put ANTHROPIC_API_KEY`
- [ ] ローカル `.dev.vars` 作成（`.dev.vars.example` から）
- [ ] Vectorize インデックス作成（1024 / cosine）＋メタデータインデックス
- [ ] Workers AI 有効化・バインド
- [ ] `wrangler.toml` にバインディング追加（実装PRで）
- [ ] Anthropic 側の使用上限・Worker側の `max_tokens`/簡易レート制限を設定（コスト保険）
