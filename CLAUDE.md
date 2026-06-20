# ReadyBridge — プロジェクト引き継ぎ

このファイルは Claude Code が起動時に自動で読み込む。
新しい会話セッションは、このファイルだけで前回までの文脈を持って始められる。

---

## サイトの目的

中小企業の事業継続（BCP）を、**平時の備え**から**有事の対応・再建**までつなぐ情報サイト。
災害支援は制度が多く、災害ごとに内容も変わるため、被災企業が「まず何を見るべきか」「どう使うか」を迷わず確認できる場所を作る。

- 想定利用者：中小企業の経営者・担当者（一般公開）
- 維持費は安価（プロトタイプは月¥0、公開後もLLM等の従量で月数百〜数千円）
- AI相談（RAG）は後フェーズ

## 設計のコンセプト

- **2本柱**：`/prepare`（平時の備え）と `/recover`（有事の対応・再建）
- **3つの入口**：
  1. 横断検索（既存記事をキーワード）
  2. 状況カード（平時／有事から辿る）
  3. AI相談（個別質問・最新の支援を出典付きで／未実装）
- 出典・最終更新日を明示。専門用語をかみくだき、次の一手を具体的に書く。
- 「AIっぽい」汎用デザインを避け、明朝体の見出し＋温かい紙色×ティール×テラコッタ。

## 決定事項（変えない方針）

- サイト名：**ReadyBridge**（橋＝企業と社会／平時と有事をつなぐ）
- ロゴ：橋（2点＋アーチ）のSVGマーク＋"ReadyBridge" ワードマーク（Quicksand）。`src/components/Logo.astro`
- ヒーロー見出し：「**備えるときも、続けるときも。**」
- アイブロウ：「中小企業の事業継続（BCP）を、平時から有事まで」
- ヒーロー画像：`public/hero.webp`（左＝平時／右＝有事を矢印でつなぐアイソメ図）。差し替えは同名ファイルで上書き
- 「平時の備え」「有事の対応・再建」の分離（柱）
- フォント：見出し Shippori Mincho、本文 Zen Kaku Gothic New、ワードマーク Quicksand
- 配色（CSS変数）：`--teal #0f6e63` / `--terra #d2693f` / `--paper #f5f1e8` ほか `src/styles/global.css`
- 見出しや小見出しの説明文は **デスクトップで改行しない**（`white-space: nowrap` ＋ 〜820px / 〜1040pxで自動復帰）

## 技術スタック

- Astro v5（静的サイト生成）／TypeScript／コンテンツコレクション
- Markdown 記事：`src/content/faq/*.md`（`pillar` は category から導出）
- 横断検索：`src/pages/search-index.json.ts`（全記事JSON）＋ `src/components/SearchBox.astro`（クライアント側 fetch & filter）
- 外部依存：Google Fonts のみ。JS ライブラリは追加していない（フレームワーク以外 0 依存）

## ディレクトリ

```
src/
├─ categories.ts            # PILLARS / CATEGORIES（柱とカテゴリの単一情報源）
├─ content.config.ts        # FAQ コンテンツのスキーマ
├─ content/faq/             # Markdown 記事（追加するだけで反映）
├─ components/
│   ├─ Logo.astro           # ロゴ
│   ├─ SearchBox.astro      # 横断/絞り込み検索
│   └─ HeroArt.astro        # 旧 SVG（未使用・参考に残置）
├─ layouts/Base.astro       # 共通レイアウト（ヘッダ・フッタ・フォント）
├─ styles/global.css        # 全 CSS（デザインシステム）
└─ pages/
    ├─ index.astro          # ハブ（ヒーロー＋検索＋2大カード＋信頼＋AI相談CTA）
    ├─ prepare.astro        # 平時の備え
    ├─ recover.astro        # 有事の対応・再建
    ├─ faq/index.astro      # 全記事一覧（柱ごとグルーピング）
    ├─ faq/[id].astro       # 記事詳細
    ├─ search-index.json.ts # 検索インデックス（ビルド時生成）
    ├─ chat.astro           # AI 相談（準備中）
    └─ sources.astro        # 参照する公的ソース一覧
```

## デプロイ

- ホスティング：**Cloudflare（Workers Static Assets / Pages 統合）**
- GitHub リポジトリ：`https://github.com/m-tetsu/readybridge`
- 本番 URL：`https://readybridge.tetsu315.workers.dev`
- ビルド：`npm run build`（出力 `dist/`）／Node 20
- ワークフロー：`git push` → Cloudflare が自動ビルド & 反映
- 環境変数：`NODE_VERSION=20`

## ローカル

```bash
npm install
npm run dev      # http://localhost:4321
npm run build
npm run preview
```

## コンテンツの足し方

1. `src/content/faq/<pillar>-<slug>.md` を新規作成
2. frontmatter に `question / category / order / summary / sources / updated` を記入
   - `category` は `src/categories.ts` の `CATEGORIES` キーから（`bcp`/`fund-prep`/`facility-prep`/`org`/`stock`/`wage`/`finance`/`facility`/`tax`）
   - `pillar` は category から自動導出（明示不要）
   - `featured: true` でトップの目立つ位置にも掲載
3. `git push` → 自動反映

新カテゴリを足す場合は `src/categories.ts` の `CATEGORIES` と `src/content.config.ts` の `categories` enum 両方に追加。

## 公開済みの記事（2026-05時点・各カテゴリ最低1本ある状態）

平時：BCP始め方／資金の備え／設備・データ保護／備蓄
有事：休業手当／資金繰り／施設復旧／税・公共料金

## 平時の備え詳細ページ（試作 -draft）

新しい `/prepare` の詳細ページを Astro ページ（`src/pages/prepare-*-draft.astro`）として作成中。
全ページ完成後、`-draft` を外して正式化し、旧 `prepare.astro` と差し替える。

### デザイン変更
- アイコン：絵文字→単色SVG（`src/components/Icon.astro` 新規作成）
- 背景色：`#f5f1e8` → `#ffffff` に変更

### ページ一覧（8/8 試作完了）
| # | カード名 | ファイル | 状態 |
|---|---------|---------|------|
| 1 | 地域のハザードを知る | `prepare-hazard-draft.astro` | 試作完了 |
| 2 | 安全を確保する | `prepare-safety-draft.astro` | 試作完了 |
| 3 | 被害を減らす | `prepare-damage-draft.astro` | 試作完了 |
| 4 | BCP・事業継続力強化計画を作る | `prepare-bcp-draft.astro` | 試作完了 |
| 5 | 生活を守る | `prepare-life-draft.astro` | 試作完了 |
| 6 | 訓練をする | `prepare-training-draft.astro` | 試作完了 |
| 7 | 資金・保険を備える | `prepare-fund-draft.astro` | 試作完了 |
| 8 | 更に知りたい人へ | `prepare-links-draft.astro` | 試作完了 |

### 残タスク
- [ ] `prepare-draft.astro` のカードリンク（全部 `#`）→ 詳細ページURLに更新
- [ ] `safety-tentoboushi.png` のアップロード（ユーザー側作業）
- [ ] 全ページの見直し・文言調整後、`-draft` を外して正式化
- [ ] 旧 `prepare.astro` と差し替え

## 収集パイプライン（第2フェーズ・完了）

- GitHub Actions cron でクロール → `data/collected/` に保存 → 差分PR
- Cloudflare Edge proxy（`/api/gov-proxy`）で Akamai 遮断ホストも取得可能
- `proxyHosts`: chusho/meti/jpo + 地方経産局8局
- 直近の収集結果：500ページ（maxPagesPerRun=500）

## 開いている論点・次の候補

- [ ] **独自ドメイン**（Cloudflare Registrar 想定／松下さん側で取得検討中）
- [x] ~~**SEO / OG メタタグ**~~ 済（Base.astro に og:image/Twitter Card 追加）
- [ ] **OG画像の作成**（1200×630 の実画像を `public/` に配置）
- [ ] **AI 相談（RAG）の検討着手**（第3フェーズ）
- [ ] **meti.go.jp HTML "empty" 問題**（プロキシは通るが本文抽出で<40文字。優先度低）

## やり取りの好み（松下さんの指示スタイル）

- 短く端的。不明点は推測せず一言確認。
- 提案は **理由とトレードオフ** を添える。長い結論より「決められる材料」。
- レイアウト・文言の細かい差し戻しを歓迎する（"AIっぽさ" を嫌う）。
- 出典・根拠を曖昧にしない。災害支援は災害ごとに変わる前提を留保する。

---

このファイルが古くなったら、迷わず更新してよい（決定事項・URL・公開済み記事リスト等）。
