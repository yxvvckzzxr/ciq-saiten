// admin_settings.js — プロジェクト設定・エクスポート・削除・オンボーディング
        async function openDeleteModal() {
            const pName = document.getElementById('setting-project-name')?.value || projectId;
            const confirmed = await showConfirm(
                `プロジェクト「${pName}」を本当に削除しますか？\n\nすべてのエントリー・答案・スコアが失われます。\nこの操作は元に戻せません。`,
                '削除する'
            );
            if (!confirmed) return;
            try {
                // Storage の画像も全削除（再帰）
                if (storage) {
                    try {
                        async function deleteStorageFolder(ref) {
                            const list = await ref.listAll();
                            for (const item of list.items) { await item.delete().catch(() => {}); }
                            for (const prefix of list.prefixes) { await deleteStorageFolder(prefix); }
                        }
                        await deleteStorageFolder(storage.ref(`projects/${projectId}`));
                    } catch(e) { console.warn('Storage削除スキップ:', e); }
                }
                // DB のサブパスを個別に削除
                const delPaths = [
                    `projects/${projectId}/protected/${secretHash}`,
                    `projects/${projectId}/entries`,
                    `projects/${projectId}/publicSettings`,
                    `projects/${projectId}/disclosure`,
                ];
                const results = await Promise.allSettled(delPaths.map(p => dbRemove(p)));
                const failures = results.filter(r => r.status === 'rejected');
                if (failures.length > 0) {
                    console.error('一部削除失敗:', failures);
                }
                showAdminToast('プロジェクトが削除されました。', 'success');
                setTimeout(() => { session.clear(); location.href = 'index.html'; }, 1500);
            } catch(e) {
                console.error('削除エラー詳細:', e);
                showAdminToast('削除エラー: ' + e.message);
            }
        }

        window.adjustNumberInput = async function(id, delta) {
            const input = document.getElementById(id);
            if (!input) return;
            let val = parseInt(input.value) || 0;
            const min = parseInt(input.min);
            const max = parseInt(input.max);
            val += delta;
            if (!isNaN(min) && val < min) val = min;
            if (!isNaN(max) && val > max) val = max;
            input.value = val;
            
            const event = new Event('change', { bubbles: true });
            input.dispatchEvent(event);

            // 問題数変更時はFirebaseにも同期
            if (id === 'question-count') {
                try {
                    await dbSet(`projects/${projectId}/protected/${secretHash}/config/questionCount`, val);
                    showAdminToast(`問題数を ${val} 問に変更しました`, 'success');
                } catch(e) { console.error('問題数の同期失敗:', e); }
            }
        };
        // ============================
        // 採点者数設定
        // ============================
        async function adjustRequiredScorers(delta) {
            const input = document.getElementById('required-scorers');
            let val = parseInt(input.value) || 3;
            val += delta;
            if (val < 1) val = 1;
            if (val > 4) val = 4;
            // 採点開始後は変更不可
            const scores = await dbShallow(`projects/${projectId}/protected/${secretHash}/scores`);
            if (scores && Object.keys(scores).length > 0) {
                showAdminToast('採点が開始されているため変更できません', 'error');
                return;
            }
            input.value = val;
            await dbSet(`projects/${projectId}/protected/${secretHash}/requiredScorers`, val);
            showAdminToast(`必要採点者数を ${val} 人に設定しました`, 'success');
        }

        // ============================
        // 設定更新処理
        // ============================

        async function updateProjectName() {
            const name = document.getElementById('setting-project-name').value.trim();
            if(!name) return showAdminToast('プロジェクト名を入力してください');
            await dbSet(`projects/${projectId}/publicSettings/projectName`, name);
            showAdminToast('プロジェクト名を更新しました', 'success');
        }

        async function toggleFullOpen() {
            const toggle = document.getElementById('full-open-toggle');
            const isFullOpen = toggle.checked;
            // エントリーが1件以上あれば変更不可
            const entries = await dbShallow(`projects/${projectId}/entries`);
            if (entries && Object.keys(entries).length > 0) {
                toggle.checked = !isFullOpen; // 元に戻す
                showAdminToast('エントリーが存在するため大会形式を変更できません', 'error');
                return;
            }
            await dbSet(`projects/${projectId}/publicSettings/fullOpen`, isFullOpen);
            const badge = document.getElementById('full-open-status');
            if (isFullOpen) {
                badge.textContent = 'フルオープン';
                badge.className = 'status-badge status-open';
                showAdminToast('フルオープン大会モードに切り替えました', 'success');
            } else {
                badge.textContent = '学生以下';
                badge.className = 'status-badge status-closed';
                showAdminToast('学生以下モードに切り替えました', 'success');
            }
        }

        async function updateTerms() {
            const termsText = document.getElementById('setting-terms').value.trim();
            await dbSet(`projects/${projectId}/publicSettings/terms`, termsText || null);
            showAdminToast('参加規約を更新しました', 'success');
        }

        async function toggleAllowEntryName() {
            const isAllowed = document.getElementById('allow-entry-name-toggle').checked;
            await dbSet(`projects/${projectId}/publicSettings/allowEntryNameForParticipation`, isAllowed);
            const badge = document.getElementById('allow-entry-name-status');
            if (isAllowed) {
                badge.textContent = '許可';
                badge.className = 'status-badge status-open';
                showAdminToast('エントリーネーム参加を許可しました', 'success');
            } else {
                badge.textContent = '本名のみ';
                badge.className = 'status-badge status-closed';
                showAdminToast('本名での参加のみに制限しました', 'success');
            }
        }

        async function purgeOldImages() {
            // 24時間以上前の answers 画像を全削除（Storage + RTDB）
            const answersSnap = await dbGet(`projects/${projectId}/protected/${secretHash}/answers`);
            if (!answersSnap) return;
            const now = Date.now();
            const ONE_DAY = 24 * 60 * 60 * 1000;
            for (const [key, data] of Object.entries(answersSnap)) {
                if (data.uploadedAt && (now - data.uploadedAt > ONE_DAY)) {
                    // Storage の画像を削除
                    if (storage) {
                        try { await storage.ref(`projects/${projectId}/answers/${key}/pageImage`).delete().catch(() => {}); } catch(e){}
                    }
                    // RTDB の画像データ/URLを null にする（メタデータは残す）
                    const cleanUpdate = { pageImage: null, pageImageUrl: null, cells: null, cellUrls: null };
                    await dbUpdate(`projects/${projectId}/protected/${secretHash}/answers/${key}`, cleanUpdate);
                }
            }
        }

        // ============================
        // 参加者管理・受付管理
        // ============================
        async function toggleEntryOpen() {
            const enabled = document.getElementById('entry-open-toggle').checked;
            await dbSet(`projects/${projectId}/protected/${secretHash}/entryConfig/entryOpen`, enabled);
            await dbSet(`projects/${projectId}/publicSettings/entryOpen`, enabled);
            updateEntryOpenStatus();
            showAdminToast(enabled ? 'エントリー受付設定を更新しました' : 'エントリー受付を停止しました', 'success');
        }
        function updateEntryOpenStatus() {
            const isOpen = document.getElementById('entry-open-toggle').checked;
            const ps = document.getElementById('entry-period-start').value;
            const pe = document.getElementById('entry-period-end').value;
            const el = document.getElementById('entry-open-status');

            if (!isOpen) {
                el.textContent = '停止中';
                el.className = 'status-badge closed';
                return;
            }

            const now = new Date();
            if (ps && new Date(ps) > now) {
                el.textContent = '期間外（開始前）';
                el.className = 'status-badge pending';
                return;
            }
            if (pe && new Date(pe) < now) {
                el.textContent = '期間外（終了済）';
                el.className = 'status-badge pending';
                return;
            }

            el.textContent = '受付中';
            el.className = 'status-badge open';
        }

        async function saveEntryPeriod() {
            const start = document.getElementById('entry-period-start').value || null;
            const end = document.getElementById('entry-period-end').value || null;
            await dbUpdate(`projects/${projectId}/protected/${secretHash}/entryConfig`, { periodStart: start, periodEnd: end });
            await dbUpdate(`projects/${projectId}/publicSettings`, { periodStart: start, periodEnd: end });
            showAdminToast('受付期間を保存しました', 'success');
        }

        // ============================
        // Custom DateTime Picker
        // ============================
        let dtTarget = null; // 'start' or 'end'
        let dtYear, dtMonth, dtDay, dtHour = 0, dtMin = 0;

        function formatDtDisplay(val) {
            if (!val) return '未設定';
            const d = new Date(val);
            const mm = d.getMonth() + 1, dd = d.getDate();
            const hh = String(d.getHours()).padStart(2, '0');
            const mi = String(d.getMinutes()).padStart(2, '0');
            return `${d.getFullYear()}/${mm}/${dd} ${hh}:${mi}`;
        }

        function openDatePicker(target) {
            dtTarget = target;
            const existing = document.getElementById(`entry-period-${target}`).value;
            const now = existing ? new Date(existing) : new Date();
            dtYear = now.getFullYear(); dtMonth = now.getMonth();
            dtDay = now.getDate();
            dtHour = now.getHours(); dtMin = now.getMinutes();

            // populate hour/min selectors
            const hSel = document.getElementById('dt-picker-hour');
            const mSel = document.getElementById('dt-picker-min');
            hSel.innerHTML = ''; mSel.innerHTML = '';
            for (let h = 0; h < 24; h++) {
                const o = document.createElement('option'); o.value = h;
                o.textContent = String(h).padStart(2, '0');
                if (h === dtHour) o.selected = true;
                hSel.appendChild(o);
            }
            for (let m = 0; m < 60; m += 5) {
                const o = document.createElement('option'); o.value = m;
                o.textContent = String(m).padStart(2, '0');
                if (m <= dtMin && m + 5 > dtMin) o.selected = true;
                mSel.appendChild(o);
            }

            renderDtDays();

            // Position
            const trigger = document.getElementById(`dt-${target}-trigger`);
            const rect = trigger.getBoundingClientRect();
            const picker = document.getElementById('dt-picker');
            picker.style.top = (rect.bottom + 8) + 'px';
            picker.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
            picker.hidden = false;
            document.getElementById('dt-picker-overlay').hidden = false;
        }

        function closeDatePicker() {
            document.getElementById('dt-picker').hidden = true;
            document.getElementById('dt-picker-overlay').hidden = true;
        }

        function dtNavMonth(delta) {
            dtMonth += delta;
            if (dtMonth < 0) { dtMonth = 11; dtYear--; }
            if (dtMonth > 11) { dtMonth = 0; dtYear++; }
            renderDtDays();
        }

        function renderDtDays() {
            const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
            document.getElementById('dt-picker-month').textContent = `${dtYear}年 ${months[dtMonth]}`;

            const container = document.getElementById('dt-picker-days');
            container.innerHTML = '';

            const firstDay = new Date(dtYear, dtMonth, 1).getDay();
            const daysInMonth = new Date(dtYear, dtMonth + 1, 0).getDate();
            const prevDays = new Date(dtYear, dtMonth, 0).getDate();
            const today = new Date();

            // Previous month padding
            for (let i = firstDay - 1; i >= 0; i--) {
                const btn = document.createElement('button');
                btn.type = 'button'; btn.className = 'dt-day other';
                btn.textContent = prevDays - i;
                container.appendChild(btn);
            }
            // Current month
            for (let d = 1; d <= daysInMonth; d++) {
                const btn = document.createElement('button');
                btn.type = 'button'; btn.className = 'dt-day';
                btn.textContent = d;
                if (d === dtDay && dtMonth === today.getMonth() && dtYear === today.getFullYear() && d === today.getDate()) {
                    btn.classList.add('today');
                } else if (d === today.getDate() && dtMonth === today.getMonth() && dtYear === today.getFullYear()) {
                    btn.classList.add('today');
                }
                if (d === dtDay) btn.classList.add('selected');
                btn.onclick = () => { dtDay = d; renderDtDays(); };
                container.appendChild(btn);
            }
            // Next month padding
            const totalCells = firstDay + daysInMonth;
            const remaining = (7 - totalCells % 7) % 7;
            for (let i = 1; i <= remaining; i++) {
                const btn = document.createElement('button');
                btn.type = 'button'; btn.className = 'dt-day other';
                btn.textContent = i;
                container.appendChild(btn);
            }
        }

        function dtConfirm() {
            dtHour = parseInt(document.getElementById('dt-picker-hour').value);
            dtMin = parseInt(document.getElementById('dt-picker-min').value);
            const d = new Date(dtYear, dtMonth, dtDay, dtHour, dtMin);
            // Format as datetime-local value
            const pad = n => String(n).padStart(2, '0');
            const val = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            
            document.getElementById(`entry-period-${dtTarget}`).value = val;
            document.getElementById(`dt-${dtTarget}-display`).textContent = formatDtDisplay(val);
            closeDatePicker();
            saveEntryPeriod();
            updateEntryOpenStatus();
        }

        function dtClear() {
            document.getElementById(`entry-period-${dtTarget}`).value = '';
            document.getElementById(`dt-${dtTarget}-display`).textContent = '未設定';
            closeDatePicker();
            saveEntryPeriod();
            updateEntryOpenStatus();
        }

        async function loadAdminEntries() {
            const tbody = document.getElementById('admin-entries-tbody');
            tbody.innerHTML = '<tr><td colspan="7" class="td-loading">読み込み中...</td></tr>';

            try {
                const entriesData = await dbGet(`projects/${projectId}/entries`);
                window._entriesRaw = entriesData; // アナリティクスのエントリーネーム表示用
                if (!entriesData) {
                    tbody.innerHTML = '<tr><td colspan="7" class="td-loading">名簿データがありません。</td></tr>';
                    return;
                }

                tbody.innerHTML = '';
                // entryNumber順にソート
                const children = Object.values(entriesData).sort((a, b) => (a.entryNumber || 0) - (b.entryNumber || 0));
                
                for (const v of children) {
                    let pii = v;
                    if (v.encryptedPII) {
                        try {
                            const privJwk = JSON.parse(session.get('privateKeyJwk'));
                            const jsonStr = await AppCrypto.decryptRSA(v.encryptedPII, privJwk);
                            pii = JSON.parse(jsonStr);
                        } catch(e) { console.error("Decryption failed", e); }
                    }
                    
                    const tr = document.createElement('tr');
                    if (v.status === 'canceled') tr.style.opacity = '0.5';
                    const statText = v.status === 'canceled' ? '<span class="badge danger"><i class="fa-solid fa-xmark"></i> キ</span>'
                        : v.checkedIn ? '<span class="badge success"><i class="fa-solid fa-check"></i> 受付済</span>' : '<span class="badge muted"><i class="fa-regular fa-clock"></i> 未受付</span>';

                    tr.innerHTML = `
                    <td >${padNum(v.entryNumber) || '-'}</td>
                    <td >${pii.familyName || '-'} ${pii.firstName || '-'}<br><span class="text-muted-sm">${pii.familyNameKana || ''} ${pii.firstNameKana || ''}</span></td>
                    <td >${pii.entryName || ''}</td>
                    <td >${pii.affiliation || ''}</td>
                    <td >${pii.grade || ''}</td>
                    <td ><span class="text-muted-sm">${pii.email || ''}</span><br>${pii.inquiry || '-'}</td>
                    <td >${statText}</td>
                `;
                    tbody.appendChild(tr);
                }
            } catch (e) {
                tbody.innerHTML = '<tr><td colspan="7" class="td-loading-error">読み込みに失敗しました: ' + e.message + '</td></tr>';
            }
        }

        async function exportEntriesCSV() {
            const entriesData = await dbGet(`projects/${projectId}/entries`);
            if (!entriesData) return;
            const rows = [['受付番号', '姓', '名', 'セイ', 'メイ', 'メールアドレス', '所属機関', '学年', 'エントリー名', '意気込み', '連絡事項', '状態', 'UUID']];
            
            const children = Object.values(entriesData).sort((a, b) => (a.entryNumber || 0) - (b.entryNumber || 0));
            
            for (const v of children) {
                let pii = v;
                if (v.encryptedPII) {
                    try {
                        const privJwk = JSON.parse(session.get('privateKeyJwk'));
                        const jsonStr = await AppCrypto.decryptRSA(v.encryptedPII, privJwk);
                        pii = JSON.parse(jsonStr);
                    } catch(e) { console.error("Decryption failed", e); }
                }
                
                const stat = v.status === 'canceled' ? 'canceled' : v.checkedIn ? 'checkedIn' : 'registered';
                rows.push([
                    v.entryNumber, pii.familyName || '', pii.firstName || '', pii.familyNameKana || '', pii.firstNameKana || '',
                    pii.email || '', pii.affiliation || '', pii.grade || '', pii.entryName || '', `"${(pii.message || '').replace(/"/g, '""')}"`,
                    `"${(pii.inquiry || '').replace(/"/g, '""')}"`, stat, v.uuid
                ]);
            }
            const csv = rows.map(r => r.join(',')).join('\n');
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
            a.download = 'entries.csv'; a.click();
        }

        async function toggleDisclosure() {
            const enabled = document.getElementById('disclosure-toggle').checked;
            await dbSet(`projects/${projectId}/protected/${secretHash}/entryConfig/disclosureEnabled`, enabled);
            document.getElementById('disclosure-url').style.display = enabled ? 'block' : 'none';
            if (enabled) {
                await generateDisclosure();
            }
        }

        async function generateDisclosure() {
            try {
                const disclosureData = {};
                // すべてのentryNumbersについてスコアを計算
                entryNumbers.forEach(en => {
                    const results = {};
                    for (let q = 1; q <= totalQuestions; q++) {
                        const fd = scoresData[`__final__q${q}`] || {};
                        // __final__ がある場合のみ確定結果を使用、なければ未確定(hold)
                        results[`q${q}`] = fd[en] || 'hold';
                    }
                    const score = Object.values(results).filter(x => x === 'correct').length;
                    disclosureData[en] = {
                        score,
                        totalQuestions,
                        results
                    };
                });
                await dbUpdate(`projects/${projectId}/protected/${secretHash}/disclosure`, disclosureData);
            } catch (e) {
                console.error('開示連携エラー:', e);
            }
        }

        async function exportProjectData() {
            const btn = event.target;
            const originalText = btn.textContent;
            try {
                btn.innerHTML = '<i class="fa-solid fa-box-archive"></i> データ取得中...';
                btn.disabled = true;
                const sections = ['settings', 'config', 'answers', 'answers_text', 'scores', 'entries', 'entryConfig', 'disclosure'];
                const data = {};
                for (const sec of sections) {
                    const secData = await dbGet(`projects/${projectId}/${sec}`);
                    if (secData) data[sec] = secData;
                }
                
                if (Object.keys(data).length === 0) {
                    showAdminToast('エクスポートするデータが見つかりません。');
                    btn.textContent = originalText;
                    btn.disabled = false;
                    return;
                }
                
                // Get project name if available, else use ID
                const pName = data.settings?.projectName || projectId;
                
                // JSON to Blob
                const jsonStr = JSON.stringify(data, null, 2);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                
                // Download
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${pName}_backup.ciq`;
                document.body.appendChild(a);
                a.click();
                
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 100);

                btn.innerHTML = '<i class="fa-solid fa-check"></i> エクスポート完了';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }, 2000);

            } catch (error) {
                showAdminToast("エクスポートエラー: " + error.message);
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }

        async function deleteProject() {
            if (!(await showConfirm(
                'このプロジェクトの全データをサーバーから完全に削除しますか？\n\n' +
                '⚠️ この操作は取り消せません。\n' +
                '事前に「全データをエクスポート」でバックアップを取ることを強く推奨します。',
                '完全に削除する'
            ))) return;

            // 2段階確認
            if (!(await showConfirm(
                `プロジェクト「${projectId}」を本当に削除しますか？\nすべてのエントリー・答案・スコアが失われます。`,
                '削除を確定'
            ))) return;

            try {
                showAdminToast('プロジェクトを削除しています...', 'info', 10000);

                // Storage の画像データを削除
                if (storage) {
                    try {
                        const storageRef = storage.ref(`projects/${projectId}`);
                        const list = await storageRef.listAll();
                        for (const folder of list.prefixes) {
                            const files = await folder.listAll();
                            for (const file of files.items) {
                                await file.delete().catch(() => {});
                            }
                        }
                    } catch (e) { console.warn('Storage cleanup partial:', e); }
                }

                // RTDB のプロジェクトデータを削除
                await dbRemove(`projects/${projectId}`);

                showAdminToast('プロジェクトを削除しました。トップページに戻ります。', 'success', 3000);
                session.clear();
                setTimeout(() => { location.href = 'index.html'; }, 2000);
            } catch (e) {
                showAdminToast('削除エラー: ' + e.message, 'error');
            }
        }

        async function renderOnboarding() {
            // オンボーディング非表示設定チェック
            if (localStorage.getItem(`onboarding_dismissed_${projectId}`)) return;

            try {
                const [config, answersKeys] = await Promise.all([
                    dbGet(`projects/${projectId}/protected/${secretHash}/settings`),
                    dbShallow(`projects/${projectId}/protected/${secretHash}/answers`)
                ]);
                const modelAnswers = await dbGet(`projects/${projectId}/config/answers`);
                const entriesCount = await dbShallow(`projects/${projectId}/entries`);

                const steps = [
                    { id: 'entries',   label: 'エントリーを受け付ける', done: entriesCount && Object.keys(entriesCount).length > 0, tab: 'tab-entries' },
                    { id: 'model',     label: '模範解答を登録する', done: modelAnswers && Object.keys(modelAnswers).length > 0, tab: 'tab-prep' },
                    { id: 'answers',   label: '答案をアップロードする', done: answersKeys && Object.keys(answersKeys).length > 0, tab: 'tab-scan' },
                ];

                const doneCount = steps.filter(s => s.done).length;

                // 全部完了していたら表示しない
                if (doneCount >= steps.length) {
                    localStorage.setItem(`onboarding_dismissed_${projectId}`, '1');
                    return;
                }

                const container = document.querySelector('.admin-body');
                const panel = document.createElement('div');
                panel.className = 'onboarding-panel';
                panel.id = 'onboarding-panel';
                panel.innerHTML = `
                    <h3><i class="fa-solid fa-rocket"></i> セットアップガイド</h3>
                    <div class="onboarding-desc">大会の準備を進めましょう。完了した項目は自動的にチェックされます。</div>
                    <div class="onboarding-progress"><div class="onboarding-progress-bar" style="width:${(doneCount / steps.length) * 100}%"></div></div>
                    <ul class="onboarding-steps">
                        ${steps.map(s => `
                            <li class="onboarding-step ${s.done ? 'done' : ''}">
                                <div class="step-icon">${s.done ? '<i class="fa-solid fa-check"></i>' : ''}</div>
                                <span class="step-label">${s.label}</span>
                                ${!s.done ? `<span class="step-action" onclick="switchTab('${s.tab}')">設定 →</span>` : ''}
                            </li>
                        `).join('')}
                    </ul>
                    <span class="onboarding-dismiss" onclick="dismissOnboarding()">× このガイドを閉じる</span>
                `;
                const tabs = container.querySelector('.tabs');
                container.insertBefore(panel, tabs);
            } catch(e) {
                console.warn('Onboarding check failed:', e);
            }
        }

        function dismissOnboarding() {
            localStorage.setItem(`onboarding_dismissed_${projectId}`, '1');
            const panel = document.getElementById('onboarding-panel');
            if (panel) { panel.style.transition = 'all 0.3s ease'; panel.style.opacity = '0'; panel.style.transform = 'translateY(-10px)'; setTimeout(() => panel.remove(), 300); }
        }

        init();