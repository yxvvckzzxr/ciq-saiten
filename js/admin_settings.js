// admin_settings.js — プロジェクト設定・エクスポート・削除・オンボーディング

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
        // 設定更新処理
        // ============================

        async function updateTerms() {
            const termsText = document.getElementById('setting-terms').value.trim();
            await dbSet(`projects/${projectId}/publicSettings/terms`, termsText || null);
            showAdminToast('参加規約を更新しました', 'success');
        }

        function toggleMaxEntries() {
            const isOn = document.getElementById('max-entries-toggle').checked;
            const badge = document.getElementById('max-entries-status');
            const inputArea = document.getElementById('max-entries-input-area');
            if (isOn) {
                badge.textContent = document.getElementById('setting-max-entries').value + '人';
                badge.className = 'status-badge status-open';
                inputArea.style.display = 'block';
            } else {
                badge.textContent = '制限なし';
                badge.className = 'status-badge status-closed';
                inputArea.style.display = 'none';
            }
            saveEntryPeriod();
        }


        async function purgeOldImages() {
            // 24時間以上前の answers の画像データを削除（RTDB内のBase64）
            const answersSnap = await dbGet(`projects/${projectId}/protected/${secretHash}/answers`);
            if (!answersSnap) return;
            const now = Date.now();
            const ONE_DAY = 24 * 60 * 60 * 1000;
            for (const [key, data] of Object.entries(answersSnap)) {
                if (data.uploadedAt && (now - data.uploadedAt > ONE_DAY)) {
                    // RTDB の画像データを null にする（メタデータは残す）
                    const cleanUpdate = { pageImage: null, cells: null };
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
            const hasLimit = document.getElementById('max-entries-toggle').checked;
            const maxEntries = hasLimit ? (parseInt(document.getElementById('setting-max-entries').value) || 100) : 0;
            await dbUpdate(`projects/${projectId}/protected/${secretHash}/entryConfig`, { periodStart: start, periodEnd: end, maxEntries });
            await dbUpdate(`projects/${projectId}/publicSettings`, { periodStart: start, periodEnd: end, maxEntries });
            // トグルONなら人数バッジも更新
            if (hasLimit) {
                document.getElementById('max-entries-status').textContent = maxEntries + '人';
            }
            showAdminToast('受付期間・定員を保存しました', 'success');
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
                    if (v.status === 'waitlist') tr.style.opacity = '0.7';
                    const statText = v.status === 'canceled' ? '<span class="badge danger"><i class="fa-solid fa-xmark"></i> キ</span>'
                        : v.status === 'waitlist' ? '<span class="badge" style="background:rgba(245,158,11,0.2);color:#f59e0b"><i class="fa-solid fa-clock"></i> 待</span>'
                        : v.checkedIn ? '<span class="badge success"><i class="fa-solid fa-check"></i> 受付済</span>' : '<span class="badge muted"><i class="fa-regular fa-clock"></i> 未受付</span>';

                    tr.innerHTML = `
                    <td >${padNum(v.entryNumber) || '-'}</td>
                    <td >${escapeHtml(pii.familyName || '-')} ${escapeHtml(pii.firstName || '-')}<br><span class="text-muted-sm">${escapeHtml(pii.familyNameKana || '')} ${escapeHtml(pii.firstNameKana || '')}</span></td>
                    <td >${escapeHtml(pii.entryName || '')}</td>
                    <td >${escapeHtml(pii.affiliation || '')}</td>
                    <td >${escapeHtml(pii.grade || '')}</td>
                    <td ><span class="text-muted-sm">${escapeHtml(pii.email || '')}</span><br>${escapeHtml(pii.inquiry || '-')}</td>
                    <td >${statText}</td>
                `;
                    tbody.appendChild(tr);
                }
            } catch (e) {
                tbody.innerHTML = '<tr><td colspan="7" class="td-loading-error">読み込みに失敗しました: ' + escapeHtml(e.message) + '</td></tr>';
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
                
                const stat = v.status === 'canceled' ? 'canceled' : v.status === 'waitlist' ? 'waitlist' : v.checkedIn ? 'checkedIn' : 'registered';
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
                await dbUpdate(`projects/${projectId}/disclosure`, disclosureData);
            } catch (e) {
                console.error('開示連携エラー:', e);
            }
        }



        async function resetProject() {
            if (!(await showConfirm(
                'プロジェクト内の全データ（エントリー・答案・スコア）をリセットしますか？\n\n' +
                '⚠️ この操作は取り消せません。\n' +
                'プロジェクト設定（パスワード・暗号鍵等）は維持されます。',
                'リセットする'
            ))) return;

            // 2段階確認
            if (!(await showConfirm(
                `プロジェクト「${projectId}」を本当にリセットしますか？\nすべてのエントリー・答案・スコアが失われます。`,
                'リセットを確定'
            ))) return;

            try {
                showAdminToast('プロジェクトをリセットしています...', 'info', 10000);

                const removePath = async (p) => {
                    try { await dbRef(p).remove(); } catch(e) { console.warn(`削除スキップ: ${p}`, e.message); }
                };
                const protectedBase = `projects/${projectId}/protected/${secretHash}`;
                await Promise.all([
                    removePath(`${protectedBase}/scores`),
                    removePath(`${protectedBase}/answers`),
                    removePath(`${protectedBase}/answers_text`),
                    removePath(`projects/${projectId}/entries`),
                    removePath(`projects/${projectId}/disclosure`),
                ]);

                showAdminToast('プロジェクトをリセットしました。ページを再読み込みします。', 'success', 3000);
                setTimeout(() => { location.reload(); }, 2000);
            } catch (e) {
                console.error('リセットエラー:', e);
                showAdminToast('リセットエラー: ' + e.message, 'error');
            }
        }

        init();