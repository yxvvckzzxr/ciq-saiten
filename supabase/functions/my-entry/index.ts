// my-entry — マイエントリー(my.html)のハブAPI
//
// 認証(emailHash+パスワードハッシュ または 短命トークン)に成功すると、
//   - エントリーサマリー(公開プロフィール + 状態)
//   - 当日受付二次元コードの署名付き画像URL(メールと同一データ・同一署名)
//   - スライド延長された新しいセッショントークン
// を返す。パスワードや復号PIIは返さない・保存しない。

import { handleOptions, jsonResponse, serverErrorResponse, withCors } from '../_shared/http.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import {
  PARTICIPANT_CONFIG_ERROR_MESSAGE,
  ParticipantAuthError,
  ParticipantHashConfigError,
  issueParticipantToken,
  resolveParticipantAuth,
} from '../_shared/participant_auth.ts';
import { SigningConfigError } from '../_shared/signing.ts';
import { clientIp } from '../_shared/rate_limit.ts';
import { makeQrSvg } from '../_shared/qr.ts';
import { issueQrToken } from '../_shared/qr_token.ts';

const ENTRY_COLUMNS = [
  'id',
  'entry_number',
  'status',
  'checked_in',
  'entry_name',
  'affiliation',
  'grade',
  'message',
  'inquiry',
  'is_chubu',
  'created_at',
].join(', ');

function isWithinPeriod(start: string | null, end: string | null) {
  const now = Date.now();
  if (start && new Date(start).getTime() > now) return false;
  if (end && new Date(end).getTime() < now) return false;
  return true;
}

Deno.serve(withCors(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json();
    const projectId = String(body.projectId || '');
    if (!projectId) return jsonResponse({ error: 'プロジェクト情報が見つかりません。メール内のリンクから開き直してください。' }, 400);

    const supabase = createServiceClient();
    const { entry, emailHash } = await resolveParticipantAuth(supabase, body, ENTRY_COLUMNS, { ip: clientIp(req) });

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('name, entry_open, period_start, period_end, disclosure_enabled, disclosure_period_start, disclosure_period_end')
      .eq('id', projectId)
      .single();
    if (projectError || !project) return jsonResponse({ error: 'Project not found' }, 404);

    const entryId = String(entry.id);
    const status = String(entry.status || '');
    const checkedIn = entry.checked_in === true;

    // キャンセル済みでもサマリーは返す(状態を本人が確認できることが目的)。
    // 操作可否はクライアント表示 + 各Edge Functionの再検証で二重に守る。
    const editable = !checkedIn
      && (status === 'registered' || status === 'waitlist')
      && project.entry_open === true
      && isWithinPeriod(project.period_start, project.period_end);

    const canMarkLate = !checkedIn && status === 'registered';
    const cancellable = !checkedIn && status !== 'canceled';

    const disclosureOpen = project.disclosure_enabled === true
      && isWithinPeriod(project.disclosure_period_start, project.disclosure_period_end);

    // 当日受付二次元コード — 署名付きトークン(V7)を埋め込む。素の entry UUID は埋め込まない。
    // メール(send-email/checkin-qr)と同一形式なので受付側でそのまま読める。
    // キャンセル済みの二次元コードは受付で弾かれるため返さない。
    const qrSvg = status === 'canceled' ? '' : await makeQrSvg(await issueQrToken(entryId));

    const { token, expiresAt } = await issueParticipantToken({ projectId, entryId, emailHash });

    return jsonResponse({
      ok: true,
      token,
      tokenExpiresAt: expiresAt,
      projectName: project.name || projectId,
      qrSvg,
      capabilities: { editable, canMarkLate, cancellable, disclosureOpen },
      entry: {
        id: entryId,
        entryNumber: entry.entry_number,
        status,
        checkedIn,
        entryName: entry.entry_name,
        affiliation: entry.affiliation,
        grade: entry.grade,
        message: entry.message,
        inquiry: entry.inquiry,
        isChubu: entry.is_chubu === true,
      },
    });
  } catch (error) {
    if (error instanceof ParticipantAuthError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof SigningConfigError) {
      console.error('[my-entry] signing secret is not configured');
      return jsonResponse({ error: 'ただいまこの操作を受け付けられません。時間をおいて再度お試しください。' }, 503);
    }
    if (error instanceof ParticipantHashConfigError) {
      console.error('[my-entry] participant hash pepper is not configured');
      return jsonResponse({ error: PARTICIPANT_CONFIG_ERROR_MESSAGE }, 503);
    }
    return serverErrorResponse(error, 'my-entry');
  }
}));
