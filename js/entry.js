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
            btn.disabled = true;
            btn.textContent = '処理中...';
            showStatus('エントリーを送信しています...', 'info');

            const email = document.getElementById('f-email').value.trim();
            const familyName = document.getElementById('f-family-name').value.trim();
            const firstName = document.getElementById('f-first-name').value.trim();
            const familyNameKana = document.getElementById('f-family-kana').value.trim();
            const firstNameKana = document.getElementById('f-first-kana').value.trim();

            // フルオープンモード: 都道府県 → affiliation に格納、grade は空
            const isFullOpen = document.getElementById('open-mode-fields').style.display !== 'none';
            const affiliation = isFullOpen
                ? document.getElementById('f-prefecture').value
                : document.getElementById('f-affiliation').value.trim();
            const grade = isFullOpen ? '' : document.getElementById('f-grade').value;
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

                // 公開鍵を取得してPIIを暗号化
                const publicKeyJwk = await dbGet(`projects/${projectId}/publicSettings/publicKey`);
                if (!publicKeyJwk) throw new Error("セキュリティキーが取得できません");
                const useEntryNameNode = document.getElementById('f-use-entry-name');
                const useEntryName = useEntryNameNode ? useEntryNameNode.checked : false;
                
                const piiData = { email, familyName, firstName, familyNameKana, firstNameKana, affiliation, grade, entryName, useEntryName, message, inquiry };
                const encryptedPII = await AppCrypto.encryptRSA(JSON.stringify(piiData), publicKeyJwk);

                const entryData = {
                    uuid,
                    entryNumber,
                    encryptedPII,
                    disclosurePw: pwHash,
                    status: 'registered',
                    checkedIn: false,
                    timestamp: SERVER_TIMESTAMP
                };

                // DBに保存
                await dbSet(`projects/${projectId}/entries/${uuid}`, entryData);

                // GAS APIを呼び出してメール送信
                if (typeof SYSTEM_GAS_URL !== 'undefined' && SYSTEM_GAS_URL.startsWith('http')) {
                    try {
                        const pName = document.getElementById('project-title').textContent;
                        const mailParams = new URLSearchParams({
                            action: 'entryMail',
                            projectName: pName,
                            email,
                            familyName,
                            firstName,
                            entryNumber,
                            pw,
                            uuid
                        });

                        fetch(SYSTEM_GAS_URL + '?' + mailParams.toString())
                            .then(r => r.text())
                            .then(t => {})
                            .catch(e => {});
                    } catch (e) {
                    }
                }

                // 成功画面を表示
                document.getElementById('form-card').style.display = 'none';
                document.getElementById('result-card').style.display = 'block';
                document.getElementById('r-entry-number').textContent = String(entryNumber).padStart(3, '0');
                document.getElementById('r-password').textContent = pw;
                document.getElementById('status-msg').style.display = 'none';

            } catch (err) {
                btn.disabled = false;
                btn.textContent = 'エントリーを確定する';
                showStatus('エラーが発生しました: ' + err.message, 'error');
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

                    // フルオープンモード検出 → フォーム切替
                    if (settings.fullOpen) {
                        document.getElementById('school-mode-fields').style.display = 'none';
                        document.getElementById('f-affiliation').removeAttribute('required');
                        document.getElementById('f-grade').removeAttribute('required');
                        document.getElementById('open-mode-fields').style.display = 'block';
                        document.getElementById('f-prefecture').setAttribute('required', 'required');
                    }

                    // 参加規約リンクにプロジェクトIDを付与
                    const termsLink = document.getElementById('terms-link');
                    if (termsLink) {
                        termsLink.href = `terms.html?pid=${projectId}`;
                    }

                    const prefArea = document.getElementById('entry-name-pref-area');
                    if (prefArea) {
                        if (settings.allowEntryNameForParticipation) {
                            prefArea.innerHTML = `
                                <label class="custom-checkbox">
                                    <input type="checkbox" id="f-use-entry-name">
                                    <span class="checkbox-mark"><svg class="checkbox-svg" viewBox="0 0 16 16"><path d="M3 8.5L6.5 12L13 4"></path></svg></span>
                                    <span>大会当日のスコアボードや呼称にもエントリーネームを使用する</span>
                                </label>
                            `;
                        } else {
                            prefArea.innerHTML = `
                                <div style="font-size:12px;color:#f87171;line-height:1.4;font-weight:600;"><i class="fa-solid fa-circle-exclamation"></i> 大会当日は本名（姓名）でのご参加・表示となります。エントリーネームはシステム上の登録用です。</div>
                            `;
                        }
                    }

                    // エントリー受付チェック
                    let blocked = false;
                    let blockTitle = '';
                    let blockDetail = '';
                    if (settings.entryOpen === false) {
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