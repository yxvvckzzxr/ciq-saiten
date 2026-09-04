// signing.ts — HMAC署名の共通モジュール(参加者トークン / 受付二次元コード / メール認証コード)
//
// 署名鍵は必ず環境変数から供給する。SUPABASE_URL(公開値)や固定文字列への
// フォールバックは持たない。鍵が未設定なら SigningConfigError を投げ、
// 「弱い鍵で署名を発行し続ける」より安全側(処理停止)に倒す。
//
// send-email(二次元コード生成) / checkin-qr(二次元コード検証) / participant_auth(トークン・二次元コード再表示)は
// すべてこの signingSecret() を共有するため、同一鍵で相互に検証できる。

const encoder = new TextEncoder();

// 署名鍵の最小長。openssl rand -hex 32 は64文字(=32バイトの16進)なので、この下限を満たす。
// 短すぎる鍵はブルートフォース耐性が低いため、未設定と同じく安全側(処理停止)に倒す。
const MIN_SECRET_LENGTH = 32;

/** 署名鍵が未設定・または短すぎるときに投げる型付きエラー。呼び出し側は汎用メッセージにマップする。 */
export class SigningConfigError extends Error {
  constructor() {
    super('Signing secret is not configured');
    this.name = 'SigningConfigError';
  }
}

/**
 * HMAC署名鍵を返す。
 * CIQ_EMAIL_SIGNING_SECRET を優先し、無ければ CIQ_EDGE_INTERNAL_SECRET を使う。
 * 未設定・空・MIN_SECRET_LENGTH 未満なら例外を投げる。公開値・固定値へは絶対にフォールバックしない。
 */
export function signingSecret(): string {
  const secret = Deno.env.get('CIQ_EMAIL_SIGNING_SECRET')
    || Deno.env.get('CIQ_EDGE_INTERNAL_SECRET');
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new SigningConfigError();
  return secret;
}

export async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 一定時間比較。長さが違えば即 false、同じなら全バイトを走査してタイミング差を消す。 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
