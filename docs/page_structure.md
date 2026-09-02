# Page Structure

## 入口

- `index.html`: 採点者・運営メンバーの入室(Google認証 → プロジェクト選択 / ID+パスワード参加)。
  プロジェクト作成は `index.html#create` でのみ到達する(参加者導線には出さない)。
  旧 `create.html` は index に統合済み(削除)。

## 運営ページ(認証・共通シェル)

- `admin.html`: 運営ホーム。フェーズタイムライン(準備→公開→当日→採点→結果+設定)。
- `judge.html`: 採点ボード。「続きから採点する」+ 状態別整列。
- `question.html`: 採点ワークベンチ(集中モードシェル)。
- `conflict.html`: 要確認レビュー。
- `checkin.html`: 当日受付。ラップトップを置き参加者がQRをかざす前提(大カメラ+大判定・履歴なし)。
- `help.html`: 運営ヘルプ。

戻る導線はロール別: 管理者→`admin.html` / 採点者→`judge.html`(`opsBackTarget()` in `js/ui.js`)。

## 参加者ページ(公開)

- `entry.html`: エントリー(①本人確認 → ②入力 → ③完了)。
- `my.html`: **マイエントリー(参加者ハブ)**。1回の認証で 登録内容の確認 / QR再表示・保存 /
  編集 / 遅刻連絡 / 成績照会(公開期間のみ) / キャンセル(分離配置)。
  旧 `edit.html` / `cancel.html` / `late.html` / `disclosure.html` は my.html に統合済み(削除・互換なし)。
- `entry_list.html`: 公開エントリーリスト。枠列(#順位)と区切り行で並び順が分かる。中部枠はエントリー開始から24時間で、「中部地方（開始24時間以内）」「以降 中部地方以外（開始24時間以内）」「以降 開始24時間経過後（先着）」「以下キャンセル待ち」の4種類。
- `terms.html`: 大会ごとの参加規約(`?pid=`)。
- `404.html`

## 参加者認証(my.html)

- `my-entry` Edge Function が emailHash+パスワードハッシュ照合 or 短命トークン(HMAC・30分・スライド延長)で認証。
- トークンは sessionStorage 保持(タブクローズで消滅)。パスワード平文/ハッシュは保存しない。
- `edit-entry` / `cancel-entry` / `mark-late` / `disclose-result` はトークン経路を追加受理
  (`supabase/functions/_shared/participant_auth.ts`)。

## Script Pairing

- `entry.html` -> `js/entry.js`
- `my.html` -> `js/my.js`
- `entry_list.html` -> `js/entry_list.js`
- `question.html` -> `js/question.js`

Shared helpers live in `js/shared.js`, `js/ui.js`, `js/config.js`, `js/supabase_client.js`, and `js/supabase_api.js`.

## 共有リンク(admin「公開」フェーズ)

エントリーフォーム / エントリーリスト / マイエントリー / 参加規約 の4本。
当日受付QRは共有リンクではなく、確認メール・my.html・代理エントリー控えにのみ存在する。

## Wording Rules

- Use "エントリー" for registration.
- Use "当日受付" for event-day check-in.
- Use "受付番号" only for participant numbers.
- Use "成績照会" consistently for result disclosure.
- Use "マイエントリー" for the participant hub (my.html).
