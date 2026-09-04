# CIQ

クイズ大会の「紙に関わる運営業務」を一気通貫で支援するプラットフォーム。

**エントリー受付 → 当日受付(二次元コード) → 解答用紙PDF生成 → 答案スキャン → 採点 → 成績照会** をブラウザだけで完結させます。

## 🏗 アーキテクチャ

```
Browser (静的HTML/JS)  ──── Supabase
                          ├── Auth: 管理者・採点者のGoogleログイン
                          ├── Postgres + RLS: projects / entries / scores
                          ├── Storage: answer-pages / answer-cells
                          ├── Realtime: エントリーリスト・採点状況
                          └── Edge Functions: 参加者公開フロー / SESメール送信
```

## 📁 ファイル構成

```
app/
├── index.html          # 入室(採点者参加/プロジェクト選択)・#create でプロジェクト作成
├── admin.html          # 運営ホーム(フェーズタイムライン)
├── judge.html          # 採点ボード(採点者メインページ)
├── question.html       # 個別問題の採点画面
├── conflict.html       # 採点不一致の確認・確定
├── checkin.html        # 二次元コード当日受付
├── entry.html          # エントリーフォーム（公開）
├── my.html             # マイエントリー（公開・確認/二次元コード/編集/遅刻/成績/キャンセル）
├── entry_list.html     # エントリーリスト（公開）
├── terms.html          # 参加規約（大会ごと・公開）
├── help.html / 404.html
├── css/
│   ├── design_system.css   # デザイントークン+共通コンポーネント
│   └── pages.css           # シェル+ページ固有
├── js/                 # ページスクリプトと共有モジュール(my.js など)
├── fonts/              # PDF生成用フォント（Web表示はシステムフォント）
├── aruco_markers/      # 回答用紙用マーカー画像 (4枚)
├── design-system/      # デザインシステム文書(MASTER.md)
└── supabase/           # DB migrations / Edge Functions(my-entry ほか)
```

## 🚀 ローカル起動

```bash
cd app
python3 -m http.server 8080
```

http://localhost:8080/index.html にアクセス。

> **注意**: Supabaseへの接続が必要です。オフラインでは動作しません。

## 🔧 Supabase セットアップ

1. Supabaseプロジェクトを作成
2. `supabase/migrations/` を順番に適用
3. Supabase AuthでGoogleログインを有効化
4. 本番/共有環境では `js/supabase_config.js` にProject URLとpublishable keyを設定
5. ローカル専用の上書きが必要な場合は `js/config.local.js` を作成（未コミット）
6. メールを使う場合はEdge Function SecretsにSES設定を追加

## 🧪 開発時チェック

```bash
npm test
find js -name '*.js' -exec node --check {} \;
git diff --check
```

## 📋 運用フロー

1. **プロジェクト作成**: `index.html#create` → 回数入力 → ID/採点者用パスワード発行
2. **準備**: 運営ホーム「準備」→ 問題数設定 → 解答用紙PDF生成・模範解答登録
3. **公開**: 運営ホーム「公開」→ エントリー受付ON/期間・定員 → 共有リンク4本を配布
4. **当日**: `checkin.html` → 参加者が画面に二次元コードをかざして受付
5. **採点**: 運営ホーム「採点」→ 答案PDF取込 → `judge.html` で3名独立採点 → 不一致は要確認で確定
6. **結果**: 運営ホーム「結果」→ 全問確定 → 成績照会を公開(参加者はマイエントリーから確認) / CSV・PDF出力

## 📄 ライセンス

Private
