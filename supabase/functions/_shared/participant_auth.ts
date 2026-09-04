// participant_auth.ts — 参加者(エントリー本人)向けの共通認証
//
// 2つの認証経路を提供する:
//   1. credentials: emailHash + disclosurePasswordHash の照合(従来方式)
//   2. token:       my-entry が発行する短命署名トークン(sessionStorage 保持前提)
//
// トークン形式: base64url(JSON payload) + '.' + hmacHex(payload)
//   payload = { p: projectId, e: entryId, h: emailHash, x: expiresAtMs }
// パスワード(平文/ハッシュ)はトークンに含めない。

import { createServiceClient } from './supabase.ts';
import { hmacHex, safeEqual, signingSecret } from './signing.ts';
import { enforceIpRateLimit, RateLimitError } from './rate_limit.ts';
import { ParticipantHashConfigError, pepperHash } from './participant_hash.ts';

const encoder = new TextEncoder();

export { hmacHex, safeEqual, signingSecret };
// credential 経路の pepper 障害を各 Function が 503 にマップするため再輸出する。
export { ParticipantHashConfigError };

// pepper 設定障害時に参加者へ返す固定の公開文言(内部情報は含めない)。
export const PARTICIPANT_CONFIG_ERROR_MESSAGE =
  'ただいま参加者認証を利用できません。時間をおいて再度お試しください。';

// クライアント SHA-256(hex) の形式検証: 64文字・小文字16進・前後空白なし。
const CLIENT_HASH_RE = /^[0-9a-f]{64}$/;
function isClientHash(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_HASH_RE.test(value);
}

export const PARTICIPANT_TOKEN_TTL_MS = 30 * 60 * 1000; // 30分(操作ごとにスライド延長)

function b64urlEncode(value: string) {
  return btoa(String.fromCharCode(...encoder.encode(value)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function b64urlDecode(value: string) {
  const b64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export type ParticipantTokenPayload = {
  p: string; // projectId
  e: string; // entryId
  h: string; // emailHash
  x: number; // expiresAt (ms)
};

export async function issueParticipantToken(
  data: { projectId: string; entryId: string; emailHash: string },
  ttlMs = PARTICIPANT_TOKEN_TTL_MS,
) {
  const payload: ParticipantTokenPayload = {
    p: data.projectId,
    e: data.entryId,
    h: data.emailHash,
    x: Date.now() + ttlMs,
  };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmacHex(signingSecret(), body);
  return { token: `${body}.${sig}`, expiresAt: payload.x };
}

export async function verifyParticipantToken(token: string, projectId: string) {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacHex(signingSecret(), body);
  if (!safeEqual(expected, sig)) return null;
  let payload: ParticipantTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body));
  } catch {
    return null;
  }
  if (!payload || payload.p !== projectId) return null;
  if (!payload.e || !payload.h) return null;
  if (!Number.isFinite(payload.x) || Date.now() > payload.x) return null;
  return payload;
}

/**
 * 当日受付二次元コードの署名付き画像URL(checkin-qr)を生成する。
 * メール(send-email)と同一のデータ・同一の署名鍵を使うため、
 * my.html で表示した二次元コードは受付側でそのまま読み取れる。
 */
export async function signedQrUrl(value: string) {
  if (!value) return '';
  const signature = await hmacHex(signingSecret(), value);
  const baseUrl = Deno.env.get('SUPABASE_URL') || '';
  if (!baseUrl) return '';
  const url = new URL('/functions/v1/checkin-qr', baseUrl);
  url.searchParams.set('d', value);
  url.searchParams.set('s', signature);
  return url.href;
}

export type ParticipantAuthResult = {
  entry: Record<string, unknown>;
  emailHash: string;
  viaToken: boolean;
};

export class ParticipantAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/**
 * 認証試行のレート制限。emailHash単位で10分間の失敗回数を制限する。
 * (participant_auth_events テーブル / service role 専用)
 */
export async function enforceAuthRateLimit(
  supabase: ReturnType<typeof createServiceClient>,
  projectId: string,
  emailHash: string,
  limit = 10,
) {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('participant_auth_events')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('email_hash', emailHash)
    .eq('success', false)
    .gte('created_at', since);
  if (error) throw error;
  if ((count || 0) >= limit) {
    throw new ParticipantAuthError('試行回数が上限に達しました。しばらく待ってからお試しください。', 429);
  }
}

export async function recordAuthAttempt(
  supabase: ReturnType<typeof createServiceClient>,
  projectId: string,
  emailHash: string,
  success: boolean,
) {
  await supabase
    .from('participant_auth_events')
    .insert({ project_id: projectId, email_hash: emailHash, success })
    .then(() => undefined, () => undefined); // 記録失敗は本処理を止めない
}

/**
 * リクエストボディから参加者認証を解決する。
 * - body.token があればトークン検証(署名検証済みの entryId を id で引く。旧 email_hash 照合はしない)
 * - なければ emailHash + disclosurePasswordHash を pepper 化し v2 列で照合(レート制限つき)
 * 返す entry には select で指定した列が含まれる。
 */
export async function resolveParticipantAuth(
  supabase: ReturnType<typeof createServiceClient>,
  body: { projectId?: string; token?: string; emailHash?: string; disclosurePasswordHash?: string },
  select: string,
  options: { ip?: string } = {},
): Promise<ParticipantAuthResult> {
  const projectId = String(body.projectId || '');
  if (!projectId) throw new ParticipantAuthError('プロジェクト情報が見つかりません。メール内のリンクから開き直してください。', 400);

  // IP単位のレート制限(fail-open)。超過は 429 として既存catchに委ねる。
  // token/credentials 両経路の乱用を入口で抑える。
  if (options.ip) {
    try {
      await enforceIpRateLimit(supabase, { bucket: 'participant_auth', ip: options.ip, projectId });
    } catch (error) {
      if (error instanceof RateLimitError) throw new ParticipantAuthError(error.message, error.status);
      throw error;
    }
  }

  // 認証済み entry の返却列は呼出側の select のみ(旧 email_hash 列は付加しない)。
  const columns = select;

  if (body.token) {
    const payload = await verifyParticipantToken(String(body.token), projectId);
    if (!payload) throw new ParticipantAuthError('セッションの有効期限が切れました。もう一度ログインしてください。', 401);
    // トークンは署名検証済みで entryId(payload.e) を認証する。id + project_id で解決し、
    // 旧 email_hash 列との照合は行わない(P2-e5: token 経路の旧列依存を撤去。token 形式は不変)。
    const { data: entry, error } = await supabase
      .from('entries')
      .select(columns)
      .eq('project_id', projectId)
      .eq('id', payload.e)
      .single();
    if (error || !entry) throw new ParticipantAuthError('エントリーが見つかりません。', 404);
    return { entry, emailHash: payload.h, viaToken: true };
  }

  const emailHash = body.emailHash;
  const passwordHash = body.disclosurePasswordHash;
  // 形式検証(string/64/小文字hex/前後空白なし)。不正は認証失敗と同一応答へ流し、値はログに出さない。
  if (!isClientHash(emailHash) || !isClientHash(passwordHash)) {
    throw new ParticipantAuthError('メールアドレスまたはパスワードが正しくありません。', 404);
  }

  // v2 は必ず Edge 内で生成する(クライアントからは受け取らない)。
  // pepper 設定障害(ParticipantHashConfigError)はここで上位へ伝播し、認証は 503 で停止する。
  const emailHashV2 = await pepperHash(emailHash);
  const passwordHashV2 = await pepperHash(passwordHash);

  // レート制限台帳(participant_auth_events)には pepper 済みの値のみを保存・照合する
  // (V3: DB 流出時のメール列挙を防ぐ。既存列をそのまま HMAC 値に切り替え、v2 列は作らない)。
  await enforceAuthRateLimit(supabase, projectId, emailHashV2);

  // v2 認証(P2-e5: 旧列 fallback は撤去。全行 v2 済みのため v2 単独で照合する)。
  // 0件(正常な不一致)と DBエラーを区別する: object強制(.single()/.maybeSingle())は 0件時に
  // PGRST116(406)を返すため使わず、.limit(1) 配列で「DBエラー(error!=null)」と「0件(空配列)」を分ける。
  const { data: v2Rows, error: v2Error } = await supabase
    .from('entries')
    .select(columns)
    .eq('project_id', projectId)
    .eq('email_hash_v2', emailHashV2)
    .eq('disclosure_password_hash_v2', passwordHashV2)
    .not('email_hash_v2', 'is', null)
    .not('disclosure_password_hash_v2', 'is', null)
    .limit(1);
  if (v2Error) throw v2Error;
  const v2Entry = v2Rows && v2Rows.length > 0 ? v2Rows[0] : null;
  if (v2Entry) {
    await recordAuthAttempt(supabase, projectId, emailHashV2, true);
    return { entry: v2Entry, emailHash, viaToken: false };
  }

  // v2 不一致のときだけ、失敗を1回記録する。
  await recordAuthAttempt(supabase, projectId, emailHashV2, false);
  throw new ParticipantAuthError('メールアドレスまたはパスワードが正しくありません。', 404);
}
