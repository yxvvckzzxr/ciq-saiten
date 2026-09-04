// my.js — マイエントリー(参加者ハブ)
// 1回の認証で: 受付番号+二次元コードの確認 / 登録内容の編集 / 遅刻連絡 / 成績照会 / キャンセル。
// 認証状態は my-entry が発行する短命トークンを sessionStorage に保持する
// (タブを閉じると消える。パスワードはどこにも保存しない)。

const params = new URLSearchParams(location.search);
const projectId = params.get('pid') || params.get('projectId') || params.get('project') || session.get('projectId');
const SESSION_KEY = projectId ? `ciqMy:${projectId}` : '';

let projectSettings = null;
let publicKeyJwk = null;
let mySession = null;   // { token, expiresAt, email }
let myEntryData = null; // my-entry の entry
let myCapabilities = {};
let qrSvgText = '';

// ---------- 小道具 ----------

function el(id) { return document.getElementById(id); }

function showEl(node) { node?.classList.remove('u-hidden'); if (node) node.hidden = false; }
function hideEl(node) { node?.classList.add('u-hidden'); }

function setMsg(id, msg, type) {
    const box = el(id);
    if (!box) return;
    if (msg) setPageMessage(box, msg, type || 'info');
    else clearPageMessage(box);
}

async function sendParticipantActionEmail(sendFn, payload, failureLabel) {
    if (typeof sendFn !== 'function') return true;
    try {
        await sendFn(mySession.email, payload);
        return true;
    } catch (error) {
        console.warn(`${failureLabel}メール送信失敗:`, error);
        showToast(`${failureLabel}は完了しましたが、確認メールを送信できませんでした。`, 'warning');
        return false;
    }
}

function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    if (label) button.textContent = label;
}

function isEntryCurrentlyOpen() {
    if (!projectSettings || projectSettings.entryOpen !== true) return false;
    const now = Date.now();
    const start = projectSettings.periodStart ? new Date(projectSettings.periodStart).getTime() : null;
    const end = projectSettings.periodEnd ? new Date(projectSettings.periodEnd).getTime() : null;
    if (Number.isFinite(start) && start > now) return false;
    if (Number.isFinite(end) && end < now) return false;
    return true;
}

function getEntryClosedReason() {
    if (!projectSettings || projectSettings.entryOpen !== true) return '現在、エントリー受付は停止中です。';
    const now = Date.now();
    const start = projectSettings.periodStart ? new Date(projectSettings.periodStart) : null;
    const end = projectSettings.periodEnd ? new Date(projectSettings.periodEnd) : null;
    if (start && start.getTime() > now) return `エントリー受付はまだ開始されていません。開始: ${start.toLocaleString('ja-JP')}`;
    if (end && end.getTime() < now) return `エントリー受付は終了しました。終了: ${end.toLocaleString('ja-JP')}`;
    return '現在、再エントリーできません。';
}

function getParticipantActionPayload() {
    if (!projectId) throw new Error('プロジェクト情報が見つかりません。URLを確認してください。');
    if (!mySession?.token) throw new Error('セッションの有効期限が切れました。もう一度ログインしてください。');
    return { projectId, token: mySession.token };
}

function readStoredSession() {
    if (!SESSION_KEY) return null;
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data?.token || !data?.email) return null;
        if (Number.isFinite(data.expiresAt) && Date.now() > data.expiresAt) return null;
        return data;
    } catch {
        return null;
    }
}

function storeSession(data) {
    mySession = data;
    if (!SESSION_KEY) return;
    try {
        if (data) sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
        else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* storage 不可でもページ内では動作する */ }
}

// 復帰不能な状態は「何が起きたか」を見出しで、「次に何をするか」を本文で示す。
// 枠で囲わず、ページそのものの状態として表示する。
function showFatal(title, detail = '') {
    const container = document.querySelector('.page-container');
    if (!container) return;
    container.textContent = '';
    const state = document.createElement('div');
    state.className = 'error-state';
    state.setAttribute('role', 'alert');
    const heading = document.createElement('p');
    heading.className = 'error-state-title';
    heading.textContent = title;
    state.appendChild(heading);
    if (detail) {
        const p = document.createElement('p');
        p.className = 'error-state-detail';
        p.textContent = detail;
        state.appendChild(p);
    }
    container.appendChild(state);
}

// ---------- 初期化 ----------

async function init() {
    if (!projectId) {
        showFatal('大会が特定できません', 'エントリー完了メールに記載されたマイエントリーのリンクから開いてください。');
        return;
    }

    el('my-terms-link').href = `terms.html?pid=${encodeURIComponent(projectId)}`;

    try {
        if (!window.CIQSupabaseAPI?.isEnabled?.()) throw new Error('Supabase設定が見つかりません。');
        projectSettings = await CIQSupabaseAPI.getPublicSettings(projectId);
        publicKeyJwk = projectSettings?.publicKey || null;
        const name = projectSettings?.projectName || projectId;
        el('my-title').textContent = name;
        document.title = `マイエントリー - ${name}`;
    } catch (e) {
        el('my-title').textContent = projectId;
        console.error(e);
    }

    // 有効なトークンがあれば再認証なしで復帰
    const stored = readStoredSession();
    if (stored) {
        mySession = stored;
        const ok = await loadHub({ silent: true });
        if (ok) return;
        storeSession(null);
    }
    showAuth();
}

function showAuth(message) {
    hideEl(el('hub'));
    showEl(el('auth-card'));
    if (message) setMsg('auth-msg', message, 'error');
    if (mySession?.email) el('f-email').value = mySession.email;
}

// ---------- 認証 ----------

async function authenticate(event) {
    event?.preventDefault();
    const form = el('auth-card');
    if (!form.reportValidity()) return;

    const email = el('f-email').value.trim();
    const pw = el('f-password').value.trim();

    const btn = el('auth-btn');
    setBusy(btn, true, '確認中...');
    setMsg('auth-msg', '', '');

    try {
        const emailHash = await AppCrypto.hashPassword(email.toLowerCase());
        const pwHash = await AppCrypto.hashPassword(pw);
        const data = await CIQSupabaseAPI.myEntry({
            projectId,
            emailHash,
            disclosurePasswordHash: pwHash,
        });
        storeSession({ token: data.token, expiresAt: data.tokenExpiresAt, email });
        applyHubData(data);
        hideEl(el('auth-card'));
        showEl(el('hub'));
    } catch (err) {
        setMsg('auth-msg', err.message || 'ログインできませんでした。', 'error');
    } finally {
        setBusy(btn, false, 'ログイン');
    }
}

async function loadHub({ silent = false } = {}) {
    try {
        const data = await CIQSupabaseAPI.myEntry({ projectId, token: mySession.token });
        storeSession({ ...mySession, token: data.token, expiresAt: data.tokenExpiresAt });
        applyHubData(data);
        hideEl(el('auth-card'));
        showEl(el('hub'));
        return true;
    } catch (err) {
        if (!silent) showAuth(err.message || 'もう一度ログインしてください。');
        return false;
    }
}

function logout() {
    storeSession(null);
    mySession = null;
    myEntryData = null;
    el('f-password').value = '';
    hideEl(el('result-view'));
    showAuth();
    setMsg('auth-msg', '', '');
}

// ---------- ハブ描画 ----------

const STATUS_LABELS = {
    registered: { status: 'success', label: '登録済み' },
    waitlist: { status: 'warning', label: 'キャンセル待ち' },
    late: { status: 'info', label: '遅刻連絡済み' },
    canceled: { status: 'danger', label: 'キャンセル済み' },
};

function applyHubData(data) {
    myEntryData = data.entry || {};
    myCapabilities = data.capabilities || {};
    qrSvgText = data.qrSvg || '';

    if (data.projectName) {
        el('my-title').textContent = data.projectName;
        document.title = `マイエントリー - ${data.projectName}`;
    }

    // 状態
    const statusRow = el('my-status');
    statusRow.textContent = '';
    const meta = STATUS_LABELS[myEntryData.status] || { status: 'neutral', label: myEntryData.status || '不明' };
    statusRow.appendChild(renderStatusBadge(meta));
    if (myEntryData.checkedIn) {
        statusRow.appendChild(renderStatusBadge({ status: 'success', label: '当日受付済み' }));
    }

    // 受付番号
    el('my-number').textContent = String(myEntryData.entryNumber ?? '').padStart(3, '0');

    // 二次元コード
    renderQr();

    // 登録内容
    renderSummary();

    // 各セクションの表示可否
    el('open-edit-btn').hidden = !myCapabilities.editable;
    const note = el('summary-note');
    if (!myCapabilities.editable && myEntryData.status !== 'canceled') {
        note.hidden = false;
        note.textContent = myEntryData.checkedIn
            ? '当日受付済みのため、内容の変更はできません。変更が必要な場合は運営へ連絡してください。'
            : '現在、登録内容の変更はできません。';
    } else {
        note.hidden = true;
    }

    el('late-section').hidden = !myCapabilities.canMarkLate;
    el('result-section').hidden = !myCapabilities.disclosureOpen;
    el('cancel-section').hidden = !myCapabilities.cancellable;
    renderReentrySection();

    hideEl(el('edit-section'));
}

function renderReentrySection() {
    const section = el('reentry-section');
    const note = el('reentry-note');
    const link = el('reentry-link');
    if (!section || !note || !link) return;

    if (myEntryData.status !== 'canceled') {
        section.hidden = true;
        return;
    }

    section.hidden = false;
    const entryUrl = new URL('entry.html', location.href);
    entryUrl.searchParams.set('pid', projectId);
    entryUrl.searchParams.set('reentry', '1');
    link.href = entryUrl.href;

    if (isEntryCurrentlyOpen()) {
        note.textContent = 'キャンセル済みの方も、通常と同じ手順で再エントリーできます。新しい受付番号・パスワード・二次元コードが発行されます。';
        link.hidden = false;
    } else {
        note.textContent = getEntryClosedReason();
        link.hidden = true;
    }
}

function renderQr() {
    const wrap = el('my-qr-wrap');
    const img = el('my-qr');
    if (!qrSvgText) {
        wrap.hidden = true;
        return;
    }
    const blob = new Blob([qrSvgText], { type: 'image/svg+xml;charset=utf-8' });
    if (img.dataset.blobUrl) URL.revokeObjectURL(img.dataset.blobUrl);
    const url = URL.createObjectURL(blob);
    img.src = url;
    img.dataset.blobUrl = url;
    wrap.hidden = false;
}

async function downloadQr() {
    if (!qrSvgText) return;
    try {
        const blob = new Blob([qrSvgText], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const image = new Image();
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('二次元コード画像を読み込めませんでした。'));
            image.src = url;
        });
        const size = 720;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(image, 40, 40, size - 80, size - 80);
        URL.revokeObjectURL(url);
        const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(pngBlob);
        a.download = `checkin_qr_${String(myEntryData?.entryNumber ?? '').padStart(3, '0')}.png`;
        a.click();
    } catch (e) {
        showToast(e.message || '二次元コード画像を保存できませんでした。', 'error');
    }
}

const SUMMARY_FIELDS = [
    ['entryName', 'エントリーネーム'],
    ['affiliation', '所属'],
    ['grade', '学年'],
    ['message', '意気込み'],
    ['inquiry', '運営への連絡'],
];

function renderSummary() {
    const dl = el('my-summary');
    dl.textContent = '';
    SUMMARY_FIELDS.forEach(([key, label]) => {
        const value = myEntryData[key];
        if (!value) return;
        const row = document.createElement('div');
        row.className = 'my-summary-row';
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        row.append(dt, dd);
        dl.appendChild(row);
    });
    if (myEntryData.isChubu) {
        const row = document.createElement('div');
        row.className = 'my-summary-row';
        const dt = document.createElement('dt');
        dt.textContent = '地域';
        const dd = document.createElement('dd');
        dd.textContent = '中部地方';
        row.append(dt, dd);
        dl.appendChild(row);
    }
}

// ---------- 編集 ----------

function openEdit() {
    el('e-affiliation').value = myEntryData.affiliation || '';
    el('e-grade').value = myEntryData.grade || '';
    document.querySelector('#e-grade')?.dispatchEvent(new Event('change'));
    el('e-chubu').checked = myEntryData.isChubu === true;
    el('e-entry-name').value = myEntryData.entryName || '';
    el('e-message').value = myEntryData.message || '';
    el('e-inquiry').value = myEntryData.inquiry || '';
    setMsg('edit-msg', '', '');
    showEl(el('edit-section'));
    el('edit-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveEdit(event) {
    event?.preventDefault();
    const form = el('edit-card');
    if (!form.reportValidity()) return;

    const familyName = el('e-family-name').value.trim();
    const firstName = el('e-first-name').value.trim();
    const familyNameKana = el('e-family-kana').value.trim();
    const firstNameKana = el('e-first-kana').value.trim();
    const affiliation = el('e-affiliation').value.trim();
    const grade = el('e-grade').value;
    const isChubu = el('e-chubu').checked;
    const entryName = el('e-entry-name').value.trim();
    const recordNamePermission = document.querySelector('input[name="e-record-name-permission"]:checked')?.value || '';
    const message = el('e-message').value.trim();
    const inquiry = el('e-inquiry').value.trim();

    if (!/^[ァ-ヴー]+$/.test(familyNameKana) || !/^[ァ-ヴー]+$/.test(firstNameKana)) {
        setMsg('edit-msg', 'カナは全角カタカナで入力してください。', 'error');
        return;
    }

    const btn = el('save-btn');
    setBusy(btn, true, '保存中...');
    setMsg('edit-msg', '更新しています...', '');

    try {
        if (!publicKeyJwk) throw new Error('セキュリティキーが取得できません');
        const allowRealNameInRecord = recordNamePermission === 'allow';
        const piiData = {
            email: mySession.email,
            familyName, firstName, familyNameKana, firstNameKana,
            affiliation, grade, entryName, useEntryName: false, allowRealNameInRecord, isChubu,
            message, inquiry,
        };
        const encryptedPII = await AppCrypto.encryptRSA(JSON.stringify(piiData), publicKeyJwk);

        const result = await CIQSupabaseAPI.editEntry({
            ...getParticipantActionPayload(),
            encryptedPii: encryptedPII,
            publicProfile: {
                entryName, affiliation, grade, message, inquiry, isChubu, allowRealNameInRecord,
            },
        });

        let mailSent = true;
        if (projectSettings?.notifyEntryEdit !== false && window.CIQEmail?.sendEntryEdited) {
            // 宛先所有確認は send-email がサーバ側で行うため emailHash は送らない(P2-e5 案B)。
            mailSent = await sendParticipantActionEmail(CIQEmail.sendEntryEdited, {
                projectName: projectSettings?.projectName || projectId,
                entryNumber: String(result.entry?.entryNumber || myEntryData?.entryNumber || '').padStart(3, '0'),
                entryId: result.entry?.id || myEntryData?.id,
                familyName,
                firstName,
                senderName: (projectSettings?.projectName || projectId) + ' 実行委員会',
            }, '登録内容の更新');
        }

        if (mailSent) showToast('登録内容を更新しました。', 'success');
        await loadHub();
    } catch (err) {
        setMsg('edit-msg', '保存に失敗しました: ' + (err.message || ''), 'error');
    } finally {
        setBusy(btn, false, '変更を保存する');
    }
}

// ---------- 遅刻連絡 ----------

async function markLate() {
    const ok = await showConfirm('遅刻を運営へ連絡します。よろしいですか?', '遅刻を連絡する');
    if (!ok) return;

    const btn = el('late-btn');
    setBusy(btn, true, '送信中...');
    try {
        const result = await CIQSupabaseAPI.markLate(getParticipantActionPayload());

        let mailSent = true;
        if (projectSettings?.notifyLateNotice !== false && window.CIQEmail?.sendLateNotice) {
            mailSent = await sendParticipantActionEmail(CIQEmail.sendLateNotice, {
                projectName: projectSettings?.projectName || projectId,
                entryNumber: String(result.entry?.entryNumber || '').padStart(3, '0'),
                entryId: result.entry?.id,
                familyName: '',
                firstName: '',
                senderName: (projectSettings?.projectName || projectId) + ' 実行委員会',
            }, '遅刻連絡');
        }

        if (mailSent) showToast('遅刻の連絡を受け付けました。', 'success');
        await loadHub();
    } catch (err) {
        setMsg('late-msg', err.message || '遅刻連絡に失敗しました。', 'error');
    } finally {
        setBusy(btn, false, '遅刻を連絡する');
    }
}

// ---------- キャンセル ----------

async function cancelEntry() {
    const ok = await showConfirm(
        'エントリーをキャンセルします。この操作は取り消せません。',
        'キャンセルを確定する',
    );
    if (!ok) return;

    const btn = el('cancel-btn');
    setBusy(btn, true, '処理中...');
    try {
        const result = await CIQSupabaseAPI.cancelEntry(getParticipantActionPayload());

        let mailSent = true;
        if (projectSettings?.notifyEntryCancel !== false && window.CIQEmail?.sendCancellation) {
            mailSent = await sendParticipantActionEmail(CIQEmail.sendCancellation, {
                projectName: projectSettings?.projectName || projectId,
                entryNumber: String(result.canceledEntry?.entryNumber || '').padStart(3, '0'),
                entryId: result.canceledEntry?.id,
                familyName: '',
                firstName: '',
                senderName: (projectSettings?.projectName || projectId) + ' 実行委員会',
            }, 'キャンセル');
        }

        if (mailSent) showToast('エントリーをキャンセルしました。', 'success');
        await loadHub();
    } catch (err) {
        setMsg('cancel-msg', err.message || 'キャンセルに失敗しました。', 'error');
    } finally {
        setBusy(btn, false, 'エントリーをキャンセルする');
    }
}

// ---------- 成績照会 ----------

let shareBlob = null;
let shareProjectName = '';

async function viewResult() {
    const btn = el('view-result-btn');
    setBusy(btn, true, '確認中...');
    setMsg('result-msg', '', '');
    try {
        const disc = await CIQSupabaseAPI.discloseResult(getParticipantActionPayload());
        renderResult(disc);
        hideEl(btn);
    } catch (e) {
        if (e.message?.includes('成績照会の対象外')) {
            setMsg('result-msg', 'このエントリーは成績照会の対象外です。', 'error');
        } else if (e.message?.includes('Disclosure')) {
            setMsg('result-msg', '成績照会は現在利用できません。', 'error');
        } else {
            setMsg('result-msg', e.message || 'エラーが発生しました。もう一度お試しください。', 'error');
        }
    } finally {
        setBusy(btn, false, '成績を表示する');
    }
}

function renderResult(disc) {
    showEl(el('result-view'));
    el('result-name').textContent = disc.displayName || '';
    el('result-rank').textContent = disc.rank || '';
    el('result-score').textContent = disc.score;

    const streaksEl = el('result-streaks');
    streaksEl.textContent = '';
    if (disc.streaks && disc.streaks.length > 0) {
        const show = disc.streaks.slice(0, 2);
        const title = document.createElement('div');
        title.className = 'streak-title';
        title.textContent = 'Streak';
        const list = document.createElement('div');
        list.className = 'streak-list';
        show.forEach((s, i) => {
            const item = document.createElement('span');
            item.className = 'streak-item';
            const label = document.createElement('span');
            label.className = 'streak-label';
            label.textContent = ordinal(i + 1);
            const value = document.createElement('span');
            value.className = 'streak-val';
            value.textContent = s;
            item.append(label, value);
            list.appendChild(item);
        });
        streaksEl.append(title, list);
    }

    generateShareCard(disc);
}

function getShareText() {
    const tag = '#' + shareProjectName.replace(/\s+/g, '');
    return `${tag} に参加しました!!`;
}

async function generateShareCard(disc) {
    shareProjectName = el('my-title').textContent || 'CIQ';
    try {
        shareBlob = await ShareCard.generate({
            projectName: shareProjectName,
            rank: disc.rank || '-',
            score: disc.score ?? '-',
            streaks: disc.streaks || [],
        });
        const preview = el('share-preview');
        const url = URL.createObjectURL(shareBlob);
        preview.textContent = '';
        const img = document.createElement('img');
        img.src = url;
        img.alt = '共有カード';
        img.className = 'share-preview-img';
        preview.appendChild(img);
        showEl(el('share-area'));
    } catch (e) {
        console.error('共有画像の生成に失敗:', e);
    }
}

function downloadShareBlob() {
    if (!shareBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(shareBlob);
    a.download = 'ciq_result.png';
    a.click();
}

async function shareResult() {
    if (!shareBlob) return;
    const file = new File([shareBlob], 'ciq_result.png', { type: 'image/png' });
    const shareData = { text: getShareText(), files: [file] };
    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        try {
            await navigator.share(shareData);
            return;
        } catch (e) {
            if (e.name === 'AbortError') return;
        }
    }
    downloadShareBlob();
    navigator.clipboard.writeText(getShareText()).catch(() => {});
    showToast('画像を保存しました。テキストはコピー済みです。', 'success');
}

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---------- イベント ----------

function setupEvents() {
    el('auth-card')?.addEventListener('submit', authenticate);
    el('qr-download-btn')?.addEventListener('click', downloadQr);
    el('open-edit-btn')?.addEventListener('click', openEdit);
    el('close-edit-btn')?.addEventListener('click', () => hideEl(el('edit-section')));
    el('edit-card')?.addEventListener('submit', saveEdit);
    el('late-btn')?.addEventListener('click', markLate);
    el('cancel-btn')?.addEventListener('click', cancelEntry);
    el('view-result-btn')?.addEventListener('click', viewResult);
    el('share-main-btn')?.addEventListener('click', shareResult);
    el('share-download-btn')?.addEventListener('click', downloadShareBlob);
    el('logout-btn')?.addEventListener('click', logout);
}

setupEvents();
init();
