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
- 配色（CSS変数）：`--teal #0f6e63` / `--terra #d2693f` / `--paper #ffffff`（白背景に変更済み） ほか `src/styles/global.css`
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
│   ├─ Icon.astro           # 単色SVGアイコン（stroke="currentColor"）
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
    ├─ sources.astro        # 参照する公的ソース一覧
    ├─ prepare-draft.astro      # 【試作】平時の備え（8カード構成）
    ├─ prepare-hazard-draft.astro  # 【試作】地域のハザードを知る
    ├─ prepare-safety-draft.astro  # 【試作】安全を確保する
    ├─ prepare-damage-draft.astro  # 【試作】被害を減らす
    └─ prepare-bcp-draft.astro     # 【試作】BCP・事業継続力強化計画を作る
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

---

## 進行中：「平時の備え」セクション再構築（2026-06）

### 背景

旧 `/prepare` はカテゴリ別5グループだったが、**アクション指向の8カード構成**に再設計中。
各カードから詳細ページへリンクする構成。すべて `-draft` 付きの試作ページとして作成し、
完成後に正式ページへ差し替える想定。

### 8カードの一覧と進捗

| # | カード名 | アイコン | 試作ファイル | 状態 |
|---|---------|---------|-------------|------|
| 1 | 地域のハザードを知る | `map-pin` | `src/pages/prepare-hazard-draft.astro` | **完成** |
| 2 | 安全を確保する | `shield` | `src/pages/prepare-safety-draft.astro` | **完成** |
| 3 | 被害を減らす | `home` | `src/pages/prepare-damage-draft.astro` | **完成** |
| 4 | BCP・事業継続力強化計画を作る | `document` | `src/pages/prepare-bcp-draft.astro` | **完成** |
| 5 | 生活を守る | `box` | — | **未着手** |
| 6 | 訓練をする | `users` | — | **未着手** |
| 7 | 資金・保険を備える | `banknote` | — | **未着手** |
| 8 | 更に知りたい人へ | `book-open` | — | **未着手** |

### カード一覧ページ

- `src/pages/prepare-draft.astro` — 8カードのグリッド表示
- カードの `href` はすべて `#`（プレースホルダー）→ 詳細ページ完成後にリンクを更新する

### 各詳細ページの内容メモ

**1. prepare-hazard-draft（地域のハザードを知る）**
- 確認すべきハザード一覧表（地震・洪水・土砂・津波・高潮）
- 調べ方：Step 1（地震／J-SHIS・自治体被害想定・地震10秒診断）、Step 2（水害／ハザードマップポータル）
- 震度別：建物被害表・ライフライン停止期間表
- 浸水深別：被害目安表
- 事業停止期間の実績
- 最下部：ハザードマップリンク集（ポータル・わがまち・J-SHIS・10秒診断）

**2. prepare-safety-draft（安全を確保する）**
- 3セクション：安否確認手段 → 避難経路・避難場所 → 落下・転倒防止
- 各セクションに「やるべきこと」リスト
- ポイントボックス：災害用伝言ダイヤル(171)、「まずは職場を見渡す」
- 画像3枚（`public/images/`）：
  - `safety-anpi.png` — **アップ済み**
  - `safety-hinan.png` — **アップ済み**
  - `safety-tentoboushi.png` — **未アップ**（ユーザーがGitHub Web UIから上げる想定）

**3. prepare-damage-draft（被害を減らす）**
- 共通対策（バックアップ・書類保全・非常用電源・代替手段）
- 災害別対策：地震 → 水害 → サイバー攻撃（火災セクションは削除済み）
- 各災害セクション末尾に「対策の詳細・事例」参考リンクボックス
- 早期復旧のための備え（代替部品・代替調達先・復旧業者・相互応援協定・仮設営業）

**4. prepare-bcp-draft（BCP・事業継続力強化計画を作る）**
- Step 1 → Step 2 のフロー図（ティール→テラコッタ色分け）
- Step 1：事業継続力強化計画（ジギョケイ）——BCPとの比較表、認定メリット5つ、記載事項、申請の流れ
- Step 2：BCP——中核事業の特定→RTO→ボトルネック→事前対策→発動基準→復旧手順
- 策定のポイント（完璧を目指さない・経営者主導・取引先連携・定期見直し）
- 支援窓口（商工会議所・よろず支援拠点・中小機構・自治体補助金）

### 残り4ページの方向性（未確定・ユーザー確認が必要）

- **生活を守る**：備蓄（水・食料・衛生用品）、従業員の生活支援、帰宅困難者対策
- **訓練をする**：避難訓練、安否確認訓練、BCP発動シミュレーション、訓練の頻度と見直し
- **資金・保険を備える**：損害保険・共済の点検、手元資金の確保、災害時融資制度の事前把握
- **更に知りたい人へ**：外部リンク集、ガイドライン、自治体支援窓口の案内

### 正式化の手順（全ページ完成後）

1. `prepare-draft.astro` の各カードの `href` を詳細ページURLに更新
2. ファイル名から `-draft` を外すか、正式な URL 構成を決める（例：`/prepare/hazard`）
3. 旧 `prepare.astro`（カテゴリ別構成）を差し替え
4. ナビゲーション・パンくずのリンクを更新

---

## このセッションで行った変更（2026-06）

### アイコン単色化

- **`src/components/Icon.astro`**（新規）— アイコン名→SVGパスのマップコンポーネント。全アイコン `stroke="currentColor"`、24x24 viewBox。
- **`src/categories.ts`** — PILLARS/CATEGORIESの `icon` 値を絵文字→アイコン名文字列に変更
- **`src/pages/prepare.astro`** / **`recover.astro`** / **`faq/index.astro`** / **`faq/[id].astro`** — Icon コンポーネントに差し替え
- **`src/styles/global.css`** — `.ic` のスタイルをemoji前提からSVG対応に変更、`align-items` 修正

### 背景色の変更

- `--paper: #f5f1e8` → `#ffffff`
- `--paper-2: #efe9db` → `#f5f5f5`

### 画像ディレクトリ

- `public/images/` を新規作成（GitHub MCP経由で`.gitkeep`）
- PNG画像はGitHub Web UIから直接アップロード

---

## 開いている論点・次の候補

- [ ] **「平時の備え」残り4ページの作成**（生活を守る／訓練をする／資金・保険を備える／更に知りたい人へ）
- [ ] **試作ページの正式化**（`-draft` 外し、URL設計、旧prepare.astro差し替え）
- [ ] **`safety-tentoboushi.png`のアップロード**（ユーザー側作業）
- [ ] **独自ドメイン**（Cloudflare Registrar 想定／松下さん側で取得検討中）
- [ ] **SEO / OG 画像**（`og:image` 等の整備）
- [ ] **AI 相談（RAG）の検討着手**（第3フェーズ）
- [ ] **収集パイプライン**（第2フェーズ／GitHub Actions cron で支援情報の差分検知→PR起票）

## やり取りの好み（松下さんの指示スタイル）

- 短く端的。不明点は推測せず一言確認。
- 提案は **理由とトレードオフ** を添える。長い結論より「決められる材料」。
- レイアウト・文言の細かい差し戻しを歓迎する（"AIっぽさ" を嫌う）。
- 出典・根拠を曖昧にしない。災害支援は災害ごとに変わる前提を留保する。

---

このファイルが古くなったら、迷わず更新してよい（決定事項・URL・公開済み記事リスト等）。
