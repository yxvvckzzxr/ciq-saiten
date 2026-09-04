// qr_token.ts — 当日受付二次元コードの署名付きペイロード（V7）。
//
// 背景: 従来の 二次元コード は素の entry UUID を埋め込んでいた。UUID は公開エントリーリストから取得可能で、
//   誰でも他人の 二次元コード を生成して受付を通せた（なりすまし受付）。また有効期限が無く使い回しできた。
//
// 形式: `<entryId>.<expMs>.<sig>`
//   sig = HMAC-SHA256(signingSecret, `qr:<entryId>:<expMs>`)
//   - 署名鍵は V1 で必須化済みの CIQ_EMAIL_SIGNING_SECRET（未設定なら SigningConfigError → 上位で 503）。
//   - exp を含めるため、漏洩した 二次元コード の有効期間が有限になる。
//   - 二次元コード 画像は表示のたびにサーバ側で生成されるため、鍵ローテーションや期限切れは再表示で解決する。
//
// 互換性: 旧 二次元コード（素の UUID）は verifyQrToken() が null を返す＝受付側で拒否する（fail-closed）。
//   運用のフォールバックとして受付 UI に「受付番号で受付」を用意している。

import { hmacHex, safeEqual, signingSecret } from './signing.ts';

// 有効期間（V7 再評価）。
// 二次元コード 画像は表示のたびにサーバ側で再生成されるため、本来必要な有効期間は「画像が描画された時点 → 受付」だけ。
// 長い期間が要るのは、メールクライアント（Gmail 等）が画像をキャッシュした場合や、参加者が画像を保存した場合で、
// その分だけ「登録 → 大会当日」を跨ぐ。したがって既定は登録受付期間を覆う程度に留め、無期限化しない。
// 期限切れ時の運用フォールバック: マイエントリーで再表示（常に新しい二次元コード）／受付番号での受付。
//
// CIQ_QR_TTL_DAYS で運用に合わせて調整する（既定 30 日 / 1〜400 日にクランプ）。
// 大会直前に短くするほど、盗撮・転送された二次元コードのリプレイ可能期間が短くなる。
const DEFAULT_TTL_DAYS = 30;
const MIN_TTL_DAYS = 1;
const MAX_TTL_DAYS = 400;

function configuredTtlMs(): number {
  const raw = Number(Deno.env.get('CIQ_QR_TTL_DAYS'));
  const days = Number.isFinite(raw) && raw > 0
    ? Math.min(Math.max(Math.floor(raw), MIN_TTL_DAYS), MAX_TTL_DAYS)
    : DEFAULT_TTL_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 署名対象。用途タグ + バージョンを含めることで、
//  (a) 他用途の署名（参加者トークン=base64url JSON / 受付二次元コード URL=素のUUID / 認証コード）と衝突しない
//  (b) 将来フォーマットを変える際に旧トークンを一括失効できる
const TOKEN_VERSION = 'qr1';
function payload(entryId: string, expMs: number) {
  return `${TOKEN_VERSION}:${entryId}:${expMs}`;
}

/** 署名付き二次元コードトークンを発行する。entryId は UUID 形式であること。 */
export async function issueQrToken(entryId: string, ttlMs?: number): Promise<string> {
  const id = String(entryId || '').trim();
  if (!UUID_RE.test(id)) throw new Error('issueQrToken: entryId must be a UUID');
  const expMs = Date.now() + (Number.isFinite(ttlMs) ? (ttlMs as number) : configuredTtlMs());
  const sig = await hmacHex(signingSecret(), payload(id, expMs));
  return `${id}.${expMs}.${sig}`;
}

/**
 * 二次元コードトークンを検証して entryId を返す。無効・改ざん・期限切れ・旧形式(素のUUID)は null。
 * 署名鍵未設定時は SigningConfigError を送出する（呼び出し側で 503 にマップする）。
 */
export async function verifyQrToken(raw: unknown): Promise<string | null> {
  if (typeof raw !== 'string') return null;
  const parts = raw.trim().split('.');
  if (parts.length !== 3) return null;   // 旧形式(素のUUID)はここで弾かれる
  const [id, expRaw, sig] = parts;
  if (!UUID_RE.test(id)) return null;
  const expMs = Number(expRaw);
  if (!Number.isFinite(expMs) || expMs <= 0) return null;
  if (Date.now() > expMs) return null;   // 期限切れ
  const expected = await hmacHex(signingSecret(), payload(id, expMs));
  if (!safeEqual(expected, sig)) return null;
  return id;
}
