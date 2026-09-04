# CIQ セキュリティ強化計画（設計レビュー / 改善計画）

> ## 📌 Baseline（凍結）
> | 項目 | 値 |
> |---|---|
> | **Status** | **Completed** |
> | **Version** | **1.0（Baseline / 凍結）** |
> | **Last validated** | **2026-07-27** |
> | **Scope** | V1〜V13（Phase 1 / 2 / 3）— 対象コミット `9423c47`・レビュー日 2026-07-08 |
> | **判定** | Phase 1 ✅ / Phase 2 ✅ / Phase 3 ✅ → **親計画 V1〜V13 = Completed** |
>
> ### 凍結後の運用ルール（重要）
> 1. **本計画に V 番号を追加しない**（V14 以降を作らない）。**Phase 4 以降も作らない**。
> 2. 完了条件は**この時点で固定**する。以後の改訂は「実装手段の Superseded」など
>    **理由と Evidence を改訂履歴に残す場合のみ**行う（V13 の deno.lock がその例）。
> 3. 凍結後に発見した新規事項は、すべて末尾の
>    **「Additional Security Backlog（親計画外）」** へ積む。
> 4. 体系的な見直しが必要になったら、本書を増殖させず **「Security Plan v2」を新規作成**する。
>
> **狙い**: 新しい脆弱性を見つけるたびに親計画が膨らみ、「いつまでも完了しない」状態になるのを防ぐ。
> 親計画は「ある時点で立てた計画」であり、その完了は固定的に判定できるようにしておく。

> **本文書は唯一の親計画（single source of truth）。** P2-e1〜e5、backlog、RLS レビュー、contract/live test 等はすべて
> 子タスクであり、本計画を置き換えない。実装の現状は `docs/security-migration-status.md`（子タスクの実施記録）に記す。
>
> - 対象コミット: `9423c47` ／ レビュー日: 2026-07-08
> - レビュー範囲: `supabase/functions/**`, `supabase/migrations/**`, `js/**`, `*.html`
> - repo への persist: 2026-07-19（会話ベースだった親計画を正典化。以後 Claude Code / Codex / ZCode はこれを参照）
>
> **運用モデル前提（重要）**: CIQ は**単一サービス・単一大会運用**を前提とする（複数プロジェクト＝複数大会の同時運用は基本的に発生しない）。
> このため一般的なマルチテナント SaaS を想定した「project 単位の分離」は必須要件ではない。V4 のレート制限は **IP 単位**とする（後述）。

## 1. 脅威モデル

### 資産（守るべきもの）
| 資産 | 機密性 | 完全性 | 可用性 |
|---|---|---|---|
| 参加者 PII（暗号化 encrypted_pii） | ★★★ | ★★ | ★ |
| 復号鍵（プロジェクト RSA 秘密鍵） | ★★★ | ★★★ | ★★ |
| 答案画像（answer-pages / answer-cells バケット） | ★★★ | ★★★ | ★★ |
| 採点結果・最終順位（final_results） | ★★ | ★★★ | ★★ |
| 当日受付状態（checked_in） | ★ | ★★★ | ★★ |
| メール送信枠（Brevo/SES 無料枠・送信者レピュテーション） | ★ | ★★ | ★★★ |
| 管理者/採点者セッション（Supabase Auth JWT） | ★★★ | ★★★ | ★★ |

### 想定攻撃者
| ID | 攻撃者 | 動機 | 能力 |
|---|---|---|---|
| A1 | 匿名の外部者 | 荒らし・愉快犯 | 公開 URL・anon key・API 直叩き |
| A2 | 正規参加者（悪意） | 他人のなりすまし・優位取得 | 有効な email+パスワード・自分のトークン |
| A3 | 元運営メンバー（removed） | 私怨・データ持ち出し | 過去の Google アカウント |
| A4 | 中間者/端末共有 | セッション窃取 | 公共端末・肩越し・二次元コード スクショ |
| A5 | 供給網 | 広範囲改ざん | CDN・依存ライブラリ侵害 |

### 信頼境界
- ブラウザ ↔ Supabase Data API（anon/authenticated、RLS で防御）
- ブラウザ ↔ Edge Functions（service_role で実行、境界内で認証を自前検証）
- Edge Functions ↔ 外部メールプロバイダ（Brevo/SES）
- ブラウザ ↔ 第三者 CDN（jsDelivr / cdnjs / unpkg）

**設計上の良い前提（実装済み）**: 参加者の書き込み系は全て Edge Function 経由で service_role が状態再検証、RLS は全テーブル有効、機密列は authenticated から revoke 済み、ブラウザには publishable key のみ。基礎は堅い。以下は「数百〜数千人・一般公開」に上げるための差分。

## 2. 攻撃対象領域（Attack Surface）
| 面 | エンドポイント/経路 | 認証 | 備考 |
|---|---|---|---|
| 参加者登録 | create-entry | なし（公開） | CAPTCHA/IP制限なし → 大量登録可 |
| メール認証コード | send-email (send_verification) | なし | 任意宛先へ送信可（メール爆撃面） |
| 参加者ハブ | my-entry / edit-entry / cancel-entry / mark-late / disclose-result | email+pwハッシュ or 短命トークン | HMAC 署名鍵の設定が鍵 |
| 当日受付 | check-in / checkin-qr / admin-entry-qr | 運営 JWT / 署名付URL | 二次元コード 本体は素の entry UUID |
| 管理 | admin-create-entry / project-key | 運営 JWT（owner/admin） | RSA 秘密鍵の払い出し面 |
| Data API 直 | PostgREST projects/entries/... | anon/authenticated + RLS | RLS が最終防衛線 |
| Realtime | public_entry_list | anon（entry_open時） | entry UUID が公開される |
| フロント | 8 HTML ページ + 第三者 CDN | — | CSP あり・SRI なし |

## 3. 脆弱性一覧
各項目: 重大度 / 攻撃シナリオ / 影響 / 修正方針 / 対象ファイル / 優先度。

| # | 項目 | 重大度 | 攻撃シナリオ | 影響 | 修正方針 | 優先度 |
|---|---|---|---|---|---|---|
| V1 | HMAC 署名鍵のフォールバックが公開値/固定値 | Critical（要確認） | 本番で `CIQ_EMAIL_SIGNING_SECRET`/`CIQ_EDGE_INTERNAL_SECRET` 未設定だと署名鍵が `SUPABASE_URL`（公開）または固定文字列にフォールバック。攻撃者が同鍵で参加者トークンを自己発行しなりすまし。checkin-qr URL も偽造可 | 参加者認証の完全バイパス・PII/成績閲覧・編集・キャンセル | フォールバック削除・未設定なら起動時例外・本番 env に 32byte 以上のランダム秘密を必須化・鍵ローテーション手順を文書化 | P0 |
| V2 | メール送信オラクル（send_verification が無認証） | High | A1 が任意の `to` を指定し認証コードメール送信。レート制限は recipient_hash 単位（5通/10分）なので宛先を変えれば無制限 | メール爆撃、無料枠消費で全参加者へのメール停止、SPAM 認定 | IP/セッション単位のレート制限追加、Turnstile/hCaptcha を認証コード発行前に必須化、1プロジェクト日次送信上限、create-entry にも同様の制限 | P0 |
| V3 | 開示パスワード/メールが無塩 SHA-256 | High | DB 流出時、無塩ハッシュをレインボー/総当たりで復元・メール列挙 | 参加者アカウント奪取・PII 相関・メール逆引き | サーバ側で HMAC(pepper) 化。既存行は移行スクリプトで再計算 | P1 |
| V4 | 参加者認証のグローバル/IP レート制限なし | High | A1/A2 が複数 email_hash・複数 IP から並列で総当たり。失敗記録は email_hash 単位（10回/10分）のみ | 認証総当たり・列挙・DoS | **IP 単位**のレート制限層（Edge 冒頭で共通化）、超過で 429、生 IP を保存しない。※運用モデル前提により project 分離は不要（下記注記） | P1 |
| V5 | CORS Allow-Origin: * + API 直叩き耐性 | Medium | 全 Edge が全オリジン許可。任意サイトから叩ける | 自動化された乱用・スクレイピング・各攻撃の増幅 | 本番オリジンの allowlist 化、入力バリデーション強化、レート制限で実質担保 | P1 |
| V6 | エラーメッセージから内部情報漏洩 | Medium | 500 経路で `error.message` を返却。DB 制約名・SQL 断片が露出 | 内部スキーマ推測・攻撃の足がかり | 例外を分類し汎用文言（要確認 ID）のみ返す。詳細は console.error。共通ハンドラ化 | P1 |
| V7 | 二次元コード 本体が素の entry UUID（署名なし・使い回し無期限） | Medium | A4 が他人の 二次元コード を提示 → 運営端末が受付処理 | なりすまし受付・受付状態の完全性低下 | 二次元コード を HMAC(entryId+nonce+exp) 署名付きに、または受付時に受付番号照合を必須化 | P2 |
| V8 | 第三者 CDN スクリプトに SRI なし（供給網） | Medium | A5 が CDN 上のライブラリを改ざん → 任意 JS 実行 | XSS 相当・鍵/PII 窃取 | 依存をセルフホスト or SRI+版固定。CSP から不要 CDN 削除 | P2 |
| V9 | RSA 秘密鍵が localStorage 保持（XSS 時に露出） | Medium | XSS で `localStorage.privateKeyJwk` を窃取 → 全 PII 復号 | 全 PII 復号 | session 限定保持、CSP 強化、fetch 頻度最小化 | P2 |
| V10 | 参加者/service_role 操作が監査ログ外 | Medium | 参加者系は service_role 実行で `auth.uid()` null → 証跡が残らない | インシデント追跡不能 | service_role 用の監査挿入経路（種別=participant、IP/ID のみ、PII なし） | P2 |
| V11 | removed メンバーの JWT 失効はポリシー依存 | Low | 除名直後も JWT 有効期間中は認証が通る。check-in は `status <> 'removed'` のみ | 除名直後の短時間、権限残存 | check-in を owner/admin/scorer の active 明示に統一 | P3 |
| V12 | 大量登録（create-entry）へのボット対策なし | Low〜Medium | 自動で偽エントリ大量投入 | 枠占有 DoS・運営混乱 | CAPTCHA、メール認証コード完了を登録の前提に、1メール1エントリ制約＋IP レート | P2 |
| V13 | 依存の浮動バージョン（Edge 側） | Low | esm.sh の浮動指定。上流侵害/破壊的更新 | 予期せぬ挙動変化・供給網 | **（2026-07-26 改訂）** ①外部の直接依存を厳密なバージョンへ固定 ②浮動バージョン・latest・branch 指定を禁止 ③import 走査テストで固定状態を継続検証 ④依存関係を定期確認（付録D） ⑤deno.lock は **Superseded / Platform Constraint**（生成は可能だが、Supabase Edge Functions のデプロイ経路が lockfile をアップロード・参照しないことを実験で確認）| P3 |

## 4. 重大度ランキング
1. V1 Critical / 2. V2 High / 3. V3 High / 4. V4 High / 5. V5 Medium / 6. V6 Medium / 7. V7 Medium / 8. V8 Medium / 9. V9 Medium / 10. V10 Medium / 11. V12 Low〜Med / 12. V11・V13 Low

### 要確認事項（推測で実装しない）
- 🔲 本番に `CIQ_EMAIL_SIGNING_SECRET`（または `CIQ_EDGE_INTERNAL_SECRET`）が設定済みか（V1 の重大度の分岐点）→ **確認済み: 設定済み（2026-07-08）**
- 🔲 `PROJECT_KEY_ENCRYPTION_SECRET` の強度（32byte 以上か）
- 🔲 メールプロバイダ（Brevo/SES）の日次送信上限と現状の消費
- 🔲 public_entry_list を一般公開運用で使うか（entry UUID 公開の可否）
- 🔲 CAPTCHA 導入可否（UX 制約・学生団体の運用許容度）＝**外部サービス導入のため要ユーザー判断**

## 5. Phase 1 / 2 / 3 改善計画
- **Phase 1 — 「一般公開の前提条件」**（既存コード活用・破壊的変更なし）: V1 フォールバック撤去＋env、V2 IP レート＋CAPTCHA＋日次上限、V6 共通エラーハンドラ、V4 IP レート制限。
- **Phase 2 — 「多層防御・データ保護」**: V3 pepper、V5 CORS allowlist、V8 SRI/セルフホスト、V12 登録メール認証必須、V10 監査ログ。
- **Phase 3 — 「堅牢化・運用」**: V7 二次元コード 署名、V9 鍵 session 化、V11/V13 除名判定統一・依存固定、統合回帰テスト・可観測性。

## 5.1 実装状況（2026-07-26 更新・詳細は docs/security-migration-status.md）
- **V1 = Completed**（フォールバック撤去・未設定で例外・本番 env 設定済・鍵ローテ手順を付録A に文書化）
- **V2 = Completed**（IP レート＋日次上限＋**Cloudflare Turnstile をサーバ側検証で必須化**。付録C に運用・障害時手順）
- **V4 = Completed**（IP レート制限をアトミック化。本番で 25 並列→20 通過/5×429 を実証）
- **V6 = Completed**（共通 `serverErrorResponse`＝汎用文言＋ref、全 JSON Edge が使用）
- **Phase 1 判定 = ✅ Completed**（2026-07-26。V1・V2・V4・V6 すべて Completed）
- **V3 = Completed**（2026-07-26）。entries（P2-e1〜e5）に加え、`email_events.recipient_hash` と
  `participant_auth_events.email_hash` も HMAC(pepper) 化し、既存 95 行を in-place 再計算済み。
- **V5 = Completed**（2026-07-26）。CORS allowlist を fail-closed 化（'*' フォールバックを撤去し V1 と整合）。
- **V8 = Completed**（2026-07-26）。SRI + 厳密版ピン留めは既存、CSP から未使用 CDN を削除。
- **V10 = Completed**（2026-07-26）。service_role 経路の監査挿入経路は実装済みで、状態変更 6 操作すべてが
  actor_kind / HMAC 化 IP / 状態のみの after_data を記録（本番ログで実証）。追加実装は不要だった。
- **V12 = Completed**（2026-07-26）。CAPTCHA・メール認証必須・1メール1エントリ・IP レートの 4 条件は
  Phase 1（V2）と P2-e5 の成果で既に充足しており、追加実装は不要だった。
- **Phase 2 判定 = ✅ Completed**（V3 ✅ / V5 ✅ / V8 ✅ / V10 ✅ / V12 ✅）。
- **V7 = Completed**（2026-07-26）。二次元コード を署名付きトークン化（entryId.exp.sig）し check-in で検証、
  素の UUID は拒否。公開リストから entry UUID を列権限で除外し、受付 UI に受付番号フォールバックを追加。
- **V9 = Completed**（2026-07-26）。RSA 秘密鍵を localStorage から sessionStorage 限定保持へ（旧値は初回読出で移行・削除）。
- **V11 = Completed**（2026-07-26）。check-in を admin-* と同じ「active かつ owner/admin/scorer」に統一。
- **V13 = Completed**（2026-07-26・要件改訂の上で充足）。直接依存は厳密固定（浮動・latest・branch 指定 0 件）、
  import 走査の回帰テストで継続検証、定期確認手順を付録D に文書化。**deno.lock は Superseded / Platform Constraint**
  — 生成自体は可能（Deno 2.9.4 で npm 29 件・remote 11 件を integrity 付きで固定）だが、
  Supabase のデプロイ経路が lockfile をアップロード・参照しないことを実験で実証したため、
  具体的実装手段として置き換えた。残余リスクは付録D に明記。
- **Phase 3 判定 = ✅ Completed**（V7 ✅ / V9 ✅ / V11 ✅ / V13 ✅）。
- **親計画 V1〜V13 = ✅ 全て Completed**（Phase 1 ✅ / Phase 2 ✅ / Phase 3 ✅）。
- `projects.scorer_access_code_hash` の件は親計画の V 番号に追加せず、
  **Additional Security Backlog: Scorer access code hardening** として別管理（未着手）。
- `projects.scorer_access_code_hash` の件は親計画の V 番号に追加せず、
  **Additional Security Backlog: Scorer access code hardening** として別管理する。

## 6. 実装優先順位
- **P0（公開前必須）**: V1 → V2
- **P1（公開直後の初週）**: V6 → V4 → V3 → V5
- **P2（1か月以内）**: V8 → V12 → V7 → V10 → V9
- **P3（継続）**: V11 → V13 + テスト/監視整備

## 7. テスト計画（要旨）
単体（Vitest）／RLS・Grant（PostgREST 直叩き）／Edge（署名鍵未設定で起動失敗・無効トークン拒否・CORS 拒否・レート超過 429・CAPTCHA 無しで拒否）／認証バイパス回帰／メール乱用／二次元コード／回帰（`npm test`・`node --check`・`git diff --check`）。各 Phase 完了時に該当分をゲートにする。

## 8. ロールバック計画（要旨）
小さく可逆に。Edge は関数単位で旧版へ即時再デプロイ。migration は down 手順を用意し破壊的な列削除はしない（新列追加→二重書き→検証→切替）。CAPTCHA/レート制限は env フラグで ON/OFF。判断基準＝正規参加者エラー率・受付停止・メール不達で該当 Phase を revert。

## 9. 設計原則
1. フロント検証は UX のみ、認可は必ず Edge+RLS で二重化。2. 秘密鍵はブラウザに出さない・env フォールバックを持たない。3. 公開 API はレート制限＋CAPTCHA を前提に「直叩きされても壊れない」。4. すべての状態変更は監査可能。CAPTCHA・レート制限・監視は Supabase 無料枠＋Cloudflare 無料枠内で完結する構成とする。

---

## 付録A: 署名鍵ローテーション手順（V1 完了条件）

対象秘密: `CIQ_EMAIL_SIGNING_SECRET`（無ければ `CIQ_EDGE_INTERNAL_SECRET`）。用途＝参加者短命トークン・受付 二次元コード・
メール認証コードの HMAC 署名（`_shared/signing.ts`）。**32byte 以上（`openssl rand -hex 32` = 64 hex 文字）必須。**未設定/短すぎると
`SigningConfigError` で該当機能は停止する（fail-closed）。

手順（低トラフィック時間帯に実施）:
1. 新しい鍵を生成: `openssl rand -hex 32`
2. 本番へ投入: `supabase secrets set CIQ_EMAIL_SIGNING_SECRET=<new> --project-ref pyzdlkwumhreepgkrcyb`
3. 署名鍵を使う Edge Function を再デプロイして確実に反映:
   `send-email` / `checkin-qr` / `my-entry` / `edit-entry` / `cancel-entry` / `mark-late` / `disclose-result`
   （participant_auth 経由のトークン検証・二次元コード 再表示を含む）
4. 反映確認: `GET /functions/v1/checkin-qr?d=<uuid>&s=deadbeef` が **404**（＝鍵設定済み・長さ充足）を返すこと。503 なら未反映。

影響（不可逆な失効）:
- 旧鍵で発行済みの**参加者セッショントークンは全て無効化**→ 参加者は my.html で再ログインが必要。
- 旧鍵で署名済みの**受付 二次元コード URL・メール内 二次元コード は検証不能**になる → my.html は再表示で新 二次元コード を生成。配布済みメール内 二次元コード は無効。
- よってローテーションは大会当日直前〜当日は避ける（受付 二次元コード 失効を防ぐ）。

ロールバック: 旧鍵を `supabase secrets set` で再投入し、上記 Edge を再デプロイすれば旧トークン/二次元コード が再び有効化する
（旧鍵を安全に保管している場合のみ）。

## 付録B: メール日次上限（V2 backstop）の運用

- **対象**: 無認証の `send_verification` のみ（通知系＝確認/キャンセル/編集/遅刻/繰上げ・管理者トリガは **cap 対象外**。
  これらは宛先所有確認（`assertEntryRecipient`）・管理者認証・recipient_hash 制限で保護済み）。→ 上限到達後も正規通知は送れる。
- **窓/既定値**: rolling 24h・既定 **1000通/日**（`CIQ_EMAIL_DAILY_CAP` で上書き）。単一大会の1日あたり認証コード送信量を十分上回る値。
  大規模大会で不足する場合は事前に引き上げる。値の根拠は「暫定・運用で調整」。
- **超過時**: `send_verification` が **HTTP 429** ＋「本日のメール送信上限に達しました。しばらくしてから再度お試しください。」。
- **原子性**: `rate_limit_hit`（advisory lock）で並列でも上限突破不可。
- **当日使用数の確認（運営・service-role）**:
  ```sql
  select count(*) as used_24h
  from public.rate_limit_events
  where bucket = 'email_daily'
    and scope_key = 'project:ciq1'
    and created_at > now() - interval '24 hours';
  ```
- **緊急変更/実質解除**: `supabase secrets set CIQ_EMAIL_DAILY_CAP=<大きな値> --project-ref pyzdlkwumhreepgkrcyb` →
  `supabase functions deploy send-email`。障害時は本 cap 自体が fail-open（RPC 障害なら通過）なので、cap が受付を止めることはない。

## 付録C: Turnstile（CAPTCHA）の運用・障害時手順（V2）

### 構成
- 対象フロー: **`send_verification`**（認証コード送信・action=`send_verification`）と **`create-entry`**（登録確定・action=`create_entry`）。
- 検証: Edge が Cloudflare Siteverify へ POST（`_shared/turnstile.ts`）。**クライアントの成功状態は認可に使わない**。
  `success`・`action`・`hostname` を検証し、未指定/失敗/期限切れ/重複（`timeout-or-duplicate`）を拒否。可能なら `remoteip` を送る。
- 秘密情報: **`TURNSTILE_SECRET_KEY`（Supabase secret のみ）**。コード・クライアント・コミットには置かない。
  site key は公開値で `js/supabase_config.js` の `CIQ_TURNSTILE_SITE_KEY`。
- 許可ホスト名: `CIQ_TURNSTILE_HOSTNAMES`（カンマ区切り）。**未設定だと hostname 検証がスキップされるため、本番では必ず設定する。**
- CSP: `entry.html` に `script-src`/`frame-src` で `https://challenges.cloudflare.com` を許可（`unsafe-inline` は追加しない）。

### 失敗時の挙動（原則 fail-closed）
| 事象 | 挙動 | 利用者表示 |
|---|---|---|
| token 未指定 / 無効 / 期限切れ / 再利用 / action 不一致 / hostname 不一致 | **403 で拒否** | 「認証に失敗しました。ページを再読み込みして、もう一度お試しください。」 |
| Siteverify タイムアウト（5秒）・ネットワーク障害・Cloudflare 5xx | **403 で拒否（fail-closed）** | 同上（再試行可能） |
| `TURNSTILE_SECRET_KEY` 未設定 | **503 で拒否（fail-closed）** | 「ただいま…受け付けられません／送信できません」 |

内部の失敗理由（`error.code`）は**サーバログのみ**。利用者には内部情報を出さない。

### 可用性リスクと緊急回避手順
**リスク**: Cloudflare Turnstile / Siteverify の障害時、fail-closed のため**エントリー受付と認証コード送信が停止**する（大会当日なら受付不能）。
既存の多層防御（IP レート制限・日次上限・メール認証必須・1メール1エントリの一意制約）が残るため、CAPTCHA を一時停止しても防御はゼロにならない。

**緊急回避（恒常運用は不可・最短時間で戻す）**:
1. 障害を確認（Cloudflare Status / Edge ログの `turnstile rejected: unavailable` 多発）。
2. 一時バイパスを有効化:
   `supabase secrets set CIQ_TURNSTILE_DISABLED=1 --project-ref pyzdlkwumhreepgkrcyb`
   → `supabase functions deploy send-email` と `supabase functions deploy create-entry`
3. バイパス中は**必ず監視**（`rate_limit_events` の急増、`email_events` の異常な伸び）。必要なら
   `CIQ_RL_SEND_VERIFICATION_IP` / `CIQ_RL_CREATE_ENTRY_IP` / `CIQ_EMAIL_DAILY_CAP` を一時的に絞る。
4. 復旧後は**即座に解除**:
   `supabase secrets unset CIQ_TURNSTILE_DISABLED --project-ref pyzdlkwumhreepgkrcyb` → 上記2関数を再デプロイ。
5. バイパスの開始・終了時刻を記録し、`docs/security-migration-status.md` に追記する。

### 鍵ローテーション
Turnstile の site key / secret key を再発行した場合: Cloudflare で新 widget を作成 → `CIQ_TURNSTILE_SITE_KEY`（`js/supabase_config.js`、要 commit）と
`TURNSTILE_SECRET_KEY`（Supabase secret）を**同時に**更新 → `send-email` / `create-entry` を再デプロイ。
不一致の間は全リクエストが 403 になるため、低トラフィック時間帯に実施する。

## 付録D: Edge 依存の管理（V13 完了条件）

### D-1. 固定方針
- 外部の**直接依存は厳密なバージョン**（パッチ版まで）で指定する。
- **浮動バージョン（`@2` 等）・`latest`・branch 指定・バージョン未指定は禁止**。
- 現在の直接依存（全 Edge Function・2026-07-26 時点）:
  | 指定 | 用途 | 状態 |
  |---|---|---|
  | `https://esm.sh/@supabase/supabase-js@2.110.1` | Supabase クライアント（`_shared/supabase.ts`） | 厳密固定 ✅ |
  | `npm:qrcode@1.5.4` | 受付二次元コード画像生成（`_shared/qr.ts`） | 厳密固定 ✅ |
- ブラウザ側の supabase-js（各 HTML の SRI 付き script）と**同一バージョンに揃える**。

### D-2. 継続検証（自動）
`tests/edge_dependencies.test.mjs` が全 `supabase/functions/**/*.ts` の import を走査し、
- 浮動指定が 1 件でもあれば **CI 失敗**
- Edge とブラウザの supabase-js バージョン不一致でも **CI 失敗**

### D-3. 定期確認（手動・四半期ごと、および大会準備の開始時）
1. 現在の指定を一覧する:
   ```bash
   grep -rhoE "from '(npm:|jsr:|https://)[^']+'" supabase/functions/ --include='*.ts' | sort -u
   ```
2. 各依存の最新版・既知脆弱性を確認する（npm advisory / GitHub Security Advisories）。
3. 更新する場合は**バージョンを書き換えて** `npx vitest run` → 該当 Edge を再デプロイ → 主要経路を疎通確認。
4. 更新内容を `docs/security-migration-status.md` に記録する。
- **大会直前は更新しない**（当日運用のリスクを避け、直後の定期確認へ回す）。

### D-4. deno.lock — Superseded / Platform Constraint（2026-07-26 実証）
元の完了条件にあった「deno.lock 導入」は、**生成は可能だが現行プラットフォームでは適用不能**であることを
実験で確認したため、上記 D-1〜D-3 に置き換える。「実施しなかった」のではない。

**Evidence（実験結果）**
- **Deno 2.9.4** で本番と同じ依存の deno.lock 生成に**成功**。
  **npm 依存 29 件・remote 依存 11 件が integrity 付きで記録**された
  （記録されたのは公開パッケージの版とハッシュのみ。秘密値は含まれない）。
- 使い捨て Function に `deno.json` と `deno.lock` を同梱してデプロイしたところ、
  アップロードされた資産は **`deno.json` と `index.ts` のみで、`deno.lock` はアップロードされなかった**。
- lock 内の integrity を**意図的に破損させても、デプロイは成功**した（＝lock は検証に使われない）。
- **Supabase CLI に lock 適用オプションは存在しない**（`--import-map` / `--use-api` / `--no-verify-jwt` /
  `--prune` / `-j` のみ）。
- 検証用 Function は**削除し、元の 12 Function 構成へ戻した**（invoke 404・一覧に非存在を確認）。

### D-5. 残余リスク（親計画完了の必須残件ではない）
- `npm:qrcode@1.5.4` の**推移的依存には semver 範囲が含まれる**（`pngjs ^5.0.0` / `yargs ^15.3.1` /
  `dijkstrajs ^1.0.1`）。
- そのため**再デプロイ時に推移的依存の解決結果が変わる可能性を完全には排除できない**。
- **影響範囲は現在 二次元コード 画像生成に限定**される（`checkin-qr` / `my-entry` / `admin-entry-qr`）。
  参加者認証・DB アクセス・メール送信の経路には及ばない。
- **完全な決定性**を得るには、qrcode 依存の **vendoring** または**別実装への置換**が必要
  （vendoring 実測: remote 依存は `vendor/` に取り込めるが、`npm:` 依存は `node_modules/` に展開され
  関数資産に含まれないため、`npm:qrcode` の置換が前提となる）。
- 本項は**親計画完了の必須残件とはせず**、依存基盤（Supabase のデプロイ方式や Deno 対応）が変わった際に
  **再評価する技術的残余リスク**として扱う。

## 注記・変更履歴（親計画の改定ログ）

### 2026-07-26 — V13 の完了条件を正式改訂（deno.lock を Superseded / Platform Constraint へ）
**元の要件**: ①外部 import をパッチ版まで固定 ②**deno.lock を導入** ③依存関係を定期確認

**改訂後の要件**:
1. 外部の**直接依存を厳密なバージョンへ固定**する
2. **浮動バージョン・latest・branch 指定を禁止**する
3. **import 走査テスト**で固定状態を継続的に検証する
4. 依存関係を**定期確認**する（手順は付録D）
5. **deno.lock は Superseded / Platform Constraint** —
   Supabase Edge Functions のデプロイ経路が lockfile を**アップロード・参照しない**ことを実験で確認したため、
   具体的実装手段として①〜④へ置き換える

**位置づけ**: 「deno.lock を実施しなかった」のではなく、**「生成可能だが、現行プラットフォームでは
デプロイ時に適用不能であると実証した」**。Evidence と残余リスクは付録D に記載。

### 2026-07-26 — V7 の 二次元コード TTL を再評価（400日 → 既定30日・env 連動）
初回実装の TTL 400 日は「配布済み 二次元コード を壊さない」ための便宜的な値で、セキュリティ要件から導いたものではなかった。
二次元コード 画像は表示のたびに再生成されるため長期有効である必要は無く、長期を要するのは
メールクライアントのキャッシュ／保存画像が「登録 → 大会当日」を跨ぐ場合に限られる。
既定を **30 日**とし、`CIQ_QR_TTL_DAYS`（1〜400 にクランプ）で運用に合わせて短縮できるようにした。
期限切れ時の回復手段は (a) マイエントリーでの再表示（常に新しい 二次元コード）(b) 受付番号での受付。
`projects.period_end` が未設定のため大会終了日時への自動連動は採用せず、env による明示設定とした。

### 2026-07-26 — Additional Security Backlog を親計画から分離
`projects.scorer_access_code_hash`（無塩 SHA-256）の件は、親計画（V1〜V13）策定後に発見した追加課題であり、
**親計画の V 番号・Phase 構造には追加しない**。以後は「Additional Security Backlog: Scorer access code hardening」
として、親計画完了後に別枠で扱う。

### 2026-07-26 — V3 の対象範囲を明確化、採点者参加コードを別項目として分離
Phase 2 の V3 ゼロベース再監査（`docs/security-migration-status.md` 参照）で、`entries` 以外にも無塩 SHA-256 が
残存していることが判明した。V3 の完了条件「**email_hash も HMAC 化**」は entries だけでは満たされないため、
**V3 の対象に以下2つを含める**（判定は Partially Completed のまま）:
- `participant_auth_events.email_hash`（クライアント無塩 SHA-256(email)・レート制限台帳）
- `email_events.recipient_hash`（サーバ算出の無塩 SHA-256(email)・送信履歴）

`projects.scorer_access_code_hash`（無塩 SHA-256 の採点者参加コード）は V3 の原記述（開示パスワード/メール）に
含まれないため、**V3 には含めない**とした。
※ 当初は親計画の表に新しい V 番号として追記したが、Baseline 凍結（v1.0）に伴い
**親計画の V 番号からは削除**し、末尾の **Additional Security Backlog（AB-1）** へ移した。
凍結後の新規事項は親計画に V 番号を増やさず、そちらへ積む。

### 2026-07-19 — V4 の完了条件を IP 単位へ改定（運用モデルに整合）
初期計画は「IP + project 単位のレート制限」を想定していたが、これは一般的なマルチテナント SaaS 前提の設計だった。
**CIQ は単一サービス・単一大会運用を前提とするため、複数プロジェクトの同時運用は基本的に発生せず、project 単位の分離は不要。**
よって **V4 のレート制限は IP 単位とする**。V4 の完了条件を以下へ改定する（「IP × project であること」は完了条件から除外）:

- 同一 IP からの総当たり・列挙攻撃を防止できること
- 閾値超過時に 429 を返すこと
- 生 IP を保存せず、安全に追跡できること（HMAC 化した scope_key のみ保存）
- **並列アクセスでも制限を突破できないこと**
- 運用上、制限発動状況を確認できること

この改定に伴い、`participant_auth_events` への `ip_hash` 列追加は行わない（IP 追跡は `rate_limit_events` の HMAC scope_key で満たすため）。
現行実装（`rate_limit_events` + HMAC 化 IP scope_key + 共通 IP レート制限層）が上記を満たす部分は「初期案をより実運用に適した設計へ更新した（Superseded）」として扱う。

---

# Additional Security Backlog（親計画外）

> 親計画（V1〜V13 / Baseline v1.0）の**凍結後**に発見した事項を積む場所。
> **親計画の V 番号・Phase 構造には追加しない。** 着手の可否・順序は個別に判断する。

## AB-1. Scorer access code hardening → **招待リンク方式へ置換（Completed）**
| 項目 | 内容 |
|---|---|
| **Status** | **Completed** — 2026-07-27 |
| **発見** | 2026-07-26（V3 のゼロベース再監査中） |
| **監査で判明した真の問題** | 当初の記述「参加コードが短く低エントロピーで総当たり可能」は**誤り**（実測: 14文字・62種・CSPRNG＝約83bit）。実際の問題は **pass-the-hash**: `join_project_with_scorer_code` が**クライアント計算のハッシュを直接比較**していたため、保存値そのものが資格情報だった。`projects` の RLS は `is_project_member` で列権限にも当該列が含まれ、クライアントは `select('*')` していたため、**一度参加した採点者が値を読み出して第三者へ配布可能**。無効化・再発行の手段も無し |
| **採用した対応** | 現行方式の安全化ではなく、**認証方式そのものを招待リンクへ置換**（本番運用前のため破壊的変更を許容） |
| **新方式** | 管理者が上限人数のみ指定して招待リンクを発行 → Google ログインだけで採点者参加。トークンは Edge 内 CSPRNG(256bit)、DB には **HMAC のみ保存**（平文は発行応答に一度だけ）。**有効期限 7 日・role=scorer はサーバ側固定**。使用回数は条件付き UPDATE で原子的に加算。無効化(revoke)可 |
| **削除したもの** | `projects.scorer_access_code_hash` 列 / `join_project_with_scorer_code` RPC / 参加コードを受ける `create_project_with_owner` オーバーロード / 参加コード入力 UI / 参加コード生成処理 |
| **Evidence** | migration `202607270001_scorer_invite_links.sql`、Edge `create-scorer-invite` / `redeem-scorer-invite`、`_shared/invite_token.ts`、`join.html` / `js/join.js`、管理 UI（admin.html / admin_settings.js）、テスト `tests/scorer_invite.test.mjs`（19件）、commit `3ea2a9d` |
| **親計画との関係** | 親計画（V1〜V13 / Baseline v1.0）は**変更していない**。本項目は Additional Security Backlog として独立管理 |
