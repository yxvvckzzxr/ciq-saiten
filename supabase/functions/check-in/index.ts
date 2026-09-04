import { handleOptions, jsonResponse, serverErrorResponse, withCors } from '../_shared/http.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { clientIp, clientIpHash, enforceIpRateLimit, RateLimitError } from '../_shared/rate_limit.ts';
import { verifyQrToken } from '../_shared/qr_token.ts';
import { logServiceEvent } from '../_shared/audit.ts';

type Role = 'owner' | 'admin' | 'scorer';

const DESK_ROLES: Role[] = ['owner', 'admin', 'scorer'];
// 受付番号を起点にする操作(手入力受付・取り消し)は運営限定。
// 受付卓は scorer が担当することがあり、その端末は参加者に向いているため
// (checkin.html は「参加者が画面に二次元コードをかざす」前提のレイアウト)、
// 番号だけで状態を書き換えられる経路をその端末に残さない。
const STAFF_ONLY_ROLES: Role[] = ['owner', 'admin'];

const ENTRY_COLUMNS = 'id, entry_number, entry_name, affiliation, grade, status, checked_in';

async function requireProjectMember(
  supabase: ReturnType<typeof createServiceClient>,
  req: Request,
  projectId: string,
  allowedRoles: Role[],
) {
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
  // V11: 除名直後に JWT が残っていても通さないよう、admin-* と同じ「active かつ想定ロール」を明示する。
  // (status <> 'removed' の否定形だと、将来 'suspended' 等が増えたときに素通りしてしまう)
  if (memberError || !member || member.status !== 'active') throw new Error('Forbidden');
  if (!allowedRoles.includes(member.role as Role)) throw new Error('Forbidden');
  return member;
}

function entryPayload(entry: Record<string, unknown>) {
  return {
    id: entry.id,
    entryNumber: entry.entry_number,
    entryName: entry.entry_name,
    affiliation: entry.affiliation,
    grade: entry.grade,
    status: entry.status,
    checkedIn: entry.checked_in,
  };
}

// 見つからない照会だけを IP 単位で制限する(受付番号の総当たり・列挙対策)。
// 正常な受付はカウントしないので、当日の連続受付は制限にかからない。
// (二次元コード が全滅して全員を手入力で捌く事態でも詰まらないよう、成功側には制限を置かない)
async function findEntry(
  supabase: ReturnType<typeof createServiceClient>,
  req: Request,
  projectId: string,
  by: { id: string } | { entryNumber: number },
) {
  let query = supabase.from('entries').select(ENTRY_COLUMNS).eq('project_id', projectId);
  query = 'id' in by ? query.eq('id', by.id) : query.eq('entry_number', by.entryNumber);

  const { data: entry, error } = await query.single();
  if (error || !entry) {
    await enforceIpRateLimit(supabase, { bucket: 'checkin_miss', ip: clientIp(req), projectId });
    return null;
  }
  return entry;
}

function parseEntryNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

Deno.serve(withCors(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { action, projectId, entryId, qr, entryNumber, confirmedEntryId } = await req.json();
    if (!projectId || !action) return jsonResponse({ error: '当日受付のリクエスト情報が不足しています。ページを開き直してください。' }, 400);

    const supabase = createServiceClient();

    if (action === 'stats') {
      await requireProjectMember(supabase, req, projectId, DESK_ROLES);
      const { data: entries, error } = await supabase
        .from('entries')
        .select('checked_in, status')
        .eq('project_id', projectId)
        .in('status', ['registered', 'late']);
      if (error) throw error;
      const total = entries?.length || 0;
      const checked = (entries || []).filter((entry) => entry.checked_in).length;
      return jsonResponse({
        ok: true,
        stats: { total, checked, remaining: total - checked },
      });
    }

    // (a) 二次元コード 受付: 署名付きトークン(V7)のみ。素の entry UUID も受付番号も受け付けない。
    if (action === 'check') {
      const member = await requireProjectMember(supabase, req, projectId, DESK_ROLES);

      const scanned = qr ?? entryId; // entryId は後方互換の受け口(中身は署名付きトークン)
      if (scanned === undefined || scanned === null || String(scanned).length === 0) {
        return jsonResponse({ error: '二次元コードが必要です。' }, 400);
      }
      const verifiedId = await verifyQrToken(scanned);
      if (!verifiedId) {
        return jsonResponse({
          error: 'この二次元コードは使用できません。マイエントリーで最新の二次元コードを表示するか、運営にお申し出ください。',
        }, 400);
      }

      const entry = await findEntry(supabase, req, projectId, { id: verifiedId });
      if (!entry) return jsonResponse({ error: '該当者が見つかりません。' }, 404);
      return await commitCheckIn(supabase, req, projectId, entry, member?.id ?? null);
    }

    // (b) 手入力での照会: 状態を一切変えない。運営が氏名・所属を目視確認するための第一段階。
    if (action === 'lookup') {
      await requireProjectMember(supabase, req, projectId, STAFF_ONLY_ROLES);
      const num = parseEntryNumber(entryNumber);
      if (num === null) return jsonResponse({ error: '受付番号が必要です。' }, 400);

      const entry = await findEntry(supabase, req, projectId, { entryNumber: num });
      if (!entry) return jsonResponse({ error: '該当者が見つかりません。' }, 404);
      return jsonResponse({ ok: true, entry: entryPayload(entry) });
    }

    // (c) 手入力での受付確定 / (d) 受付の取り消し。
    // 受付番号は公開情報(public_entry_list が anon に entry_number と checked_in を出している)ため、
    // 「番号を知っていること」は認証材料にならない。運営が lookup で氏名・所属を目視確認し、
    // そこで得た id を confirmedEntryId として送り返すことを必須にする。
    // 打ち間違いで別人を受付済みにする事故の防止も兼ねる。
    if (action === 'check_manual' || action === 'undo') {
      const member = await requireProjectMember(supabase, req, projectId, STAFF_ONLY_ROLES);
      const num = parseEntryNumber(entryNumber);
      if (num === null) return jsonResponse({ error: '受付番号が必要です。' }, 400);
      if (!confirmedEntryId) {
        return jsonResponse({ error: '確認手順を経ていません。もう一度照会からやり直してください。' }, 400);
      }

      const entry = await findEntry(supabase, req, projectId, { entryNumber: num });
      if (!entry) return jsonResponse({ error: '該当者が見つかりません。' }, 404);
      // 照会後に名簿が変わった場合(番号の付け替え等)は確定させない。
      if (String(entry.id) !== String(confirmedEntryId)) {
        return jsonResponse({ error: '照会した内容と一致しません。もう一度照会からやり直してください。' }, 409);
      }

      if (action === 'undo') {
        return await commitUndo(supabase, req, projectId, entry, member?.id ?? null);
      }
      return await commitCheckIn(supabase, req, projectId, entry, member?.id ?? null);
    }

    return jsonResponse({ error: 'Invalid action' }, 400);
  } catch (error) {
    if (error instanceof RateLimitError) return jsonResponse({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Forbidden') {
      return jsonResponse({ error: 'このプロジェクトの当日受付を操作する権限がありません。Googleアカウントとプロジェクトを確認してください。' }, 403);
    }
    if (message === 'Authentication required') {
      return jsonResponse({ error: 'Googleログインが必要です。' }, 401);
    }
    return serverErrorResponse(error, 'check-in');
  }
}));

async function commitCheckIn(
  supabase: ReturnType<typeof createServiceClient>,
  req: Request,
  projectId: string,
  entry: Record<string, unknown>,
  actorMemberId: string | null,
) {
  if (entry.status === 'canceled') {
    return jsonResponse({ ok: true, result: 'canceled', entry: entryPayload(entry) });
  }
  if (entry.status === 'waitlist') {
    return jsonResponse({ ok: true, result: 'waitlist', entry: entryPayload(entry) });
  }
  if (entry.checked_in) {
    return jsonResponse({ ok: true, result: 'already', entry: entryPayload(entry) });
  }

  const { data: updated, error: updateError } = await supabase
    .from('entries')
    .update({ checked_in: true })
    .eq('id', entry.id)
    .eq('checked_in', false)
    .in('status', ['registered', 'late'])
    .select(ENTRY_COLUMNS)
    .single();
  if (updateError || !updated) {
    return jsonResponse({ error: '受付対象外になりました。最新の状態を確認してください。' }, 409);
  }

  await logServiceEvent(supabase, {
    projectId,
    action: 'entry.checkin',
    targetId: String(updated.id),
    actorKind: 'staff',
    actorMemberId: actorMemberId ? String(actorMemberId) : null,
    actorIpHash: await clientIpHash(req),
    afterData: { checked_in: true },
  });

  return jsonResponse({ ok: true, result: 'success', entry: entryPayload(updated) });
}

// 受付の取り消し。打ち間違いや誤操作を当日中に戻せるようにするための運営操作で、
// 誰が戻したかを必ず監査ログに残す(受付済みフラグを消す唯一の経路)。
async function commitUndo(
  supabase: ReturnType<typeof createServiceClient>,
  req: Request,
  projectId: string,
  entry: Record<string, unknown>,
  actorMemberId: string | null,
) {
  if (!entry.checked_in) {
    return jsonResponse({ ok: true, result: 'not_checked_in', entry: entryPayload(entry) });
  }

  const { data: updated, error: updateError } = await supabase
    .from('entries')
    .update({ checked_in: false })
    .eq('id', entry.id)
    .eq('checked_in', true)
    .select(ENTRY_COLUMNS)
    .single();
  if (updateError || !updated) {
    return jsonResponse({ error: '取り消しできませんでした。最新の状態を確認してください。' }, 409);
  }

  await logServiceEvent(supabase, {
    projectId,
    action: 'entry.checkin.undo',
    targetId: String(updated.id),
    actorKind: 'staff',
    actorMemberId: actorMemberId ? String(actorMemberId) : null,
    actorIpHash: await clientIpHash(req),
    afterData: { checked_in: false },
  });

  return jsonResponse({ ok: true, result: 'undone', entry: entryPayload(updated) });
}
