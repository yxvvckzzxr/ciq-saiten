// invite_token.ts — 採点者招待リンクのトークン（AB-1）。
//
// - トークンは CSPRNG（crypto.getRandomValues）で生成する。32 バイト = 256 ビット。
// - DB には **平文を保存しない**。保存するのは HMAC(signingSecret, 'invite:' + token) のみ。
//   → DB が流出しても、そこから招待リンクを復元して参加することはできない。
// - 署名鍵は V1 で必須化済み（未設定なら SigningConfigError → 上位で 503）。
// - 用途タグ 'invite:' で他用途の署名（参加者トークン / 受付二次元コード / 認証コード）と分離する。

import { hmacHex, signingSecret } from './signing.ts';

const TOKEN_BYTES = 32;

/** URL に載せるため base64url（パディングなし）で符号化する。 */
function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** CSPRNG で招待トークン（256bit / base64url 43文字）を生成する。 */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** トークンから DB 保存用のハッシュを作る。平文は保存も返却もしない。 */
export function inviteTokenHash(token: string): Promise<string> {
  return hmacHex(signingSecret(), `invite:${token}`);
}

/** URL 由来のトークンとして妥当な形か（長さ・文字種）。DB 照会前の早期棄却に使う。 */
export function isPlausibleInviteToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(value);
}
