import { handleOptions, withCors } from '../_shared/http.ts';
import { makeQrSvg } from '../_shared/qr.ts';
import { issueQrToken } from '../_shared/qr_token.ts';
import { hmacHex, safeEqual, signingSecret, SigningConfigError } from '../_shared/signing.ts';

Deno.serve(withCors(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const url = new URL(req.url);
  const data = url.searchParams.get('d') || '';
  const signature = url.searchParams.get('s') || '';
  if (!data || !signature) return new Response('Not found', { status: 404 });

  let expected: string;
  try {
    expected = await hmacHex(signingSecret(), data);
  } catch (error) {
    if (error instanceof SigningConfigError) {
      console.error('[checkin-qr] signing secret is not configured');
      return new Response('Service unavailable', { status: 503 });
    }
    throw error;
  }
  if (!safeEqual(expected, signature)) return new Response('Not found', { status: 404 });

  // URL 署名の検証後、二次元コード には署名付きトークン(V7)を埋め込む。素の entry UUID は埋め込まない。
  // 画像は表示のたびに生成されるため、既存メールのURLからも新形式の二次元コードが描画される。
  const svg = await makeQrSvg(await issueQrToken(data));
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}));
