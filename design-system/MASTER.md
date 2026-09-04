# CIQ Design System — MASTER (Global Source of Truth)

> 2026-07 Swift App UI 全面刷新(v5)。2026-07-28 に認証体験・メッセージ階層・角丸/影トークンを再設計(v6)。
> このファイルが全ページ・全コンポーネント・HTMLメールの唯一の設計根拠。

---

## 1. サービス定義

**CIQ は、クイズ大会における「紙に関わる運営業務」を一気通貫で支援するプロダクトである。**
対象: エントリー受付 → 当日受付(二次元コード) → 解答用紙PDF → 答案スキャン → 複数採点者による採点と不一致解決 → 集計・成績照会・記録出力。
提供価値は「誤採点・誤公開・受付の滞留・個人情報漏えいを構造的に防ぐこと」。

コピー: 「クイズ大会のペーパー運営を、エントリーから成績返却まで。」
(「紙のクイズ大会」という表現は使わない)

### プロダクト原則
1. **Never lose an answer** — 答案・採点データの完全性が最優先
2. **Calm operations** — 次の一手が常に見える。本番中の運営者を慌てさせない
3. **Respect the contestant** — 参加者(多くは中高生)に誠実・簡潔
4. **Private by default** — 個人情報・答案画像は公開面に出さない

## 2. サイトマップ / IA

```
入口       index.html(採点者参加・プロジェクト選択 / #create で作成モード)
運営(認証)  admin(フェーズタイムライン) / judge(採点ボード) / question / conflict / checkin / help
参加者(公開) entry / my(マイエントリー・ハブ) / entry_list / terms / 404
削除済み    create.html(index統合) / edit・cancel・late・disclosure.html(my統合・互換なし)
```

- プロジェクト作成は `index.html#create` のみ。参加者ページから作成導線には到達できない。
  作成ゲートは `canCreateProject()`(js/index.js)の1点 — 将来の招待コード/許可ユーザー制の差し込み口。
- 参加者のセルフ操作(確認/二次元コード/編集/遅刻/成績/キャンセル)は my.html に集約。認証は1回。
- 共有リンクは4本(エントリー/リスト/マイエントリー/規約)。二次元コードは当日受付専用で
  「確認メール・my.html・代理エントリー控え」の3箇所にのみ存在する。

## 3. 参加者認証(my.html)

- `my-entry` Edge Function: ハッシュ照合 or **短命署名トークン**(HMAC, TTL30分, 操作ごとスライド延長)。
- トークンとメールアドレスは **sessionStorage**(タブクローズで消滅・共有端末配慮)。
  **パスワード平文/ハッシュ・復号PIIはいかなるストレージにも保存しない**。ログアウト導線常設。
- 総当たり対策: `participant_auth_events` テーブルで失敗回数を10分窓で制限。
- 二次元コードはメールと同一データ(entry.id)・同一生成器(`_shared/qr.ts`)なので受付でそのまま読める。

## 4. 各画面の主役と次の行動

| 画面 | 最初に見る情報 | 次の行動 |
|---|---|---|
| index | CIQが何か(タグライン) | 役割に応じて入室 |
| admin | 現在フェーズ(タイムライン) | 開いているフェーズの主ボタン |
| judge | 続きから採点する | 1タップで再開 / 空き問題 |
| question | 問題番号+模範解答 | M/X/H で判定 |
| checkin | カメラ(かざす枠)と判定 | かざすだけ・連続処理 |
| entry | 大会名+現在ステップ | 常に1つのボタン |
| my | 受付番号+二次元コード | 目的の1操作(編集/遅刻/成績/キャンセル) |
| entry_list | ◯名がエントリー(定員) | 自分の枠・出場圏内を確認 |

## 5. ビジュアル方針 — CIQ as a Swift App

紫・青紫・グラデーション・グロー・ネオン・カード乱用・アイコン過多・影の多用は**禁止**。
装飾ではなく、余白・罫線・タイポグラフィ・階層で見せる。1画面1主役。CTAは少数精鋭。
最終的な質感は「SwiftUI/UIKitで作ったCIQアプリをWebへ移植したように見える」ことを目指す。

### 全画面共通のSwiftアプリ言語

- 公開・運営・採点で別方針に分けない。全ページを同じSwiftUI/UIKit系CIQアプリの画面として扱う。
- 入口、フォーム、一覧、採点、受付、ヘルプ、通知、警告、メールは同じ grouped surface / toolbar / sheet / popover / segmented / list row / form section / status panel の言語で統一する。
- 画面ごとの差は「用途に応じた密度差」だけにする。読む/入力する画面は自然に狭く、一覧/採点/受付/集計は1600pxまで広がるが、部品の見た目や操作感は同じ。
- Apple.com的な強い見出しや余白、macOS/iPadOS的な作業密度は分離せず、同じSwiftアプリの中で必要に応じて使う。
- Liquid Glass 風の装飾は採用しないが、Apple製品UIに近づけるため、`app bar / drawer / notification / modal / popover` のような浮遊UIに限って控えめな半透明materialとblurを許可する。
- 通常の本文カード、表、フォーム、list row、terms本文、admin phase blockにはblurを使わない。これらは opaque surface + hairline + spacing で階層を作る。
- 参照軸は Apple HIG / SwiftUI Form / UIKit grouped table / iOS・macOS通知 / Apple Mail の質感。Webランディングと運営UIを別アプリに見せることは禁止。

### Color Tokens(light / dark, `prefers-color-scheme`)
```
Background  #FFFFFF / #000000        Surface-2  #F5F5F7 / #2C2C2E
Text        #1D1D1F / #F5F5F7        Sub        #6E6E73 / #AEAEB2
Border      #E5E5EA / #38383A        強調線     #D2D2D7 / #48484A
Primary     #1D1D1F / #F5F5F7        — 主CTAのみ(白黒を維持)
Apple Blue #0066CC / #2997FF        — リンク・選択・フォーカスのみ。面では広く塗らない
Accent Soft #F5F9FF / #071D33       — 選択状態の背景のみ。強い青面を避ける
Switch On #34C759 / #30D158         — iOS/macOS標準に合わせ、トグルONのみ緑
Success #248A3D / Warning #BF6A02 / Destructive #D70015 — 状態表示限定・面塗り最小(左罫+文字中心)
On semantic #FFFFFF / #000000 — 状態色を面に使う場合の前景色
Gold #A05A00 / #FFD60A — 成績・順位の1点のみ
```

- `ink-2` を意味のある補足文とplaceholderに使う。`ink-3` は disabled、装飾、非主要アイコンに限定する。
- 状態は色だけで伝えず、テキスト、アイコン、配置のいずれかを必ず併用する。
- **片側だけ太い色付き罫線を付けた通知枠は全面禁止**(`border-left: 3px` 等)。
  面のティントは `--tint-neutral` / `--tint-ok` / `--tint-warn` / `--tint-bad` / `--tint-accent` を使い、罫線は必ず全周1pxにする。

### Typography(Webフォント読込なし・Apple system stack)
```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
             "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN",
             "Yu Gothic", "Noto Sans JP", sans-serif;              /* 見出し */
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue",
             "Hiragino Sans", "Hiragino Kaku Gothic ProN",
             "Yu Gothic", "Noto Sans JP", sans-serif;              /* 本文 */
font-family: ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, monospace; /* 受付番号・ID・コード専用 */
```
- H1 26–40px/700(1画面1つ) / H2 21–26px/600 / H3 18px/600(H4以下は極力使わない)
- `.hero-title` と `.hero-subtitle` は「入口専用のLP部品」ではなく、強い導入が必要なアプリ画面用の共有見出しとして扱う。運営/採点でも必要なら同じトーンで使える。
- 本文 16px/400/lh1.7、補足 13px/400/Sub色、ボタン 15px/500–600、フォーム入力 ≥16px
- テーブル: セル14px、ヘッダ12px/600/+0.06em
- Canvas生成画像も同じApple stackを使い、`IBM Plex` / `Inter` などの外部フォント前提にしない。
- **mono は受付番号・パスワード・プロジェクトID・認証コード・技術的ID専用**。人数、問題番号、進捗、スコア、順位、日付時刻、404など通常UIの数字は system font + `tabular-nums` にする。本文・見出しへのmono使用は禁止。
- 優先順位はサイズではなく余白・ウェイト・濃淡で。見出し前の余白は後ろの2倍

### Material / Radius / Elevation / Motion / Layout
- 角丸は3段階のみ。`--r-control` 8px(ボタン/入力/選択/チップ) / `--r-surface` 12px(セクション/リスト/パネル/notice) / `--r-overlay` 16px(モーダル/ドロワー/ポップオーバー/トースト)。
  `--r-full` はスイッチのトラックと円形アイコンボタンだけに使う。ボタンをピル型にしない。
  9/13/18/22/26/28/30px のような中間値を新たに足さない。値は必ずトークン経由で参照する。
- 面は plain section / grouped surface / overlay の3役に限定する。Grouped list は単一の外枠と行間の hairline で構成し、行ごとの入れ子カードを作らない。
- 情報量が少ない要素(状態表示・空状態・エラー)をカードで囲わない。ページの状態としてそのまま置く。
- 浮遊UIのみ material token を使う。`--material-toolbar` / `--material-popover` / `--material-modal` / `--material-notification` と `--material-blur` が許可範囲。
- 影は浮遊UIの分離用途に限定する(`--sh-3` のみ)。通常面は1px罫線と余白で表し、内側の白ハイライト(ベベル)も使わない。
- Motion 150–250ms fade/slide のみ。`prefers-reduced-motion` 全停止
- 幅: ログイン・本人確認・フォーム・ヘルプ/規約本文は集中できる狭幅(概ね520〜840px)を維持する。admin、一覧、管理表、答案、集計、採点ボード、チェックインなど作業面は1600pxまで広げる。ただし1600px未満の画面でも端ギリギリにはせず、wide系は左右に十分なgutterを取る。これは方針差ではなく密度差であり、見た目の部品体系は同一。タッチターゲット44px。フォーカスリング3px
- Z: sticky10 / appbar20 / dropdown30 / drawer40 / modal50 / toast60 / max70

### Accessibility

- 全ての操作はキーボードで到達・実行でき、見た目が小さい操作もヒット領域を44px以上にする。
- フォーカスは Apple Blue の3px outline + 2px offset。複合入力は `:focus-within` でグループの焦点も示す。
- 本文は4.5:1以上、非テキストとフォーカスは3:1以上を維持する。意味のある補足に低コントラスト色を使わない。
- `prefers-reduced-motion: reduce`、`prefers-contrast: more`、`forced-colors: active` に対応し、200%ズームで情報や操作を欠落させない。

### Icons
- Web上ではSF Symbols本体を同梱しない。`js/icons.js` は既存のCIQ論理名をLucide SVGへ解決するアダプタとする。
- HTML/JSからは `createIcon('trash')` / `data-icon="trash"` のようなCIQ論理名だけを使い、Lucideの実名は `ICON_ALIASES` に閉じ込める。
- Lucideは必要なSVG node dataだけをローカルにバンドルし、ランタイムCDNへ依存しない。ライセンスは `assets/vendor/lucide/LICENSE` に保持する。
- 新しいアイコンが必要な場合はLucideから対応名を選び、`ICON_ALIASES` とバンドル済みnode dataを同期する。`currentColor` / `fill="none"` / `stroke-width="2"` / `round cap+join` を維持する。
- 欠落アイコンを `circle-question` のまま放置しない。四角表示・途切れ・異なる太さを見つけたらレジストリ側で直す。

## 5b. メッセージ階層(3段階のみ)

通知・警告・エラーを「派手なカードの色違い」で処理しない。強さは**面の有無**で表す。

| 段階 | クラス | 見た目 | 使いどころ |
|---|---|---|---|
| field note | `.field-note` | 面もアイコンも無し。13px/ink-2 | 入力欄直下の補足。対象への近さが意味を作る |
| inline | `.page-msg` / `.status-msg-box` / `.entry-verify-help` / `.csv-status` ほか | 面無し。アイコン + 本文 | 補足・進行中・成功・警告。本文として読ませる |
| notice | `.notice` / `.entry-mail-notice` / `.terms-alert` | `--tint-neutral` 面 + 12px角丸。全周罫線 | 読み飛ばされると困る案内。**1画面1つまで** |
| toast | `.toast` | 浮遊material | 操作結果の一時通知 |
| page state | `.empty-state` / `.loading-state` / `.error-state` | 面無し。見出し + 次の行動 | 領域全体が空/読み込み中/失敗のとき |

- **面を持つのは error と notice だけ**。error(`--tint-bad` + 全周hairline)は「ユーザーの操作が止まる唯一の状態」なので面を与える。
- `setPageMessage()` が種別ごとに固有アイコン(success=circle-check / warning=triangle-exclamation / error=circle-exclamation)を付ける。info は本文として読ませるためアイコンを付けない。
- `.error-state` はページ全体を赤くしない。見出しは ink、アイコンだけ `--bad-600`。

## 5c. 認証シェル(index / join 共通)

ログイン画面と招待画面は**同一の認証体験**として1つのシェルを共有する。

```
body.page-auth (grid: 1fr / auto, 地色は --canvas-flat)
  main.auth          … .auth-brand → .auth-title → .auth-lede → .auth-action → .auth-note
  nav.auth-links     … 第2行に固定。上に要素が固まり下に空白が残る構成を作らない
```

- 認証画面はカードを置かない。認証はカードの中の作業ではなく**ページそのもの**。
- Google認証は `.btn-google` **1実装のみ**。`css/design_system.css` にだけ定義し、`css/pages.css` では再定義しない。
  高さ48px / 幅100% / `--r-control` / `--surface` / 15px 600 / Gマーク18px / gap 10px / hover・active・focus-visible・disabled・`aria-busy` を共有。
- 文言は認証操作として一貫させ、既定は「Googleで続行」。画面ごとに変えない。サインアウトはGoogleブランドのボタンにしない。
- 招待画面は「大きな通知カード + その下にボタン」の構造を取らない。役割と結果は本文コピーで伝え、状態(確認中/参加済み/失効)だけを inline message で示す。
- 未ログインは異常ではなく既定の入口なので、ボタンの上に状態メッセージを重ねない。
- `Powered by CIQ` フッターは全ページから廃止。大会名が主役であり、CIQのクレジットは画面の仕事をしていなかった。

## 6. 運営共通シェル

- 全運営ページ同一のアプリバー(戻る / 大会名+現在位置 / メニュー)とドロワー。
- **ロール別**: 戻る先は管理者→admin、採点者→judge(`opsBackTarget()`)。ドロワー項目もロールで出し分け。
  権限のないページへの導線は表示しない。
- 集中モード(question/checkin): バー縮小・メニュー非表示。ただし現在位置と戻りは常に見える。

## 7. HTMLメール

- サイトと同一トーン(白ボディ・near-black見出し・neutral罫線・白黒の主CTA・Apple Blueのリンク)。Apple Mailで自然に見える600px前後のテーブル+インラインCSS。
- 角丸は16–20px、CTAはpill、本文は短く、状態パネルは面塗りを避ける。メールクライアント互換のためメール内ではblurを使わない。
- 基本CTAは[マイエントリー]に集約。エントリー完了メールのみ[マイエントリー]と[エントリーリスト]を横並びで置く。キャンセル完了はCTAなし。
- エントリー完了メールに必須: 受付番号(mono大) / 当日受付二次元コード / パスワード / マイエントリーCTA /
  保存文言「このメールには受付二次元コードとマイエントリー用の情報が含まれます。大会当日まで保存してください。」
  +「二次元コードはマイエントリーからも再表示できます」。
- 状態パネルは面塗りせず左罫3px+状態色文字。

## 8. 実装アーキテクチャ

- `css/design_system.css` = トークン+共通コンポーネント / `css/pages.css` = シェル+ページ固有。場当たりCSS禁止。
- **トークンの `:root` は design_system.css に1ブロックのみ**。「refinement pass」「page pass」「final override」のような後段レイヤーで
  同じセレクタを再定義しない。値を変えたいときは元の定義を直す。旧実装を互換のために残さない。
- クラス語彙はJSが参照するコンポーネントAPI。変更はJSと同期して行う。
- Edge Functions: `my-entry`(新設) / `_shared/participant_auth.ts`(トークン・レート制限) /
  edit-entry・cancel-entry・mark-late・disclose-result(トークン経路追加) / send-email(再設計)。
- 不変条件: 静的HTML+vanilla JS+Supabase / CSP / textContent方針 / RLS前提 / DB変更はマイグレーション。

### CSS Ownership

- `css/design_system.css` owns generic UI: buttons, cards, form controls, badges, messages, steps, definition lists, modals, tables, empty/loading states, workbench cards, scoring controls, and touch/focus behavior.
- 小規模な選択は実体としての `<select>` を保持しつつ、共有JSでApple風のカスタムselect表示にenhanceする。元selectの `change` 契約、required、フォーム値は維持する。
- `css/pages.css` may only define page shells, page layout, content typography, and workflow exceptions that cannot be expressed as a shared component variant.
- Allowed page-specific exceptions include: index/login composition, admin phase layout, entry list responsive layout, terms Markdown article layout, check-in camera/result workflow, answer-prep PDF tooling, and one-off spacing overrides around shared components.
- If a page-specific class starts looking reusable across two pages, promote it to `css/design_system.css` before adding a second definition.
- Page-specific overrides must use design tokens and must not introduce new colors, shadows, gradients, radii, or button/message variants.
