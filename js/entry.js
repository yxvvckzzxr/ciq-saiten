// entry.js — エントリーフォーム（Firebase SDK版）
// 受付番号の採番には SDK トランザクションを使用し、競合を完全に防止する。

const params = new URLSearchParams(location.search);
        const projectId = params.get('pid');

        if (!projectId) {
            document.getElementById('form-card').style.display = 'none';
            const d = document.getElementById('disabled-card');
            d.innerHTML = '<p>プロジェクトが指定されていません。</p><p style="margin-top:8px;font-size:13px">正しいエントリーURLへアクセスしてください。</p>';
            d.style.display = 'block';
        }

        function generateUUID() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }

        function generatePW() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
            let pw = '';
            for (let i = 0; i < 6; i++) {
                pw += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return pw;
        }

        function showStatus(msg, type) {
            const sm = document.getElementById('status-msg');
            sm.textContent = msg;
            sm.className = `page-msg ${type}`;
            sm.style.display = 'block';
        }

        document.getElementById('entry-form').addEventListener('submit', async (e) => {
            e.preventDefault();

            const btn = document.getElementById('submit-btn');

            const email = document.getElementById('f-email').value.trim();
            const familyName = document.getElementById('f-family-name').value.trim();
            const firstName = document.getElementById('f-first-name').value.trim();
            const familyNameKana = document.getElementById('f-family-kana').value.trim();
            const firstNameKana = document.getElementById('f-first-kana').value.trim();

            // バリデーション
            if (!email || !familyName || !firstName) {
                showStatus('メールアドレス・姓名は必須項目です。', 'error');
                return;
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showStatus('正しいメールアドレスを入力してください。', 'error');
                return;
            }


            btn.disabled = true;
            btn.textContent = '処理中...';
            showStatus('エントリーを送信しています...', 'info');

            const affiliation = document.getElementById('f-affiliation').value.trim();
            const grade = document.getElementById('f-grade').value;
            const entryName = document.getElementById('f-entry-name').value.trim();
            const message = document.getElementById('f-message').value.trim();
            const inquiry = document.getElementById('f-inquiry').value.trim();

            const uuid = generateUUID();
            const pw = generatePW();

            try {
                // SDK トランザクションで受付番号をアトミックに取得
                const txResult = await dbTransaction(
                    `projects/${projectId}/publicSettings/lastEntryNumber`,
                    (currentValue) => (currentValue || 0) + 1
                );

                if (!txResult.committed) {
                    throw new Error("受付番号の取得に失敗しました。再度お試しください。");
                }

                const entryNumber = txResult.value;
                const pwHash = await AppCrypto.hashPassword(pw);

                // 定員チェック
                const pubSettings = await dbGet(`projects/${projectId}/publicSettings`);
                const maxEntries = pubSettings?.maxEntries || 0;
                let entryStatus = 'registered';
                if (maxEntries > 0) {
                    const allEntries = await dbGet(`projects/${projectId}/entries`);
                    const activeCount = allEntries
                        ? Object.values(allEntries).filter(e => e.status === 'registered').length
                        : 0;
                    if (activeCount >= maxEntries) {
                        entryStatus = 'waitlist';
                    }
                }

                // 公開鍵を取得してPIIを暗号化
                const publicKeyJwk = await dbGet(`projects/${projectId}/publicSettings/publicKey`);
                if (!publicKeyJwk) throw new Error("セキュリティキーが取得できません");
                const useEntryName = false; // CIQ大会は本名表示固定
                
                const piiData = { email, familyName, firstName, familyNameKana, firstNameKana, affiliation, grade, entryName, useEntryName, message, inquiry };
                const encryptedPII = await AppCrypto.encryptRSA(JSON.stringify(piiData), publicKeyJwk);

                const entryData = {
                    uuid,
                    entryNumber,
                    encryptedPII,
                    emailHash: await AppCrypto.hashPassword(email.toLowerCase()),
                    disclosurePw: pwHash,
                    status: entryStatus,
                    checkedIn: false,
                    timestamp: SERVER_TIMESTAMP
                };

                // DBに保存
                await dbSet(`projects/${projectId}/entries/${uuid}`, entryData);

                // メール通知（非同期・失敗しても登録は有効）
                const pName = document.getElementById('project-title').textContent || projectId;
                CIQEmail.sendEntryConfirmation(email, {
                    projectName: pName,
                    entryNumber: String(entryNumber).padStart(3, '0'),
                    password: pw,
                    uuid,
                    familyName,
                    firstName,
                    status: entryStatus,
                }).catch(e => console.warn('メール送信スキップ:', e));

                // 成功画面を表示
                document.getElementById('form-card').style.display = 'none';
                document.getElementById('result-card').style.display = 'block';
                document.getElementById('r-entry-number').textContent = String(entryNumber).padStart(3, '0');
                document.getElementById('status-msg').style.display = 'none';

                // キャンセル待ちの場合の追加メッセージ
                if (entryStatus === 'waitlist') {
                    const waitMsg = document.createElement('div');
                    waitMsg.className = 'status-msg warning';
                    waitMsg.innerHTML = '<i class="fa-solid fa-clock"></i> 定員に達したため、<strong>キャンセル待ち</strong>として登録されました。';
                    waitMsg.style.cssText = 'display:block;margin:12px 0;padding:12px 16px;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);border-radius:8px;color:#fbbf24;font-size:13px;';
                    document.getElementById('r-entry-number').parentElement.after(waitMsg);
                }

            } catch (err) {
                console.error('Entry submission error:', err, err.stack);
                btn.disabled = false;
                btn.textContent = 'エントリーを確定する';
                showStatus('エラーが発生しました: ' + err.message + ' (' + (err.code || err.name || '') + ')', 'error');
            }
        });

        // 初期化: プロジェクト設定読み込み
        async function init() {
            if (!projectId) return;
            await waitForAuth();

            try {
                // プロジェクト名を取得して表示
                let settings = await dbGet(`projects/${projectId}/publicSettings`);
                if (!settings) {
                    // 旧形式フォールバック
                    const sName = await dbGet(`projects/${projectId}/settings/projectName`);
                    settings = { projectName: sName };
                }
                if (settings) {
                    const pName = settings.projectName || projectId;
                    document.getElementById('project-title').textContent = pName;
                    document.title = pName + ' - エントリーフォーム';

                    // 参加規約リンクにプロジェクトIDを付与
                    const termsLink = document.getElementById('terms-link');
                    if (termsLink) {
                        termsLink.href = `terms.html?pid=${projectId}`;
                    }

                    // エントリー受付チェック
                    let blocked = false;
                    let blockTitle = '';
                    let blockDetail = '';
                    if (settings.entryOpen !== true) {
                        blocked = true;
                        blockTitle = '受付は現在停止中です';
                        blockDetail = '管理者が受付を再開するまでお待ちください。';
                    } else {
                        const now = new Date();
                        const parseLocal = (dtStr) => {
                            if (!dtStr) return null;
                            if (dtStr.includes('T')) {
                                const [d, t] = dtStr.split('T');
                                const [y, m, day] = d.split('-');
                                const [hr, min] = t.split(':');
                                return new Date(y, m - 1, day, hr, min);
                            }
                            return new Date(dtStr);
                        };
                        
                        const startDt = parseLocal(settings.periodStart);
                        const endDt = parseLocal(settings.periodEnd);
                        
                        if (startDt && startDt > now) {
                            blocked = true;
                            blockTitle = 'エントリー受付はまだ開始されていません';
                            blockDetail = '受付開始: ' + startDt.toLocaleString('ja-JP');
                        }
                        if (endDt && endDt < now) {
                            blocked = true;
                            blockTitle = 'エントリー受付は終了しました';
                            blockDetail = '受付終了: ' + endDt.toLocaleString('ja-JP');
                        }
                    }
                    if (blocked) {
                        document.getElementById('form-card').style.display = 'none';
                        document.getElementById('disabled-title').textContent = blockTitle;
                        document.getElementById('disabled-detail').textContent = blockDetail;
                        document.getElementById('disabled-card').style.display = 'block';
                    }
                } else {
                    document.getElementById('form-card').style.display = 'none';
                    document.getElementById('disabled-title').textContent = 'プロジェクトが見つかりません';
                    document.getElementById('disabled-detail').textContent = '正しいエントリーURLへアクセスしてください。';
                    document.getElementById('disabled-card').style.display = 'block';
                }
            } catch (e) {
            }
        }

        init();