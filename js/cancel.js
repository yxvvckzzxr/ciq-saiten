// cancel.js — キャンセル処理（メールアドレス + パスワード認証）

const params = new URLSearchParams(location.search);
    let projectId = params.get('pid');

    if (!projectId) {
        document.getElementById('form-card').innerHTML = '<p style="text-align:center;color:#ef4444;font-weight:600;">プロジェクトIDが不明です。正しいURLからアクセスしてください。</p>';
        throw new Error('No Project ID');
    }

    // 大会名を取得して表示
    let projectName = '';
    (async () => {
        if (!projectId) return;
        await waitForAuth();
        try {
            let pName = await dbGet(`projects/${projectId}/publicSettings/projectName`);
            if (!pName) pName = await dbGet(`projects/${projectId}/settings/projectName`);
            projectName = pName || projectId;
            document.getElementById('cancel-title').textContent = projectName;
            document.title = projectName + ' - キャンセルフォーム';
        } catch(e) {
            projectName = projectId;
            document.getElementById('cancel-title').textContent = projectId;
        }
    })();

    function showStatus(msg, type) {
        const sm = document.getElementById('status-msg');
        sm.innerHTML = msg;
        sm.className = `page-msg ${type}`;
        sm.style.display = 'block';
    }

    async function processCancel() {
        const email = document.getElementById('f-email').value.trim();
        const pw = document.getElementById('f-password').value.trim();

        if (!email || !pw) {
            showStatus('メールアドレスとパスワードを入力してください。', 'error');
            return;
        }

        const btn = document.getElementById('submit-btn');
        btn.disabled = true;
        btn.textContent = '認証中...';
        showStatus('データを確認しています...', '');

        try {
            // メールアドレスのハッシュで検索
            const emailHash = await AppCrypto.hashPassword(email.toLowerCase());
            const entriesData = await dbQuery(`projects/${projectId}/entries`, 'emailHash', emailHash);

            if (!entriesData || Object.keys(entriesData).length === 0) {
                showStatus('指定されたメールアドレスに一致するエントリーが見つかりません。', 'error');
                btn.disabled = false; btn.textContent = 'キャンセルを確定する';
                return;
            }

            let targetKey = null;
            let targetData = null;
            let matched = false;

            const pwHash = await AppCrypto.hashPassword(pw);

            for (const [key, data] of Object.entries(entriesData)) {
                if (data.disclosurePw === pwHash || data.disclosurePw === pw) {
                    targetKey = key;
                    targetData = data;
                    matched = true;
                }
            }

            if (!matched) {
                showStatus('パスワードが正しくありません。', 'error');
                btn.disabled = false; btn.textContent = 'キャンセルを確定する';
                return;
            }

            if (targetData.status === 'canceled') {
                showStatus('このエントリーは既にキャンセルされています。', 'error');
                btn.disabled = false; btn.textContent = 'キャンセルを確定する';
                return;
            }

            const entryNum = targetData.entryNumber;



            // 更新処理
            await dbUpdate(`projects/${projectId}/entries/${targetKey}`, {
                status: 'canceled',
                canceledAt: SERVER_TIMESTAMP
            });

            // メール通知（非同期・失敗しても処理済み）
            CIQEmail.sendCancellation(email, {
                projectName: projectName || projectId,
                entryNumber: String(entryNum).padStart(3, '0'),
                familyName: '',
                firstName: '',
            }).catch(e => console.warn('キャンセルメール送信スキップ:', e));

            document.getElementById('form-card').innerHTML = `
                <div style="text-align:center;">
                    <h2 style="color:#ef5350;margin-bottom:16px;">キャンセル完了</h2>
                    <p style="color:#8e8ea0;line-height:1.6;">
                        受付番号 ${entryNum} のエントリーキャンセルを受け付けました。<br>
                        確認メールを送信しました。<br>
                        ご利用ありがとうございました。
                    </p>
                </div>
            `;

        } catch (err) {
            showStatus('システムエラーが発生しました。', 'error');
            btn.disabled = false; btn.textContent = 'キャンセルを確定する';
        }
    }