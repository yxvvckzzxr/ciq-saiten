import { handleOptions, jsonResponse, serverErrorResponse, withCors } from '../_shared/http.ts';
import { makeQrSvg } from '../_shared/qr.ts';
import { issueQrToken } from '../_shared/qr_token.ts';
import { createServiceClient } from '../_shared/supabase.ts';

type SupabaseClient = ReturnType<typeof createServiceClient>;

async function requireAdminMember(supabase: SupabaseClient, req: Request, projectId: string) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Authentication required');

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) throw new Error('Authentication required');

  const { data: member, error: memberError } = await supabase
    .from('project_members')
    .select('id, role, status')
    .eq('project_id', projectId)
    .eq('user_id', userData.user.id)
    .single();
  if (memberError || !member || member.status !== 'active') throw new Error('Forbidden');
  if (member.role !== 'owner' && member.role !== 'admin') throw new Error('Forbidden');
}

Deno.serve(withCors(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { projectId, entryId } = await req.json();
    if (!projectId || !entryId) return jsonResponse({ error: '二次元コードの取得に必要な情報が不足しています。参加者一覧を再読み込みしてください。' }, 400);

    const supabase = createServiceClient();
    await requireAdminMember(supabase, req, projectId);

    const { data: entry, error } = await supabase
      .from('entries')
      .select('id')
      .eq('project_id', projectId)
      .eq('id', entryId)
      .single();
    if (error || !entry) return jsonResponse({ error: 'エントリーが見つかりません。' }, 404);

    // 署名付きトークン(V7)。素の entry UUID は 二次元コード に埋め込まない。
    const svg = await makeQrSvg(await issueQrToken(entry.id));
    return jsonResponse({ ok: true, svg });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Forbidden') {
      return jsonResponse({ error: 'このプロジェクトの二次元コードを取得する権限がありません。' }, 403);
    }
    if (message === 'Authentication required') {
      return jsonResponse({ error: 'Googleログインが必要です。' }, 401);
    }
    return serverErrorResponse(error, 'admin-entry-qr');
  }
}));
