# 収集クローラ（RAG 第2フェーズ）

公的な支援情報を定期巡回し、本文を Markdown 化して差分を検知する。設計は `docs/rag-plan.md`（論点③）、巡回先は `docs/rag-source-ledger.md`。

## 仕組み

```
crawl-config.json（シード＋スコープ）
        │
        ▼
crawl.mjs  ── スコープ付き再帰クロール（.go.jp / .lg.jp、深さ・ページ上限つき）
        │      ├─ HTML本文・リンク抽出（cheerio）
        │      ├─ PDF本文抽出（pdf-parse）
        │      ├─ robots.txt 尊重・リクエスト間隔
        │      └─ 差分検知（manifest.json のハッシュ比較）
        ▼
data/collected/**.md（frontmatter付き本文） ＋ manifest.json ＋ last-run.json
        │
        ▼（GitHub Actions: 差分があれば PR 起票 → 人がレビュー → マージ）
        ▼
upsert.mjs ── チャンク分割 → Workers AI 埋め込み → Vectorize へ upsert
```

## スコープ設計

- **許可ドメイン**：`.go.jp`（国）/ `.lg.jp`（自治体）。他省庁・県へ越境して辿る。
- **安全弁**：最大深さ（既定2）＋1回あたり最大ページ数（既定300）＋リクエスト間隔。
- **pathPrefix**（任意）：シードと同一ホスト内のみパスで絞る（恒常ソース向け）。越境リンクには適用しない。
- 1つのシードから辿ったページは、そのシードの `pillar`/`category`/`disaster_scope` を引き継ぐ。`source_name` は `hostNames` のホスト→名称マップで補正。

設定は `crawl-config.json`。シード追加＝`seeds[]` に1件足すだけ。

## 実行

```bash
npm run crawl        # 巡回して data/collected を更新、差分を表示
# Vectorize へ反映（要 Cloudflare 認証情報・未検証）
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run rag:upsert
```

## 注意・段階導入

- `robots.mjs` は `User-agent: *` の Disallow のみ評価する簡易版。
- 削除/移動の検知は未実装（段階導入）。
- `upsert.mjs` は Cloudflare REST のシェイプに基づく雛形で**未検証**。初回は少数で挙動を確認しAPI形に合わせて調整する。
- この開発環境は外部ネットワークに出られないため、クロールの実走は GitHub Actions（`workflow_dispatch`）かローカルで行う。
