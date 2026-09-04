# Security Migration Status — 参加者ハッシュ v1→v2 移行と残件

この文書は、参加者認証ハッシュの **無塩 SHA-256 (v1) → pepper 付き (v2)** 移行（社内呼称 P2-e1〜P2-e5）の
正式な記録であり、以後のセキュリティ作業の **正典（single source of truth）** とする。
P2-e1〜P2-e5 は会話ベースで設計・レビュー・実装したため元々 repo に計画書は存在しなかった。本文書化以降は、
Claude Code / Codex / ZCode いずれのエージェントも本ファイルを参照して継続すること（セッションの記憶に依存しない）。

- 対象テーブル: `public.entries`
- 対象の旧列: `email_hash` / `disclosure_password_hash`（クライアントの無塩 SHA-256）
- 置換後: `email_hash_v2` / `disclosure_password_hash_v2`（Edge 内 pepper 化。クライアント供給 v2 は信用しない）
- 独立用途で **維持**（本移行の対象外）: `participant_auth_events.email_hash`（レート制限キー）、
  `email_events.recipient_hash`、メール認証トークンの hash（`_shared/email_verify.ts`）

> 検証強度の表記: **観測**=本番/検証環境で実際に駆動して確認 / **静的**=コード・定義・diff で確認 /
> **状態証跡**=現在の DB/デプロイ状態が結果を裏づける。P2-e5 は本セッションで詳細検証済み。
> P2-e1〜e4 は各実施セッションで対応済みで、本文書は commit/migration の実証跡に基づき再構成した
> （**P2-e2 / P2-e3 / P2-e4 の境界は当時ラベル未記載**のため、下記の段階区分は commit 証拠からの再構成。
> migration は "P2-e4" のみ明記あり）。

---

## 1. 移行フェーズ（P2-e1〜P2-e5）

### P2-e1 — v2 受け皿の追加（非破壊）
- **実施**: `entries` に `email_hash_v2` / `disclosure_password_hash_v2` 列と検索用の**非 unique** index
  `entries_email_hash_v2_idx` を追加。`create_entry_atomic` を v2 引数付きの単一関数へ置換（overload を残さない）。
  `_shared/participant_hash.ts` を**休眠モジュール**として追加（この時点では import しない）。
- **完了日**: 2026-07-12
- **commit**: `e4764fe` (Add participant hash v2 foundation)
- **migration**: `202607080005_participant_hash_v2.sql`
- **deploy**: DB migration のみ（Edge 挙動変化なし）
- **検証**: 追加のみ・既存列/データ/旧 index 不変（静的）

### P2-e2 — dual-write 配線（entry 作成で v2 も書込開始）
- **実施**: `create-entry` / `admin-create-entry` が pepper 化 v2 を生成し、旧列と v2 を**両方書込（dual-write）**するよう配線。
- **完了日**: 2026-07-12
- **commit**: `62a1e2e` (Dual-write participant hash v2 on entry creation)
- **deploy**: `create-entry` / `admin-create-entry`（dual-write 開始）
- **検証**: 以後の新規行は旧列と v2 の両方を保持（状態証跡）
- **注**: フェーズラベルは当時未記載。commit 証拠から再構成。

### P2-e3 — v2 移行完了（backfill・v2 主体への切替準備）
- **実施**: 既存行の v2 を一度だけ埋める内部 backfill 関数を導入・実行し、完了後に撤去。
  dual-write の定常化とあわせ、**全行で v2 が揃い v2 主体へ切替可能な状態を確立**（この時点では認証はまだ旧経路主体）。
- **完了日**: 2026-07-12〜14
- **commit**: `9f895bb` (Add temporary participant hash backfill function) /
  `2e307ee` (Allow one-time internal participant hash backfill) /
  `9c75e09` (Remove temporary participant hash backfill function)
- **deploy**: backfill 関数の一時導入 → 実行 → 撤去（恒久 Edge の挙動変化なし）
- **検証**: 全行で v2 両列が非 NULL＝backfill 完遂（状態証跡：現在 v2_null=0）
- **注**: フェーズラベルは当時未記載。commit 証拠から再構成。

### P2-e4 — 認証・キャンセル経路の v2 切替
- **実施**: `_shared/participant_auth.ts` を導入し、**credential 認証を v2 化**（当初は旧列 fallback つき、0 件と DB エラーを区別する
  v2 lookup の堅牢化）。**token 認証を id 経路化**し、認証済み entry を id で扱う `cancel_entry_by_id_atomic` を追加して
  `cancel-entry` を id 経路へ移行。security event テーブルへの service_role 付与を補正。
  → **参加者の認証・キャンセルの主経路が v2 / id へ切り替わったのはこのフェーズ**（v1 旧列はまだ存在＝fallback 可）。
- **完了日**: 2026-07-14
- **commit**: `d49511e` (Use participant hash v2 for credential authentication) /
  `d674abc` (Fix participant v2 credential lookup zero-row handling)
- **migration**: `202607140001_cancel_entry_by_id_atomic.sql` / `202607140002_grant_service_role_security_events.sql`
- **deploy**: `my-entry` / `edit-entry` / `cancel-entry` / `mark-late` / `disclose-result`
- **検証**: v2 credential 認証が成立、id 経路キャンセル稼働（当時セッションで対応）
- **注**: e2/e3/e4 の境界ラベルは再構成。migration は "P2-e4" と明記。

### P2-e5 — 旧列依存の撤去と物理削除（本セッション・2026-07-17）
本フェーズは ①reader / ②writer / ②.5 遊休ゲート / ③撤去 の順で実施。**詳細検証済み**。

- **①-a reader（participant_auth）**: credential=v2 単独（旧列 fallback 撤去）、token=署名検証済み `entryId` を
  `id + project_id` で解決（旧 `email_hash` 照合を撤去、token 形式不変）。commit `a2bcd4d`。
- **①-b reader（send-email / list / フロント）**: `send-email` は送信先メールから Edge 内で v2 生成し
  `email_hash_v2` と直接照合（**caller 供給 hash 非依存**）。`list_entries_for_admin` は hash を返さない。
  フロント（email.js / my.js / admin*.js / entry.js）は send-email へ hash を送らない。
  commit `ae2666b` / `6410d58`、migration `202607140003_list_entries_for_admin_drop_email_hash.sql`。
- **② writer**: `create_entry_atomic` は v2 のみ INSERT（v2 必須ガード）。旧引数は後方互換で残置し INSERT しない。
  v2 アクティブ一意索引 `entries_active_email_unique_v2_idx` を**先に作成**して一意性を連続維持。
  `create-entry` / `admin-create-entry` は旧 RPC 引数を送らない。commit `a1d4fa6`、
  migration `202607140004_create_entry_atomic_v2_only_writes.sql`。
- **②.5 遊休ゲート**: reader/writer/フロントの旧列参照 0、独立用途は維持、post-② 実登録行が
  `email_hash IS NULL / disclosure_password_hash IS NULL / v2 両列 NOT NULL` を満たすことを確認（正常系を本番実データで実証）。
- **③ 撤去（不可逆）**: v2 両列 SET NOT NULL、旧 unique index `entries_active_email_unique_idx` 削除、
  旧 cancel RPC `cancel_entry_atomic(text,text,text)`（dead）削除、旧列
  `email_hash` / `disclosure_password_hash` を DROP。commit `bb5ff6b`、
  migration `202607140005_drop_legacy_participant_hash_columns.sql`。
- **完了日**: 2026-07-17
- **deploy**: `participant_auth` を使う 5 関数（my-entry / edit-entry / cancel-entry / mark-late / disclose-result）、
  `send-email`、`create-entry`、`admin-create-entry` を再デプロイ（すべて ACTIVE / verify_jwt=False）。
  フロントは GitHub Pages（push で公開）。
- **検証（観測）**:
  - スキーマ: 旧列消失、v2 両列 NOT NULL、旧 unique index 消失、v2 unique index UNIQUE/VALID、
    旧 cancel RPC 消失、`create_entry_atomic` / `cancel_entry_by_id_atomic` 健在、旧列参照関数 0、pending 空。
  - 動作: 重複登録→**23505 拒否**（v2 index が enforce）、credential 誤り→**404**、
    `send-email` は emailHash 無しでも「情報不足 400」にならない（bogus entry の 500 は
    **既知の not-found 経路の現行仕様を確認**したものであり、本移行による新規回帰ではない）。
  - データ: total 134、v2_null 0、v2 形式不正 0、active v2 重複 0、entry_number 重複 0、status 分布健全。
- **状態**: ✅ 完了

---

## 2. 現状のセキュリティ残件

### 2-A. 今回の v2 移行とは独立した残課題（実施すべき）
- **RLS / 公開・認証 Edge Function の回帰テスト整備**（最重要）。private テーブル・storage への未認証アクセス拒否、
  および `entries` 機密列（`encrypted_pii` / v2 hash）の列レベル制限の回帰チェックを含む。
  出典: `docs/known_limitations.md`「Security Testing」、`docs/roadmap.md:25`、`docs/project-improvement-plan.md:52-53`。
- **全公開/認証データフローのセキュリティレビュー**（roadmap で In Progress）。出典: `docs/roadmap.md:20`。
- **`public_entry_list` 公開範囲の妥当性の定期確認**。`202607170002_public_entry_list_always_public.sql` で
  非 canceled 行を全ロール SELECT 可にした（PII 非保持を前提）。前提が変わる場合は再評価。

### 2-B. 将来改善項目（優先度低／付随）
- `create_entry_atomic` の**後方互換 死引数** `p_email_hash` / `p_disclosure_password_hash` の除去
  （P2-e5 の後始末。signature 整理。DROP+CREATE と PostgREST reload を要し、機能影響なし）。
- JS/CSS の cache-bust バージョン戦略の一元化（運用衛生。出典 `docs/project-improvement-plan.md:63`）。
- アクセス制御ヘルパ・レンダラのエスケープ・アップロード検証の focused テスト追加（出典 `:64`）。

---

## 3. 優先度順セキュリティバックログ

名称は P2-e◯ に拘らず、優先度で管理する（参加者ハッシュ移行は完了済み）。

| # | 項目 | 種別 | 優先 | 根拠 |
|---|------|------|------|------|
| 1 | RLS ＋ 公開/認証 Edge Function の回帰テストスイート整備 | 独立残課題 | 高 | **In Progress（コア完了）** — §4 実施ログ参照 |
| 1b | authenticated ロール（scorer/member）の実行時 RLS 検証（テスト用 JWT フィクスチャ要） | 独立残課題 | 中 | #1 の follow-on。実ユーザー JWT が必要で自律生成不可 |
| 2 | `entries` 機密列（encrypted_pii / v2 hash）の列レベル制限の回帰テスト | 独立残課題 | 高 | **完了**（§4・security_live.test.mjs で anon 実測） |
| 3 | 全公開/認証データフローの一括セキュリティレビュー（RLS・grant・policy・client 経路） | 独立残課題 | 中 | **Completed（レビュー）** — §4（認可ゲート／grant マトリクス／RLS 逐条）。authenticated の behavioral 回帰は #1b |
| 4 | `public_entry_list` 公開範囲の妥当性レビュー（PII 非保持前提の再確認） | 独立残課題 | 中 | **完了**（§4・レビュー＋列 allowlist 回帰テスト） |
| 5 | `create_entry_atomic` 死引数の除去（P2-e5 後始末） | 将来改善 | 低 | 機能影響なし・整理目的 |
| 6 | cache-bust バージョン戦略の一元化 | 将来改善 | 低 | 運用衛生 |
| 7 | アクセス制御/エスケープ/アップロード検証の focused テスト | 将来改善 | 低 | 回帰網の補強 |
| 8 | anon から非データ権限（REFERENCES / TRIGGER / TRUNCATE）を revoke（defense-in-depth） | 将来改善 | 低 | §4 所見。Data API 非露出で悪用不可だが最小権限化。grant migration 要（保留） |

---

## 4. 実施ログ（§5 テンプレート適用・P2-e5 以降）

### RLS・公開/認証 Edge Function の回帰テスト（backlog #1・第1弾）
```
Status  : In Progress（コア完了）— 2026-07-17
Evidence:
  - Files      : tests/security_contract.test.mjs（オフライン static・常時実行）
                 tests/security_live.test.mjs（live anon・CIQ_LIVE=1 で opt-in・read-only）
  - Commits    : 本エントリと同一 commit（tests/security_*.test.mjs 追加）
  - Migrations : なし（テスト追加のみ）
  - Deploys    : なし
  - Verification:
    - 観測: `npx vitest run` = 56 passed（security_contract 18 を含む）/ live 8 は既定 skip / 既存テスト回帰なし
    - 観測: `CIQ_LIVE=1 npx vitest run tests/security_live.test.mjs` = 8 passed
             （anon は entries.encrypted_pii / v2 hash / 旧 v1 列 / project_private_keys /
              participant_auth_events を読めず、membership は RLS で 0 行、public_entry_list は PII-free）
Rollback: Possible（テストのみ・機能/スキーマ影響なし）
Notes   : カバー=参加者認証 v2 不変条件（Edge source）＋ anon 実行時 RLS/列制限（live）。
          未カバー=authenticated ロール（scorer/member）の実行時 RLS（backlog #1b、実 JWT フィクスチャ要）。
```

### public_entry_list の公開範囲レビュー（backlog #4）
```
Status  : Completed — 2026-07-17
Evidence:
  - Files      : tests/security_contract.test.mjs（public_entry_list 列 allowlist 回帰）/
                 tests/security_live.test.mjs（anon 実測で PII-free）
  - Commits    : 本エントリと同一 commit
  - Migrations : なし（レビュー＋テストのみ）
  - Deploys    : なし
  - Verification:
    - 静的: `public_entry_list` はトリガ同期テーブル（202606260003 で明示列挙）。列は
            project_id / entry_id / entry_number / entry_name / affiliation / grade / message /
            is_chubu / status / checked_in / created_at / updated_at のみ。
            encrypted_pii・email・email_hash・disclosure_password_hash を含まない（回帰テスト化）。
    - 観測: anon 実測で public_entry_list は上記機密フィールドを返さない。`public_project_settings` は
            RSA 公開鍵のみで秘密情報なし。
Rollback: Possible（レビュー＋テストのみ）
Notes   : entry_name / affiliation / grade / message は参加者が入力する公開プロフィールで意図的公開。
          PII 本体（氏名・メール）は encrypted_pii に保持され公開面には出ない。前提が変われば再評価。
```

### Edge Function 認可ゲートのレビュー＋回帰（backlog #3・第1弾）
```
Status  : In Progress — 2026-07-17
Evidence:
  - Files      : tests/security_contract.test.mjs（"Edge Function authorization gates" describe）
  - Commits    : 本エントリと同一 commit
  - Migrations : なし / Deploys : なし
  - Verification:
    - 静的レビュー結果（12 Edge Function の認可）:
      * admin 系（admin-create-entry / admin-entry-qr / project-key）= requireAdminMember で
        active かつ owner/admin ロール必須（JS 比較 or SQL `.in('role',[...])` 形式）
      * check-in = 認証ユーザー＋active(非removed) project member 必須
      * participant 系（cancel-entry / disclose-result / edit-entry / mark-late / my-entry）= resolveParticipantAuth（v2 認証）
      * create-entry = メール認証トークン必須＋IP レート制限
      * send-email = 宛先 v2 所有確認＋IP レート制限
      * checkin-qr = HMAC 署名検証（safeEqual）で 404 gating
    - 観測: `npx vitest run` = 68 passed（認可ゲート assertion を含む）
Rollback: Possible（テストのみ）
Notes   : 各 Function の認可ゲートを回帰化（削除・弱体化で CI 失敗）。未了=RLS ポリシー本文と
          grant マトリクスの網羅的レビュー（backlog #3 継続）、authenticated ロールの実行時検証（#1b）。
```

### RLS / grant マトリクスのレビュー＋回帰（backlog #3・第2弾）
```
Status  : In Progress — 2026-07-17
Evidence:
  - Files      : tests/security_live.test.mjs（anon 攻撃面を網羅：24 assertions）
  - Commits    : 本エントリと同一 commit / Migrations : なし / Deploys : なし
  - Verification:
    - 静的レビュー（service-role introspection・read-only）:
      * 全 public テーブルで RLS 有効。
      * private tables（project_private_keys / participant_auth_events / rate_limit_events）= anon 権限ゼロ。
      * entries / answer_pages / audit_logs / email_events / final_results / model_answers /
        question_scorers / score_events / score_votes = anon に SELECT 権限なし（読取不可）。
      * projects / project_members / public_entry_list / public_project_settings = anon SELECT 可だが RLS で行制御。
      * 書込 RPC（create_entry_atomic / cancel_entry_by_id_atomic）= EXECUTE は service_role のみ。
        admin RPC（list_entries_for_admin / remove_project_member / update_project_member_role）= authenticated のみ。
        has_project_role = PUBLIC（anon は auth.uid()=null で false を返すのみ・情報漏洩なし）。
    - 観測: `CIQ_LIVE=1 …security_live` = 24 passed（anon は 12 private tables 読取不可・
      projects/members は RLS 0 行・特権 RPC 3 種 実行不可）。
Rollback: Possible（テストのみ）
Notes   : 所見=マトリクスは概ね最小権限。低リスク項目=anon に REFERENCES/TRIGGER/TRUNCATE の非データ権限が残る
          （Data API 非露出で悪用不可）→ backlog #8 として最小権限化を保留。
          未了=RLS ポリシー本文（USING/WITH CHECK 式）の1件ずつのレビューは継続対象。
```

### RLS ポリシー本文の逐条レビュー（backlog #3・第3弾＝レビュー完了）
```
Status  : Completed — 2026-07-17
Evidence:
  - Files      : tests/security_contract.test.mjs（RLS policy invariants）
  - Commits    : 本エントリと同一 commit / Migrations : なし / Deploys : なし
  - Verification:
    - 静的レビュー（全 public テーブルの pg_policy を read-only 取得し逐条確認）:
      * entries = SELECT:is_project_member / UPDATE・DELETE:owner|admin。**直接 INSERT ポリシーなし**
        （作成は service-role の create_entry_atomic のみ）。回帰テスト化。
      * project_private_keys = ALL `using(false) with check(false)`＝直接アクセス完全遮断。回帰テスト化。
      * projects/project_members/answer_pages/model_answers/final_results = read:member、write:owner|admin。
      * score_votes/score_events/question_scorers = read:member、insert/update は
        has_project_role(owner|admin|scorer) かつ scorer_member_id=current_member_id（self 限定）。
      * public_entry_list = 3 SELECT ポリシー OR（非canceled 公開 / entry_open / member）。
    - 観測: `npx vitest run` = 71 passed（RLS invariants 含む）。
Rollback: Possible（テストのみ）
Notes   : 所見=RLS は project スコープ helper で一貫し健全、危険な `using(true)` は機密テーブルに無し。
          低リスク2件 → (a) public_project_settings は `using(true)` だが公開安全列のみ（意図的）、
          (b) audit_logs INSERT が project_id IS NULL を許容（authenticated のログ挿入・低リスク）。いずれも保留。
          未了=authenticated ロールの behavioral 実行時検証（#1b、要 JWT フィクスチャ）。
```

### セキュリティ強化計画 Phase 1 監査（親計画 docs/security-hardening-plan.md／V1・V2・V4・V6）
```
Status  : Phase 1 = Partially Completed — 2026-07-19（V2 の CAPTCHA が外部サービス判断待ち）

V1 HMAC署名鍵フォールバック : Completed
  - 実装 : _shared/signing.ts:14,29-34（フォールバック無・未設定/32未満で SigningConfigError）
  - commit: aa9237f / 本番env: CIQ_EMAIL_SIGNING_SECRET 設定済(2026-07-08)
  - production: GET /checkin-qr?d=…&s=deadbeef → 404（鍵設定済・長さ充足）
  - 文書 : docs/security-hardening-plan.md 付録A（鍵ローテーション手順）＝完了条件(d)を充足

V2 メール送信オラクル : Partially Completed
  - 済 : IP レート(send_verification 5/10min, create_entry 10/60min) _shared/rate_limit.ts:57-61 /
         create-entry:45 / send-email:555 ; 日次上限 enforceProjectDailyEmailCap（bucket email_daily,
         既定500/日）を recordAndSend に適用（commit 0d2483c）
  - 残 : CAPTCHA(Turnstile) 認証コード発行前の必須化 = 未実装（grep 0件）。**外部サービス導入=要ユーザー判断で停止**

V4 参加者認証の IP レート制限 : Completed（改定基準=IP単位・親計画注記2026-07-19）
  - 実装 : participant_auth.ts:172-179（token/credential 両経路の冒頭で共通適用）/
           rate_limit.ts enforceIpRateLimit → アトミック RPC rate_limit_hit（migration 202607190001,
           pg_advisory_xact_lock で count+insert を直列化, service_role限定）
  - production(before) : 25 並列 → 25×404（非アトミックで上限20を突破）
  - production(after)  : fresh window 25 並列 → 20×404 + 5×429（上限でちょうど頭打ち＝並列突破を解消）
                         逐次 → 429、rate_limit_events に participant_auth の記録（運用確認可）
  - 注 : participant_auth_events への ip_hash 列追加は行わない（IP 追跡は rate_limit_events の HMAC scope_key）

V6 エラーメッセージ内部漏洩 : Completed
  - 実装 : _shared/http.ts:59-63（serverErrorResponse＝汎用文言+ref、詳細は console.error）。JSON返す11 Edge が使用
  - production: POST /send-email(bogus) → {"error":"サーバーで問題が発生しました…","ref":"…"}（内部情報なし）

Rollback: 可逆（V4 は additive migration + Edge 再デプロイ、旧挙動は fail-open で温存）
Notes   : Phase 1 は V2 の CAPTCHA（外部サービス）を除き完了。全 V が Completed/No Longer Applicable
          になるまで Phase 2/3 へは進まない（親計画の判定規則）。
```

### V2 CAPTCHA（Cloudflare Turnstile）導入 → Phase 1 = Completed
```
Status  : Completed — 2026-07-26（これにより Phase 1 全体が Completed）
Evidence:
  - 実装      : supabase/functions/_shared/turnstile.ts（Siteverify・success/action/hostname 検証・
                remoteip 送信・timeout(5s)/5xx/secret未設定は fail-closed）
                send-email（action=send_verification）/ create-entry（action=create_entry, 最初のゲート）
                js/turnstile.js（explicit render・one-time token の取得/reset）・entry.html（widget×2・CSP 許可）
  - Commits   : ca90ca3（実装・テスト・文書）/ 8f776b9（site key + config cache-bust）/ 250d13a（本番で発見した2欠陥の修正）
  - Migrations: なし
  - Deploys   : send-email v33 / create-entry v19（いずれも ACTIVE）
  - Secrets   : TURNSTILE_SECRET_KEY・CIQ_TURNSTILE_HOSTNAMES 設定済（2026-07-26）。CIQ_TURNSTILE_DISABLED 未設定＝fail-closed
  - Tests     : tests/turnstile.test.mjs（29 assertions・公式テストキーを参照）。`npx vitest run` = 116 passed
  - production verification:
    * send_verification: token 無し → 403 / 無効 token → 403（メール送信なし）
    * create-entry     : token 無し → 403 / 無効 token → 403（登録なし・entries 136 で不変）
    * 通知系(entry_cancelled) は CAPTCHA 非要求のまま（既知の not-found 経路で 500 を返す現行仕様を確認。本変更による新規回帰ではない）
    * 多層防御の併存: CAPTCHA が最初のゲートのため 403 時はレート枠を消費しない（設計どおり）。
      IP レート制限（rate_limit_events）・日次上限は健在
    * ブラウザ: 375px ダークモードで widget 描画・横スクロールなし・実 site key で操作可能
  - 本番で発見・修正した欠陥（250d13a）:
    1) send-email が未定義の `body.turnstileToken` を参照 → token 無しが 500（403 であるべき）
    2) create-entry で CAPTCHA がメール認証チェックより後段 → 誤ったゲートで拒否
Rollback: Possible（Edge は旧版へ再デプロイ、緊急時は CIQ_TURNSTILE_DISABLED=1 で一時バイパス＝付録C）
Notes   : 完了条件を全て充足（両経路で必須・サーバ側検証・IP レート並列安全・日次上限並列安全・旧経路から迂回不能・
          回帰テスト・本番疎通・運用/障害手順の文書化）。恒常的 fail-open は不可。
          → **Phase 1（V1/V2/V4/V6）= Completed**。次は Phase 2（V3 は P2-e5 で実質完了済のため再監査）。
```

### Turnstile hostname を本番のみへ限定（V2 の締め・最小権限化）
```
Status  : Completed — 2026-07-26
Evidence:
  - 設定      : Supabase `CIQ_TURNSTILE_HOSTNAMES` = chromquiz.github.io のみ（2026-07-26 08:20 更新）
                Cloudflare widget の許可 hostname も chromquiz.github.io のみ（localhost を削除・運用者操作）
  - 実装      : js/turnstile.js — localhost / 127.0.0.1 / [::1] / file: では Cloudflare 公式テスト sitekey
                (1x00000000000000000000AA) に切り替え。本番 sitekey をローカルで使用しない
  - Commits   : c6ba7ad
  - Deploys   : 追加デプロイ不要（Edge は env 参照のため設定変更が即時反映）
  - Tests     : tests/turnstile.test.mjs に localhost フォールバックの回帰を追加。`npx vitest run` = 117 passed
  - production verification（トークン本文・secret は一切出力していない）:
    1. Supabase の許可 hostname = chromquiz.github.io のみ ✓
    2. Cloudflare 側の許可 hostname も同一 ✓（下記4の挙動で裏付け）
    3. 本番の正常 token → CAPTCHA ゲート通過（403 にならず。存在しない projectId を使い実メール送信は発生させない）✓
    4. hostname 不一致 → **本番 sitekey を localhost で使うとトークン発行自体が不可**（Cloudflare エラー 110200＝
       ドメイン不許可）。加えて Edge のメタデータ照合が実稼働していることを、同一コードパスの
       **action 不一致 → 403**、**同一トークン再利用 → 403**（timeout-or-duplicate）で本番実証 ✓
    5. ローカルは公式テストキーで継続動作（トークンが XXXX. 始まり＝ダミー）✓
    6. secret・実トークンをログ / commit / 報告文へ出していない ✓
    - 参考: localhost から本番 API への直叩きは CORS allowlist（V5）が遮断することも確認
Rollback: Possible（`CIQ_TURNSTILE_HOSTNAMES` の再設定と Cloudflare 側 hostname 追加で戻せる）
Notes   : ローカル開発は公式テストキー運用。テストキー由来トークンは本番 secret で検証できないため、
          ローカルから本番への送信は成立しない（意図どおりの分離）。Phase 1 は Completed を維持。
```

### V3 ログ系テーブルの無塩ハッシュを HMAC 化（既存列を in-place 更新）
```
Status  : Completed（V3 の残件2件）— 2026-07-26
Evidence:
  - 実装      : send-email/index.ts（recipientLogHash = pepperHash(sha256(email)) をログ/レート制限に使用。
                宛先所有確認 assertEntryRecipient には生 sha256 を渡し二重 pepper を回避）
                _shared/participant_auth.ts（enforceAuthRateLimit / recordAuthAttempt を emailHashV2 に切替）
  - Migration : 202607260001_grant_service_role_update_auth_events.sql
                （participant_auth_events に service_role の UPDATE が無く backfill が全件 skip したため付与。
                  DELETE は付与しない＝履歴の破壊的操作は不許可）
  - Commits   : bd4c815
  - Deploys   : send-email / my-entry / edit-entry / cancel-entry / mark-late / disclose-result
  - Backfill  : 一回限りの service_role Edge Function（admin-backfill-log-hash）で
                cutoff=2026-07-26T12:35:34Z より前の行のみ再ハッシュ → **95 行更新（59 + 36）/ skip 0**。
                **実行後に Function を削除済み**（invoke が 404・一覧に非存在・ローカルソースも削除）
  - Verification:
    - 観測（正当性の独立検証）: entries と紐づく email_events 15 行すべてで
      `recipient_hash == entries.email_hash_v2`（不一致 0）。旧無塩値なら一致しないため、
      HMAC 化が正しく行われた確定的証拠
    - 観測（形式）: email_events 36/36・participant_auth_events 59/59 が 64hex を維持
    - 観測（回帰）: 誤 credential → 404 かつ台帳に +1 記録（pepper 済み・64hex）、
      通知系 send-email は既知の not-found 挙動を維持（本変更による新規回帰ではない）
    - 静的: `npx vitest run` = 121 passed（ログ列 pepper 化・二重 pepper 回避・v2 列を作っていないことを回帰化）
Rollback: 旧コードへ再デプロイは可能だが、旧無塩値は復元不可（一方向）。影響はレート制限の
          突合が最大10分ズレる程度で、認証主体ではないため実害は限定的
Notes   : 設計判断＝**recipient_hash_v2 / email_hash_v2 は作らず既存列を in-place 更新**、pepper は既存
          CIQ_PARTICIPANT_HASH_PEPPER を流用、一時 RPC/一時テーブルは作らない。
          理由: 読み手が限定（enforceRateLimit / enforceAuthRateLimit のみ）・認証主体ではない・
          既存値から新値を再計算できる・長期互換が不要。P2-e5 のような長期 dual-write は行っていない。
          二重ハッシュ防止は「cutoff 必須 + 実行後に Function 削除」で担保。
          → **V3 = Completed**（2026-07-26 再判定）。完了条件を全て充足:
          (a) サーバ側 HMAC(pepper) 化 = entries / email_events / participant_auth_events の全経路
          (b) email_hash も HMAC 化 = 3テーブルすべて
          (c) pepper は env 秘密 = CIQ_PARTICIPANT_HASH_PEPPER（フォールバックなし・32文字下限）
          (d) 既存行の再計算 = entries は P2-e2/e3 backfill、ログ2表は今回 95 行を in-place 再計算
          （scorer 参加コードの無塩ハッシュは V3 の対象外＝V14 として分離済み）
```

### V5 CORS allowlist / API 直叩き耐性（Phase 2・ゼロベース監査）
```
Status  : Completed — 2026-07-26
Evidence:
  - 実装      : _shared/http.ts — allowedOrigin() が CIQ_ALLOWED_ORIGINS を完全一致判定し、
                一致時のみ Origin をエコー、不一致/未指定なら ACAO ヘッダを削除。withCors() が
                preflight・本応答・エラー・画像応答すべてに一貫適用。全 12 Edge が withCors を使用
  - 設定      : 本番 CIQ_ALLOWED_ORIGINS 設定済（2026-07-11）
  - Tests     : tests/security_contract.test.mjs（完全一致判定・ACAO 削除・Vary・全 Edge の withCors 適用を回帰化）
                `npx vitest run` = 123 passed
  - production verification:
    * 正規 Origin(https://chromquiz.github.io) → ACAO エコー（POST・preflight OPTIONS とも）
    * 悪意 Origin(https://evil.example) → **ACAO なし**（ブラウザがブロック）
    * Origin なし（curl 直叩き）→ ACAO なし
    * checkin-qr(GET/画像応答)も同様に ACAO なし
    * Origin 詐称耐性（完全一致）: `https://chromquiz.github.io.evil.com` / `http://chromquiz.github.io`(scheme 違い) /
      `https://chromquiz.github.io/`(末尾スラッシュ) / `http://localhost:8080` の4種すべてで ACAO なし
    * 直叩き時の入力検証: my-entry 空body=400・不正hash形式=404、create-entry 空body=400、
      send-email 不正メール=400、edit-entry トークン無=404（いずれも情報漏洩なし）
    * レート制限による実質担保: V2（Turnstile＋IP＋日次上限）・V4（並列安全な IP 制限）が稼働中
Rollback: CIQ_ALLOWED_ORIGINS に許可 Origin を設定し直す（空にしても全許可には戻らない＝fail-closed）
Notes   : **再監査（2026-07-26・同日）で判定を一度取り消した**。初回監査では '*' フォールバックの残存を
          「後方互換」として許容し Completed としたが、V1（署名鍵は未設定なら例外・弱い既定値へ倒さない）の
          fail-closed 方針と矛盾するため **Partially Completed へ差し戻し、修正後に再度 Completed**とした。
          修正内容は下記エントリを参照。
```

### V5 追補 — '*' フォールバックの撤去（fail-closed 化／初回判定の是正）
```
Status  : Completed — 2026-07-26（V5 の最終状態）
問題    : allowedOrigin() に '*' フォールバックが **3 箇所** 実在した:
          (1) jsonResponse が 'access-control-allow-origin': '*' を直書き
          (2) CIQ_ALLOWED_ORIGINS 未設定 → return '*'
          (3) 設定はあるが空/空白のみ → return '*'
          → 設定漏れ・設定ミス時に「全オリジン許可」へ倒れる fail-open。V1 の方針と不整合。
Evidence:
  - 実装   : _shared/http.ts — 純関数 resolveAllowedOrigin(raw, origin) へ切り出し、
             未設定/空/空白のみ → null（'*' へ倒さない）。jsonResponse から ACAO 直書きを削除し、
             withCors() のみが許可 Origin を後付けする。未設定時はサーバログに警告を残す
  - Tests  : tests/cors_allowlist.test.mjs（**実装を直接 import した決定表テスト 7 件**）
             未設定/null/空/空白/カンマのみ → null、完全一致 → エコー、
             サフィックス偽装・scheme 違い・末尾スラッシュ・大文字違い・'null' Origin → null、
             Origin なし → null、コード内に '*' が残っていないこと
             `npx vitest run` = 130 passed
  - Deploys: 全 12 Edge Function を再デプロイ（_shared/http.ts は各関数にバンドルされるため）
  - production verification（デプロイ前に allowlist 設定済みをゲート確認 → 挙動不変を担保）:
    * 正規 Origin → send-email / create-entry / my-entry / checkin-qr の全てで ACAO エコー（回帰なし）
    * 悪意 Origin・preflight 悪意 → ACAO なし
    * 直叩き: my-entry 誤cred=404 / send-email token無=403（機能回帰なし）
    * ブラウザ実機（本番フロント）から Edge への fetch が成功＝CORS 破壊なし
Rollback: Possible（CIQ_ALLOWED_ORIGINS の再設定で調整。ただし '*' への復帰路は意図的に廃止）
Notes   : これにより V5 は V1 と同じ fail-closed 方針に整合。設定漏れ時はブラウザ経由が止まる（可用性より安全側）が、
          設定済みの本番では挙動不変であることを実測で確認済み。
```

### V8 第三者 CDN の供給網対策（SRI / 版固定 / CSP 最小化）
```
Status  : Completed — 2026-07-26
先行実装 : **監査の結果、大半は Phase 1〜2 の過程で既に実装済みだった**（ゼロベースで未実装と決めつけない）:
  - supabase-js を @2(浮動メジャー)から **2.110.1 に厳密ピン留め + SRI(sha384) + crossorigin**（全 10 ページ）
  - jsQR 1.4.0 / marked 12.0.2 も版固定 + SRI + crossorigin
  - 動的ロード（admin のみ）: jspdf 2.5.2（unpkg）/ pdf.js 3.11.174（cdnjs）も
    loadAdminScriptOnce(url, sha384) で **SRI + 版固定**済み
  - CSP から 'unsafe-inline'（script/style）は既に除去済み
不足分（今回実装）: **CSP の不要 CDN 削除**
  - 全ページの style-src / font-src が Google Fonts と cdnjs を許可していたが、**実参照は 0**（production ページ）
    → `style-src 'self'` / `font-src 'self'` へ
  - 非 admin ページの script-src が cdnjs を許可していたが未使用 → 削除
  - help.html は外部スクリプトを一切読まないのに 3 CDN を許可 → `script-src 'self'` へ
  - 実利用のみ残置: cdn.jsdelivr.net（全ページ）/ challenges.cloudflare.com（entry のみ）/
    unpkg.com + cdnjs.cloudflare.com（admin のみ・pdf 関連の動的ロード）
Evidence:
  - Commits : 893259b（CSP 精密化 + 回帰テスト）。SRI/版固定は既存実装（各 HTML と js/admin.js）
  - Tests   : tests/supply_chain.test.mjs（36 件）— 第三者 script の SRI・crossorigin・厳密版ピン留め、
              動的ロードの SRI/版、各ページ script-src が「実際に読み込むホストのみ」であること、
              未使用フォント CDN が残っていないこと。`npx vitest run` = 166 passed
  - browser verification（ローカル実機）:
    * entry.html: CSP 違反 0・supabase-js 読込 OK・Turnstile 読込 OK・widget 描画 OK・アイコン/CSS 適用 OK
    * 全 11 ページを iframe で読込 → 全て正常（supabase-js は必要ページで読込成功、help/404 は外部不要）
    * コンソールに Content Security Policy 違反 / Refused to load は **0 件**
  - production verification: GitHub Pages 反映後、entry/my/help の script-src が期待どおり、
    fonts.googleapis の残存 0 件
Rollback: Possible（HTML の CSP を 1 コミット revert すれば旧許可へ戻る）
Notes   : **SRI 非適用の例外 1 件** = Cloudflare Turnstile の api.js。Cloudflare 側で随時更新されるため
          公式にハッシュ固定は非対応（セルフホストも不可＝チャレンジの性質上）。
          担保は (a) CSP script-src を challenges.cloudflare.com に限定、(b) TLS、(c) 提供元が
          セキュリティベンダ自身であること。テストでも明示的に SRI 例外として記録している。
          pdf.js の worker（workerSrc）も API の性質上 SRI を付与できないが、同一の cdnjs 版固定 URL を使用。
```

### V10 参加者/service_role 操作の監査ログ（ゼロベース監査）
```
Status  : Completed — 2026-07-26（**追加実装なし**。既存実装が完了条件を満たしていた）
初期計画 : 脅威=参加者系は service_role 実行で auth.uid() が null となり、受付・編集・キャンセルの証跡が残らない
           影響=インシデント追跡不能 / 修正方針=service_role 用の監査挿入経路（種別=participant、IP/ID のみ、PII なし）
既存実装（調査で確認・今回は書き換えていない）:
  - 挿入経路 : _shared/audit.ts の logServiceEvent() → RPC log_service_event（SECURITY DEFINER・
               EXECUTE は service_role のみ）。migration 202607080002_service_audit_log.sql で
               audit_logs に actor_kind / actor_ip_hash を追加（既存行・既存ポリシーは不変）
  - 種別      : ActorKind = 'participant' | 'staff' | 'system'
  - IP        : clientIpHash() の HMAC 値のみ（生 IP は保存しない）
  - PII 非保存: target_id は entry.id(UUID)のみ、after_data は状態遷移のみ
  - fail-open : 記録失敗は本処理を止めない（監査障害が参加者操作を壊さない）
  - 適用範囲  : 状態変更 6 操作すべて — create-entry(entry.create) / edit-entry(entry.edit) /
               cancel-entry(entry.cancel) / mark-late(entry.mark_late) / check-in(entry.checkin) /
               admin-create-entry(entry.create_by_staff)
Evidence:
  - production verification（本番 audit_logs の実データ）:
    * entry.create = 6 件（actor_kind=participant・全件 IP ハッシュあり）
    * entry.cancel = 1 件（participant）/ entry.mark_late = 1 件（participant）/ entry.checkin = 2 件（staff）
    * after_data のキーは `status` と `checked_in` のみ = **PII 混入なし**
    * actor_ip_hash: 10/10 が 64hex、生 IP 形式は 0 件
    * log_service_event: SECURITY DEFINER・grantee=service_role
    * RLS: audit_logs_select_admin（owner/admin のみ閲覧可）
    ※ entry.edit のみ本番実データ未発生（コード経路は edit-entry/index.ts:135-141 に存在）
  - Tests   : tests/audit_trail.test.mjs（8 件）— 状態変更 6 操作が正しい action/actor_kind/HMAC 化 IP で
              記録すること、afterData に PII 系フィールドを渡していないこと、fail-open であること
              `npx vitest run` = 174 passed
  - Commits : 本エントリと同一 commit（回帰テスト追加とドキュメント更新のみ）
Rollback: N/A（実装変更なし。追加したのはテストとドキュメントのみ）
Notes   : 監査対象外は読み取り専用/非状態変更の経路（my-entry・disclose-result・admin-entry-qr・checkin-qr）と
          send-email（送信履歴は email_events 台帳が担う）。V10 の脅威記述が名指しする「受付・編集・キャンセル」は
          すべて記録されている。**Phase 2 進捗: V3 ✅ / V5 ✅ / V8 ✅ / V10 ✅ / V12 = 次**
```

### V12 大量登録へのボット対策（ゼロベース監査）
```
Status  : Completed — 2026-07-26（**追加実装なし**。Phase 1 と P2-e5 の成果で完了条件を充足していた）
初期計画 : 脅威=自動で偽エントリを大量投入 / 影響=枠占有 DoS・運営混乱
           修正方針=CAPTCHA、メール認証コード完了を登録の前提に、1メール1エントリ制約＋IP レート
既存実装（調査で確認・今回は書き換えていない）:
  (1) CAPTCHA          : create-entry の**最初のゲート**で verifyTurnstile(action='create_entry')。
                         Phase 1 の V2 で導入（サーバ側 Siteverify・hostname/action 検証・fail-closed）
  (2) メール認証必須   : emailVerificationRequired() → verifyEmailVerifiedToken()。
                         既定は **必須**（`raw !== 'false'` のため未設定・空でも有効＝fail-secure）
  (3) 1メール1エントリ : entries_active_email_unique_v2_idx
                         = UNIQUE(project_id, email_hash_v2) WHERE status <> 'canceled'（UNIQUE/VALID）。
                         P2-e5 ② で v2 側へ移行済み。違反は 23505 → 409「既にエントリー済み」
  (4) IP レート        : enforceIpRateLimit(bucket='create_entry', 既定 10/60分)。V4 でアトミック化済み
  ゲート順序           : CAPTCHA(34) → メール認証(38) → IP レート(50) → create_entry_atomic(57)
                         ＝ボットは後段の検証・DB 処理へ到達しない
Evidence:
  - production verification（entries 136 → 136・**副作用なし**）:
    * CAPTCHA なしの登録 → **403** / CAPTCHA 不正 → **403**（登録されない）
    * 既存 active メールでの重複登録 → **23505 で拒否**
    * 本番 env: CIQ_REQUIRE_EMAIL_VERIFICATION **未設定＝既定 true(必須)**、
      CIQ_TURNSTILE_DISABLED **未設定＝CAPTCHA 有効**（バイパス無し）
  - Tests   : tests/security_contract.test.mjs に V12 の 5 件を追加 —
              CAPTCHA が最初のゲート・メール認証必須・既定 true の fail-secure・IP レート・
              DB レベルの 1メール1エントリ制約。`npx vitest run` = 179 passed
  - Commits : 本エントリと同一 commit（回帰テストとドキュメントのみ）
Rollback: N/A（実装変更なし）
Notes   : V12 は Phase 1 の V2（Turnstile / IP レート / 日次上限）と P2-e5 ②（v2 一意索引）の副産物として
          既に満たされていた。**Phase 2 = 全 V 完了（V3 ✅ / V5 ✅ / V8 ✅ / V10 ✅ / V12 ✅）**。次は V14。
```

### V7 当日受付二次元コードの署名化と entry UUID の非公開化（Phase 3・ゼロベース監査）
```
Status  : Completed — 2026-07-26（監査時 Partially Completed → 不足分を実装して Completed）
初期計画 : 脅威=二次元コード 本体が素の entry UUID（署名なし・使い回し無期限）。A4 が他人の 二次元コード を提示すると受付が通る
           修正方針=二次元コード を HMAC(entryId+nonce+exp) 署名付きにし check-in で検証、**または**受付時に受付番号照合を
           必須化。**少なくとも** entry UUID を公開リストから除外
監査時点の実装（既存・書き換えていない）:
  - checkin-qr の **URL** は HMAC 署名済み（任意データの 二次元コード 画像生成は不可）
  - check-in は認証済み active メンバー必須、canceled/waitlist 拒否、二重受付は 'already'、監査ログ記録（V10）
不足していた点（今回実装）:
  1. 二次元コード の中身が素の entry UUID（署名・期限・nonce なし）
  2. check-in が未検証の UUID で `.eq('id', entryId)` 照合
  3. **entry UUID が anon から公開取得可能**（実際に公開 API で実 UUID を取得できることを確認）
実装:
  - _shared/qr_token.ts: `entryId.exp.sig`（sig=HMAC(signingSecret, `qr:id:exp`)、既定 TTL 400日）
    issueQrToken / verifyQrToken。旧形式（素の UUID）は verify が null＝**fail-closed**
  - 二次元コード 生成 3 経路すべてを署名トークンに: my-entry(qrSvg) / admin-entry-qr / checkin-qr
    ※画像は都度サーバ生成のため、既存メールの URL からも次回表示時に新形式が描画される
  - check-in: verifyQrToken で検証してから id 照合。素の UUID は 400 で拒否
  - migration 202607260002: public_entry_list の blanket SELECT を revoke し、**entry_id を除く列のみ**を
    anon/authenticated に grant（RLS の行可視性は不変。列単位は entries 機密列と同じ手法）
  - js/supabase_api.js: 公開リストの select から entry_id を除去（キーは entry_number に変更。
    entry_list.js は Object.values 利用のためキー非依存）
  - 運用フォールバック（親計画の代替策「受付番号照合」）: 受付 UI に受付番号入力を追加
    （checkin.html / checkin.js / css）。キャッシュ済みの旧 二次元コード でも受付を継続できる
Evidence:
  - Tests   : tests/qr_token.test.mjs（14 件・**実装を直接 import**）— 発行/検証ラウンドトリップ、
              素の UUID 拒否、entryId すり替え拒否、署名改ざん拒否、exp 改ざん拒否、期限切れ拒否、
              不正入力拒否、生成3経路が署名トークンを埋め込むこと、check-in が未検証 id で引かないこと、
              受付番号フォールバックの存在、migration とクライアントから entry_id が消えていること
              `npx vitest run` = 193 passed
  - Deploys : checkin-qr / my-entry / admin-entry-qr / check-in
  - production verification:
    * `public_entry_list?select=entry_id` → **42501 permission denied**（UUID 取得不可）
    * 許可列（entry_number/entry_name/status 等）は従来どおり取得可＝公開リストの機能は不変
  - browser verification: 受付番号フォームが 375px で正しく描画（label↔input 関連付け、
    数値キーパッド、縦積み、ボタン全幅、横スクロールなし、--ink-2 が解決）
  - Commits : 601383b
Rollback: Possible（Edge は旧版へ再デプロイ、migration は grant を戻せば復旧。二次元コード は都度生成のため
          旧版デプロイで即座に旧形式へ戻る）
Notes   : 残留リスク=二次元コード は依然として bearer（盗撮・スクショされた 二次元コード は有効期限内なら使える）。
          これは受付番号・氏名の目視照合（結果パネルに表示）と、受付済み 二次元コード の再使用が 'already' に
          なることで運用的に緩和する。V7 の完了条件が求める「署名化」「UUID 非公開化」は充足。
```

### V9 / V11 / V13（Phase 3・ゼロベース監査）→ Phase 3 完了
```
Status  : いずれも Completed — 2026-07-26

V9 RSA 秘密鍵の保持場所 : 監査時 Partially Completed → 実装して Completed
  初期計画 : localStorage 保持のため XSS で privateKeyJwk を窃取され全 PII を復号される
             修正方針 = session 限定保持、CSP 強化、project-key fetch の頻度最小化
  既存で満たしていた点 : CSP 強化（V8・unsafe-inline 除去済み）、鍵が無いときだけ取得する fetch 最小化
  不足していた点 : 鍵が **localStorage** にあった（js/index.js・js/admin.js が session.set で保存、
                   admin.js / admin_stats.js / admin_settings.js が読み出し）
  実装 : js/config.js に `projectKeyStore`（sessionStorage 限定）。旧 localStorage 値は初回 get で
         sessionStorage へ移行して localStorage から削除。set は localStorage を汚さない。
         session.clear() は両方を削除。読み書き 8 箇所すべてを新ストア経由に変更。
         あわせて **js/config.js の cache-buster を追加**（従来 ?v= が無く、古い config が配信され得た）
  Evidence : browser 実機で移行を実証 — 旧状態 {local:true, session:false} → get で
             {local:false, session:true} かつ値は返る → set 後も localStorage は空 → session.clear() で両方空。
             tests/private_key_storage.test.mjs（7 件）。commit 8c20699

V11 除名メンバーの判定統一 : 監査時 Partially Completed → 実装して Completed
  初期計画 : check-in が `status <> 'removed'` のみで、admin-* の「active 明示」と不統一
  実装 : check-in を `member.status !== 'active'` で拒否＋ロールを owner/admin/scorer に明示。
         否定形をやめたことで、将来 'suspended' 等の状態が増えても素通りしない
  Evidence : tests/edge_dependencies.test.mjs（staff 系 4 関数すべてが active を明示することを回帰化）。
             本番 check-in(未認証) → 401。commit d0620a1

V13 Edge 依存のバージョン固定 : 監査時 Partially Completed → 実装して Completed
  初期計画 : esm.sh の浮動指定。上流侵害/破壊的更新の受動リスク。修正方針 = パッチ版まで固定、deno.lock 導入
  既存で満たしていた点 : `npm:qrcode@1.5.4` は既にパッチ版固定
  不足していた点 : `https://esm.sh/@supabase/supabase-js@2`（**浮動メジャー**）
  実装 : 2.110.1 に固定（フロントの SRI 付き script と同一版）。Edge 全ソースで浮動指定は 0 件
  Evidence : tests/edge_dependencies.test.mjs が全 .ts の import を走査し浮動指定 0 を強制、
             Edge とブラウザの supabase-js 版一致も検証。全 12 関数を新バンドルで再デプロイし、
             本番応答は my-entry 404 / create-entry 400 / check-in 401 / checkin-qr 404 / send-email 403 と期待どおり
  未実施 : **deno.lock の導入は見送り**（Supabase の関数バンドル方式に影響し、大会直前の変更リスクが
           固定の便益を上回るため）。浮動指定 0 と回帰テストで同等の効果を担保している

Rollback: V9/V11 はコード revert のみ、V13 は import 版を戻して再デプロイ
Notes   : **Phase 3 = 全 V 完了（V7 ✅ / V9 ✅ / V11 ✅ / V13 ✅）。親計画 V1〜V13 をすべて Completed。**
          以降は V14（採点者参加コードの無塩 SHA-256）を Additional Security Backlog として扱う。
```

### V7 再確認 — 二次元コード TTL の再評価と受付番号フォールバックの監査
```
Status  : Completed（V7 の最終状態）— 2026-07-26

【1】TTL 400日の再評価 → **根拠不十分と判断し既定 30 日へ短縮（env 連動）**
  - なぜ 400 日だったか : 「配布済み 二次元コード を壊さない」ための便宜値。セキュリティ要件から導いたものではない
  - 大会期間と 二次元コード 必要期間 : projects.period_end は **NULL**（大会終了日時が未設定）。period_start=2026-07-03。
    → 大会終了日時への自動連動は現データでは成立しないため採用せず、env による明示設定とした
  - 二次元コード 画像は **表示のたびにサーバ再生成** されるため、本来必要な有効期間は「描画 → 受付」だけ。
    長期が要るのはメールクライアントのキャッシュ／保存画像が「登録 → 当日」を跨ぐ場合に限られる
  - リプレイ可能期間 : 変更前 **最大 400 日** → 変更後 **最大 30 日**（`CIQ_QR_TTL_DAYS` で 1 日まで短縮可）
  - 受付済み 二次元コード の再利用 : `checked_in` の行は 'already' を返し、更新は
    `.eq('checked_in', false).in('status', [...])` の条件付き UPDATE で**原子的に拒否**（状態は変わらない）
  - 過去大会・別大会での利用 : entryId は UUID で全体一意、check-in は
    `.eq('project_id', projectId).eq('id', verifiedId)` と **project スコープで照合**するため、
    他プロジェクトの受付には使えない
  - 署名対象 : `qr1:<entryId>:<expMs>`。**用途タグ + バージョン**を含む（今回追加）。
    project ID は含めないが、上記の project スコープ照合と UUID 全体一意性で代替（多重防御としては照合側で担保）
  - 他用途との衝突 : 参加者トークン=base64url JSON、二次元コード 画像 URL 署名=素の UUID、認証コード=`code:email:exp`。
    いずれも `qr1:` 接頭辞と形式が異なり**交差利用不可**
  - 鍵ローテーション : `CIQ_EMAIL_SIGNING_SECRET` を更新すると全 二次元コード が即時失効（付録A に手順と影響を記載済み）
  - 時計ずれ : **発行も検証も Edge（サーバ）側**で、クライアント時計に依存しない。
    ずれの考慮が要るのは Supabase 内部の時刻のみで、30 日の窓に対して無視できる
  - 実装 : `CIQ_QR_TTL_DAYS`（既定 30 / 1〜400 にクランプ / 不正値は既定）
  - 期限切れ時の回復 : (a) マイエントリーで再表示（常に新しい 二次元コード）(b) 受付番号での受付

【2】受付番号フォールバックの監査（弱い迂回経路になっていないか）
  - staff 認証必須            : ✅ requireProjectMember（Google JWT 検証）
  - active な owner/admin/scorer のみ : ✅ V11 で `status !== 'active'` ＋ロール明示に統一
  - anon から直接受付不可      : ✅ 本番実測 — 受付番号経路 **401** / 二次元コード 経路 **401** / stats **401**
  - 総当たりのレート制限       : ✅ **今回追加**。`checkin_miss`（既定 30回/10分・IP 単位・
    `CIQ_RL_CHECKIN_MISS_IP`）。**失敗照会のみ**を数え、成功した受付は数えないため、
    当日の連続受付（正規のバースト）はスループットを落とさない
  - 外部への存在列挙不可       : ✅ 認証必須のため anon は到達不能。認証後も応答は同一形式の 404
  - 二重受付の原子的拒否       : ✅ 条件付き UPDATE（`checked_in=false` かつ status ∈ registered/late）。
    競合時は 409、既受付は 'already'
  - キャンセル済み/削除済み    : ✅ canceled → 'canceled' を返し受付しない、waitlist → 'waitlist'、
    存在しない → 404（レート制限対象）
  - 監査ログ                   : ✅ `entry.checkin`（actor_kind=staff・actor_member_id・HMAC 化 IP）
  - project 跨ぎの衝突         : ✅ クエリは `.eq('project_id', projectId)` を先に適用。
    `entries_project_id_entry_number_key` により受付番号は project 内で一意
Evidence:
  - Tests   : tests/qr_token.test.mjs（17 件）— 既定 TTL が 30 日、env クランプ（2日 / 99999→400 / 不正値→既定）、
              バージョンタグ、素 UUID 拒否、すり替え・改ざん・期限切れ拒否ほか。`npx vitest run` = 209 passed
  - Deploys : checkin-qr / my-entry / admin-entry-qr / check-in
  - production verification : check-in の 3 経路すべて anon から 401、
              entries 136 件・checked_in 2 件が**プローブ後も不変**
  - Commits : 4dc83fa
Rollback: Possible（TTL は env で即時調整、コードは revert 可）
Notes   : 残留リスク=二次元コード は依然 bearer。窓は最大 30 日（env で短縮可）で、受付済みは再利用不可。
          運用では結果パネルの氏名・受付番号を目視照合する。
```

### V13 再確認 — deno.lock は完了条件であり未実施 → Partially Completed へ差し戻し
```
Status  : **Partially Completed** — 2026-07-26（前回の Completed 判定を取り消し）
初期計画の完了条件（原文）: 「import をパッチ版まで固定、**deno.lock 導入**、定期確認」
  → deno.lock は**明示的な完了条件**。「大会直前だから見送った」という理由だけで Completed にはできない。
判定 : **A（deno.lock が必須であり未実施）**。B（同等性による Superseded）は**採用しない**——
       同等性を証明できないどころか、**反証**されたため。
Evidence（同等性が成立しない根拠）:
  - 全 Edge Function の外部 import（全 .ts を走査）:
    * `https://esm.sh/@supabase/supabase-js@2.110.1` … 1 箇所
    * `npm:qrcode@1.5.4` … 1 箇所
  - 浮動バージョン・branch・latest 指定 : **0 件**（回帰テストで強制）
  - 直接依存 : いずれも**パッチ版まで厳密固定** ✅
  - 間接依存 :
    * esm.sh 側は同一版のサブパッケージを固定して返す
      （auth-js/functions-js/postgrest-js/realtime-js/storage-js いずれも @2.110.1）。
      ただし `/node/process.mjs` は**版指定なし**で、esm.sh のビルド出力は同 URL でも変わりうる
    * **`npm:qrcode@1.5.4` の推移的依存は semver 範囲**：
      `pngjs ^5.0.0` / `yargs ^15.3.1` / `dijkstrajs ^1.0.1`
      → lock が無ければ**デプロイごとに解決結果が変わりうる**（＝ビルド時固定になっていない）
  - Supabase の bundle/deploy 方式 : `supabase functions deploy` に **lock 用オプションは無い**
    （利用可能なのは `--import-map` / `--use-api` / `--no-verify-jwt`）。deno.lock を効かせるには
    `supabase/functions/deno.json` 等でのビルド設定変更と、その反映可否の検証が必要
  - 回帰テストが保証すること : 直接 import に浮動指定が無いこと、Edge とブラウザの supabase-js 版一致
  - 回帰テストが保証できないこと : **間接依存の同一性**（バイト単位の再現性）、esm.sh 配信物の不変性
  - deno.lock を使わない残余リスク : 再デプロイ時に qrcode の推移的依存が別版へ解決され、
    上流侵害や破壊的更新を受動的に取り込む可能性。影響範囲は 二次元コード 画像生成（checkin-qr / my-entry /
    admin-entry-qr）に限られ、参加者認証・DB アクセス経路には及ばない
未実施の理由と次の一手 : ローカルに Deno 未導入のため lock を生成できず、かつ Supabase の
  デプロイ経路が lock を honor するかの検証が必要。実施時は
  (1) Deno 導入 → (2) `supabase/functions/deno.json` に lock 設定 → (3) lock 生成 →
  (4) 1 関数で試験デプロイ → (5) 全関数へ展開、の順で、大会日程を避けて行う。
```

### V13 追加検証 — 「deno.lock を作れるか」と「Supabase が使えるか」を切り分けて実証
```
Status  : 検証完了（V13 の判定は Partially Completed のまま。改訂可否はユーザー判断待ち）— 2026-07-26

【問1】deno.lock を作ること自体 → **可能**（前回の「Deno 未導入だからできない」は不正確だった）
  - Deno は npm 経由で入手できる（`npx deno@2.9.4` で実行確認: deno 2.9.4 / v8 15.0 / TypeScript 6.0）
  - 実際に本番と同じ依存（`https://esm.sh/@supabase/supabase-js@2.110.1` + `npm:qrcode@1.5.4`）で lock を生成:
    * version 5 / 7,274 bytes
    * **npm: 29 エントリ**（ansi-regex@5.0.1, ansi-styles@4.3.0, camelcase@5.3.1, cliui@6.0.0,
      color-convert@2.0.1, color-name@1.1.4 … ＝これまで未固定だった qrcode の推移的依存ツリー）
    * **remote: 11 エントリ**（esm.sh の URL を integrity 付きで固定）
  → lock を導入できれば、V13 が問題視した「間接依存がデプロイごとに変動する」点は**実際に閉じられる**

【問2】Supabase Functions がそれを利用すること → **不可（実験で確定）**
  - 使い捨て関数 `zz-lock-probe`（`npm:qrcode@1.5.4` を import）に deno.json + deno.lock を同梱してデプロイ
  - 観測1: アップロードされた資産は **deno.json と index.ts のみ**。**deno.lock はアップロードされない**
  - 観測2: 正しい lock でのデプロイ後、関数は正常動作（`{"ok":true,"hasQr":true}`）
  - 観測3（決定的）: lock 内 `ansi-regex@5.0.1` の integrity を **意図的に破壊**して再デプロイ →
    **エラーにならずデプロイ成功** ＝ lock は検証に使われていない
  - CLI にも lock 用オプションは無い（`--import-map` / `--use-api` / `--no-verify-jwt` / `--prune` / `-j` のみ）
  → **プラットフォーム側の制約**であり、「時間がない」「大会直前だから」という理由ではない

【代替手段の実現可能性】vendoring（"vendor": true）
  - remote（esm.sh）依存は `vendor/` に取り込める（実測 54 ファイル / 1.1MB）→ 資産としてアップロードされうる
  - ただし **npm: 依存は `node_modules/` に展開**される（実測 2.4MB）。これは関数資産のアップロード対象ではないため、
    `npm:qrcode` を残したままでは完全な決定性は得られない
  - 完全に決定化するには `npm:qrcode@1.5.4` を vendored/esm.sh 版へ置き換える**設計変更**が必要

後始末 : zz-lock-probe は本番から削除済み（invoke 404 / 一覧に非存在 / Function 数 12 に復帰）、ローカルソースも削除
Evidence: 上記はすべて実行結果に基づく（lock 生成ログ・アップロード資産一覧・破損 lock でのデプロイ成功・削除確認）
```

### V13 最終判定 — 要件を正式改訂して Completed（親計画 V1〜V13 完了）
```
Status  : **Completed** — 2026-07-26（親計画の完了条件を正式改訂した上で充足）

要件改訂（親計画 §3 の V13 行・付録D・改訂履歴に反映済み）:
  元: ①外部 import をパッチ版まで固定 ②deno.lock を導入 ③依存関係を定期確認
  新: ①外部の直接依存を厳密なバージョンへ固定 ②浮動・latest・branch 指定を禁止
      ③import 走査テストで固定状態を継続検証 ④依存関係を定期確認（付録D）
      ⑤deno.lock は **Superseded / Platform Constraint**
  位置づけ: 「実施しなかった」のではなく **「生成可能だが現行プラットフォームでは適用不能と実証した」**

最終判定 6 条件の確認（実測）:
  1. 全 Edge Function の直接外部 import が厳密固定  ✅
     - `https://esm.sh/@supabase/supabase-js@2.110.1`（_shared/supabase.ts）
     - `npm:qrcode@1.5.4`（_shared/qr.ts）
  2. 浮動メジャー・latest・branch・未指定バージョン  ✅ **0 件**（実測）
  3. import 走査の回帰テストが存在              ✅ tests/edge_dependencies.test.mjs
     （全 .ts を走査して浮動指定 0 を強制／Edge とブラウザの supabase-js 版一致も検証）
  4. 定期確認手順が文書化                       ✅ 親計画 付録D-3（四半期ごと＋大会準備開始時／
     一覧コマンド・脆弱性確認・更新手順・記録先・「大会直前は更新しない」まで明記）
  5. deno.lock が適用不能であることの実証        ✅ 付録D-4（下記 Evidence）
  6. 残余リスクの文書化                          ✅ 付録D-5

Evidence（実験結果・秘密値は含まない）:
  - **Deno 2.9.4** で本番と同じ依存の deno.lock 生成に**成功**
  - 生成された lock に **npm 依存 29 件・remote 依存 11 件が integrity 付きで記録**された
    （公開パッケージの版とハッシュのみ）
  - 使い捨て Function に deno.json と deno.lock を同梱してデプロイ →
    アップロードされた資産は **deno.json と index.ts のみ／deno.lock はアップロードされなかった**
  - lock の integrity を**意図的に破損させてもデプロイは成功**（＝lock は検証に使われない）
  - **Supabase CLI に lock 適用オプションは存在しない**
  - 検証用 Function を**削除し、元の 12 Function 構成へ復帰**（invoke 404・一覧に非存在を確認）

残余リスク（親計画完了の必須残件ではない・付録D-5 と同内容）:
  - `npm:qrcode@1.5.4` の推移的依存に **semver 範囲**が含まれる（pngjs ^5.0.0 / yargs ^15.3.1 / dijkstrajs ^1.0.1）
  - 再デプロイ時に推移的依存の解決結果が変わる可能性を**完全には排除できない**
  - **影響範囲は現在 二次元コード 画像生成に限定**（checkin-qr / my-entry / admin-entry-qr）
  - 完全な決定性には qrcode の **vendoring もしくは別実装への置換**が必要
  - **依存基盤の変更時に再評価する技術的残余リスク**として扱う（新しい V 番号や Backlog 項目は作らない）

Rollback: 要件改訂は文書のみ。依存の版を戻す場合は指定を書き換えて再デプロイ
```

### 親計画 全体判定 → **Baseline v1.0 として凍結**（2026-07-27）
```
Phase 1 (V1・V2・V4・V6)        : ✅ Completed
Phase 2 (V3・V5・V8・V10・V12)  : ✅ Completed
Phase 3 (V7・V9・V11・V13)      : ✅ Completed
親計画 V1〜V13                  : ✅ **Completed**

Baseline:
  Status         : Completed
  Version        : 1.0（Baseline / 凍結）
  Last validated : 2026-07-27
  Scope          : V1〜V13（対象コミット 9423c47 / レビュー日 2026-07-08）

凍結後の運用ルール（親計画の冒頭に明記）:
  1. 親計画に V 番号を追加しない（V14 以降を作らない）。Phase 4 以降も作らない
  2. 完了条件はこの時点で固定。以後の改訂は「実装手段の Superseded」等、
     理由と Evidence を改訂履歴に残す場合のみ（V13 の deno.lock がその例）
  3. 凍結後に発見した新規事項は「Additional Security Backlog（親計画外）」へ積む
  4. 体系的な見直しが必要になったら、本書を増殖させず「Security Plan v2」を新規作成する

凍結に伴う整理:
  - 親計画 §3 の脆弱性表を **V1〜V13 ちょうど**に戻した
    （一時的に追記していた採点者参加コードの行を表から削除）
  - 採点者参加コードの件は末尾の **Additional Security Backlog / AB-1** へ移設（未着手）
  - 改訂履歴に残っていた「V14」表記も、AB-1 へ移した旨を明記して是正

機械的な担保:
  tests/security_plan_baseline.test.mjs（7 件）が CI で以下を強制する —
  Baseline ヘッダ（Status/Version/Last validated）の存在、脆弱性表が V1〜V13 ちょうどであること、
  計画本体に V14 以降・Phase 4 以降が現れないこと（ルール文自体は除外して判定）、
  Additional Security Backlog セクションと AB-1 の存在、Security Plan v2 への導線、全 Phase の Completed 記載。
  → 「親計画が知らぬ間に膨らむ」ことを人の注意力ではなくテストで防ぐ。
```

### AB-1 採点者参加を招待リンク方式へ置換（親計画外・Additional Security Backlog）
```
Status  : Completed — 2026-07-27（破壊的変更。本番運用前のため既存互換は不要と合意）

① 監査で判明した脅威（当初記述の訂正を含む）
  - 当初の想定「参加コードが短く低エントロピー → 総当たりで復元可能」は **誤り**。
    実測: generateStrongPassword() = 14 文字 / 英数 62 種 / CSPRNG（剰余バイアス除去）＝ **約 83 bit**。
    無塩 SHA-256 でも総当たり・レインボーテーブルは非現実的だった。
  - **真の問題は pass-the-hash**: join_project_with_scorer_code は
    `scorer_access_code_hash <> p_access_code_hash` と **クライアント計算のハッシュを直接比較**していた
    ＝ 保存値そのものが資格情報。
    さらに projects の RLS は is_project_member、列権限にも当該列が含まれ、
    クライアントは `select('*')` していたため、**参加済み採点者が値を読み出して第三者へ配布可能**。
    無効化・再発行の手段も無く、除名しても別アカウント＋ハッシュで再参加できた。

② 採用した対応（方針変更）
  現行方式の pepper 化ではなく、**認証方式そのものを招待リンクへ置換**。

③ 実装
  - migration 202607270001: `project_invites`（id / project_id / token_hash / max_uses / use_count /
    expires_at / revoked_at / created_by / created_at）。RLS は owner/admin の SELECT のみ、
    **列権限から token_hash を除外**。RPC は create/redeem=service_role 限定、revoke=authenticated（内部で admin 判定）
  - `_shared/invite_token.ts`: CSPRNG 32byte → base64url 43 文字。保存は `HMAC(signingSecret, 'invite:'+token)` のみ
  - Edge `create-scorer-invite`（active owner/admin 必須）/ `redeem-scorer-invite`（Google ログイン必須）
  - 有効期限 7 日・role=scorer は **RPC 内で固定**（クライアントは上限人数のみ指定可・1〜500 にクランプ）
  - `join.html` / `js/join.js`: 招待URL → 未ログインならログイン → 参加。判定は全てサーバ側
  - 管理 UI: 上限人数入力・7日/採点者の固定表示・発行・URL コピー・使用人数・有効期限・状態・無効化
  - **削除**: scorer_access_code_hash 列 / join_project_with_scorer_code / 参加コード付き
    create_project_with_owner オーバーロード / 参加コード入力 UI / 参加コード生成処理

④ 監査項目 10 点の検証結果（本番実測）
  1 招待リンクなしでは参加不可     : redeem 未認証 → **401**、形式不正 → **400**、create 未認証 → **401**
  2 期限切れ                      : `Invite expired` で拒否
  3 revoked                       : `Invite revoked` で拒否
  4 使用回数上限                  : `Invite exhausted` で拒否
  5 **並列でも上限を超えない**     : max_uses=2 に 10 並列 → **2 件のみ UPDATED / 8 件 BLOCKED / use_count=2**
  6 平文をDB保存しない            : 列は token_hash のみ。平文は発行応答に一度だけ（再表示不可）
  7 token_hash がクライアントへ出ない: 列権限から除外。anon の select は **42501 permission denied**
  8 招待URL再利用                 : 既存メンバーの再訪は `already_member=true` で **使用回数を消費しない**
  9 監査ログ                      : `scorer_invite.create` / `scorer_invite.redeem`（actor_kind=staff・HMAC 化 IP）
  10 回帰テスト                   : tests/scorer_invite.test.mjs（19 件）。`npx vitest run` = 238 passed
  - 旧 RPC の消滅                 : `rpc/join_project_with_scorer_code` → **404**
  - FK 制約により偽ユーザーでの引き換えは失敗し、その際 use_count が 0 のままだったことから
    **加算とメンバー追加が同一トランザクションで巻き戻る**ことも確認
  - 検証用データは全削除（project_invites 0 件・probe メンバー 0 件）
  - ブラウザ実機: join ページ（未ログイン → サインイン誘導・トークン保持）、
    管理 UI（上限20既定・7日固定・採点者固定・発行前はURL非表示・375px で縦積み・横溢れなし）

Rollback: 旧方式へは戻さない（列・RPC を削除済み）。招待は revoke で即時無効化できる
Notes   : 親計画（V1〜V13 / Baseline v1.0）は**未変更**。本件は Additional Security Backlog として独立管理。
          運用上の注意: 招待リンクは発行時にしか表示できない（平文を保存しないため）。紛失時は再発行する。
```

## 5. 記載フォーマット（今後のエントリ標準）

以後のセキュリティ施策は「計画書」と「実施記録」を分けず、本文書へ**更新型**で 1 エントリずつ記す。
各エントリは次の項目で統一する（Claude Code / Codex / ZCode 共通の書式）。

```
### <施策名>
Status  : Completed / In Progress / Planned / Deprecated（＋更新日）
Evidence:
  - Commits    : <hash> (message)
  - Migrations : <file>
  - Deploys    : <function / target>
  - Verification: 観測 / 静的 / 状態証跡 のどれで確認したか（未検証は明記）
Rollback: Possible / Not possible / Recovery procedure（不可逆なら理由と復旧不能範囲）
Notes   : 補足・再構成の断り・要確認事項
```

- Status は必ず 4 値のいずれか。Planned から着手したら In Progress、完了で Completed、廃止で Deprecated に更新する。
- Evidence は一次証拠（commit / migration / deploy / verification）を必ず埋める。会話やセッション記憶を根拠にしない。
- Verification は強度を明示（観測 > 静的 > 状態証跡）。未確認・対象外は Notes に分けて書く。
- 上記 §1 の P2-e1〜e5 は本テンプレート導入前の記録。内容は等価だが、体裁の統一が要る場合に順次移行する。

## 6. 初期計画（docs/supabase-phase0.md §9「実装フェーズ Phase 1〜5」）の現状整理

**現状整理のみ（新規設計ではない）。** 判定は現在の repo / 本番デプロイ / migration の実証跡に基づく。
出典の初期計画は Firebase→Supabase 移行の設計書（脅威モデル・RLS・認証フローを含む）。参加者ハッシュ v1→v2 等の
**セキュリティ強化**はこの移行の先の継続トラックで、本文書 §1〜§4 が担う。
※ **訂正（2026-07-19）**: セキュリティ強化の親計画は別に存在し、`docs/security-hardening-plan.md`（V1〜V13・Phase 1〜3）として persist 済み。
本 §6 は Firebase→Supabase の**移行**計画（supabase-phase0.md §9）の現状であり、セキュリティ親計画ではない。Phase 1（V1/V2/V4/V6）の監査は上記 §4 と親計画を参照。

### Phase 1 — 基盤 ／ Status: Completed
- [x] Supabase プロジェクト作成・Google OAuth・SQL migration 適用・RLS 適用・Storage バケット+ポリシー・auth JS・index ログイン
- [x] プロジェクト作成＝`202606260004_auth_project_creation` + RLS で実現（専用 `create-project` Function ではなく別実装）

### Phase 2 — 運営・採点 ／ Status: Completed
- [x] メンバー管理＝`invite-member` Function ではなく RPC 群（`202607170001` の update/remove/restore_project_member）＋ admin_settings
- [x] admin JS の Supabase 化・Storage 答案アップロード・judge/question/conflict の Realtime 採点・`final_results`（scoring_flow / conflict_resolution / score_conflicts_rpc）

### Phase 3 — 公開ページ ／ Status: Completed
- [x] create-entry / cancel-entry / edit-entry(=update) / mark-late / disclose-result(=lookup-disclosure) / check-in / public_entry_list + Realtime / send-email(SES) … 全 Edge Function 実在・稼働

### Phase 4 — 仕上げ ／ Status: Completed（1 項目のみ要確認）
- [x] 成績開示・PII 復号＝disclose-result / project-key
- [x] メール認証＝`_shared/email_verify.ts` + verify-code フロー（create-entry がトークン必須）
- [x] CSP / GitHub Pages＝inline script/style 除去済み
- [ ] `seed_test_data` の Supabase 版＝**要確認**（本番機能外の開発補助・未確認）

### Phase 5 — 退役 ／ Status: Completed（一部は外部運用で repo 判定外）
- [x] クライアントの Firebase 撤去＝js/ に firebase 参照 0・README に Firebase 記載なし
- [x] 旧メール送信の Supabase Edge 移管＝send-email
- [~] Firebase プロジェクト停止＝**外部運用操作**のため repo からは判定不可（要確認）

### 移行計画の先＝セキュリティ強化トラック（本文書 §1〜§4 が正典）
- **完了**: 参加者ハッシュ v1→v2 移行（P2-e1〜e5）／機密列制限／public_entry_list PII-free／Edge 認可ゲート回帰／anon RLS・grant マトリクス回帰
- **進行中**: 全公開/認証データフローのセキュリティレビュー（§3 backlog #3・RLS ポリシー本文の逐条レビューが継続）
- **未着手/保留**: authenticated 実行時 RLS（#1b・要 JWT フィクスチャ）／`create_entry_atomic` 死引数除去（#5・保留）／anon 非データ権限の最小化（#8）／cache-bust 一元化（#6）／focused テスト（#7）

## 付記
- **P2-e2 / P2-e3 / P2-e4 のフェーズ境界ラベルは当時コードに未記載**のため、本文書は commit/migration の実証跡から
  再構成した（e2=dual-write 配線、e3=backfill・v2 移行完了、e4=認証/キャンセルの v2 切替）。migration に "P2-e4" の明記あり。
  誤りがあれば当該フェーズの担当セッション記録で補正すること。
- 各 commit ハッシュ・migration 名・現在の DB/デプロイ状態が一次証拠。疑義時はそれらを照合する。
- 更新方針: 新たなセキュリティ作業を行った際は、本文書の該当セクション（フェーズ記録 or バックログ）を
  同一 commit 内で更新し、DB とリポジトリの記録を一致させる。
