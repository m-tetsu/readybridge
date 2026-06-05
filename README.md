# ReadyBridge

中小企業の事業継続（BCP）を、平時の備えから有事の対応・再建までつなぐ情報サイト。

- 平時の備え（`/prepare`）と 有事の対応・再建（`/recover`）の2本柱
- 横断検索（クライアント側、`/search-index.json` を参照）
- 各記事に出典リンクを明示

## 技術スタック

- フレームワーク：[Astro](https://astro.build) v5（静的サイト生成）
- コンテンツ：Markdown（`src/content/faq/`）
- フォント：Shippori Mincho / Zen Kaku Gothic New / Quicksand（Google Fonts）

## ローカル開発

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # dist/ に静的書き出し
npm run preview  # ビルド結果をローカル確認
```

## デプロイ（Cloudflare Pages）

- ビルドコマンド：`npm run build`
- 出力ディレクトリ：`dist`
- Node バージョン：`20` 以上（環境変数 `NODE_VERSION=20` を推奨）

## 主なディレクトリ

```
src/
├─ categories.ts         # 柱（prepare/recover）とカテゴリ定義
├─ content.config.ts     # FAQコンテンツのスキーマ
├─ content/faq/          # Markdown記事
├─ components/           # Logo / SearchBox / HeroArt 等
├─ layouts/Base.astro    # 共通レイアウト
└─ pages/
   ├─ index.astro        # トップ（ハブ）
   ├─ prepare.astro      # 平時の備え
   ├─ recover.astro      # 有事の対応・再建
   ├─ faq/[id].astro     # 記事詳細
   ├─ search-index.json.ts  # 検索用JSONエンドポイント
   └─ ...
```
