
        // showAdminToast は shared.js の showToast に委譲
        function showAdminToast(msg, type = 'error') {
            showToast(msg, type);
        }
        // showConfirm は shared.js で定義済み

        // ============================
        // 共通初期化
        // ============================
        const auth = requireAuth({ requireAdmin: true });
        if (!auth) throw new Error('auth');
        const { projectId, secretHash } = auth;
        const isSupabaseMode = auth.supabaseMode === true;
        const adminHash = session.get('adminHash');
        let adminScanCount = null;

        function adminIcon(className) {
            const icon = createIcon(className);
            return icon;
        }

        function setIconOnlyButton(btn, iconClass) {
            if (!btn) return;
            btn.textContent = '';
            btn.appendChild(adminIcon(iconClass));
        }

        const adminScriptLoads = {};
        function loadAdminScriptOnce(src, integrity) {
            if (adminScriptLoads[src]) return adminScriptLoads[src];
            adminScriptLoads[src] = new Promise((resolve, reject) => {
                const existing = document.querySelector(`script[src="${src}"]`);
                if (existing) {
                    existing.addEventListener('load', resolve, { once: true });
                    existing.addEventListener('error', reject, { once: true });
                    if (existing.dataset.loaded === 'true') resolve();
                    return;
                }
                const script = document.createElement('script');
                script.src = src;
                script.defer = true;
                // 外部CDNからの動的読込には SRI + crossorigin を付与して改ざんを遮断する。
                if (integrity) {
                    script.integrity = integrity;
                    script.crossOrigin = 'anonymous';
                }
                script.onload = () => {
                    script.dataset.loaded = 'true';
                    resolve();
                };
                script.onerror = () => reject(new Error(`${src} を読み込めませんでした`));
                document.head.appendChild(script);
            });
            return adminScriptLoads[src];
        }

        async function ensureJsPdfLoaded() {
            if (!window.jspdf) await loadAdminScriptOnce('https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js', 'sha384-en/ztfPSRkGfME4KIm05joYXynqzUgbsG5nMrj/xEFAHXkeZfO3yMK8QQ+mP7p1/');
        }

        async function ensureAdminPrepLoaded() {
            if (!window.pdfjsLib) await loadAdminScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e');
            await ensureJsPdfLoaded();
            if (!window.CV) await loadAdminScriptOnce('js/cv.js');
            if (!window.AR) await loadAdminScriptOnce('js/aruco.js');
            if (typeof window.generatePDF !== 'function' || typeof window.loadAnswers !== 'function') {
                await loadAdminScriptOnce('js/admin_prep.js?v=27');
            }
        }

        async function runAdminPrepAction(actionName) {
            await ensureAdminPrepLoaded();
            const fn = window[actionName];
            if (typeof fn !== 'function') throw new Error(`${actionName} が読み込まれていません`);
            return fn();
        }

        async function runGradedPdfExport() {
            await ensureJsPdfLoaded();
            return exportGradedPDF();
        }

        const projectIdDisplay = document.getElementById('project-id-display');
        if (projectIdDisplay) {
            projectIdDisplay.textContent = '';
            projectIdDisplay.append(adminIcon('copy'), ` ${projectId}`);
        }
        const menuName = document.getElementById('menu-scorer-name');
        if (menuName) menuName.textContent = auth.scorerName;

        function copyProjectId() {
            const el = document.getElementById('project-id-display');
            navigator.clipboard.writeText(projectId).then(() => {
                const iconHolder = el.querySelector('[data-icon]');
                if (iconHolder) {
                    iconHolder.textContent = '';
                    iconHolder.appendChild(createIcon('check'));
                }
                el.classList.add('copy-badge-success');
                setTimeout(() => {
                    const iconHolder2 = el.querySelector('[data-icon]');
                    if (iconHolder2) {
                        iconHolder2.textContent = '';
                        iconHolder2.appendChild(createIcon('copy'));
                    }
                    el.classList.remove('copy-badge-success');
                }, 1500);
            });
        }

        function openProjectPage(page) {
            window.open(`${page}?pid=${encodeURIComponent(projectId)}`, '_blank');
        }

        function openLinkById(linkId) {
            const href = document.getElementById(linkId)?.href;
            if (href) window.open(href, '_blank');
        }

        function setupAdminEventHandlers() {
            document.body.classList.remove('body-scroll-locked');
            document.getElementById('menu-backdrop')?.classList.remove('active');
            document.getElementById('menu-panel')?.classList.remove('active');
            document.getElementById('project-id-display')?.addEventListener('click', copyProjectId);
            document.querySelectorAll('[data-toggle-menu]').forEach((el) => {
                el.addEventListener('click', toggleMenu);
            });
            document.querySelectorAll('[data-nav-target]').forEach((el) => {
                el.addEventListener('click', () => {
                    location.href = el.dataset.navTarget;
                });
            });
            document.querySelectorAll('[data-open-page]').forEach((el) => {
                el.addEventListener('click', () => openProjectPage(el.dataset.openPage));
            });
            document.querySelectorAll('[data-open-static]').forEach((el) => {
                el.addEventListener('click', () => window.open(el.dataset.openStatic, '_blank'));
            });
            document.querySelectorAll('[data-open-link]').forEach((el) => {
                el.addEventListener('click', () => openLinkById(el.dataset.openLink));
            });
            document.querySelectorAll('[data-copy-link]').forEach((el) => {
                el.addEventListener('click', () => copyUrl(el.dataset.copyLink, el));
            });
            document.querySelectorAll('[data-tab-target]').forEach((el) => {
                el.addEventListener('click', () => switchTab(el.dataset.tabTarget));
            });
            window.bindDatePickerControls?.();
            document.querySelectorAll('[data-adjust-input]').forEach((el) => {
                el.addEventListener('click', () => {
                    adjustNumberInput(el.dataset.adjustInput, Number(el.dataset.adjustDelta || 0));
                });
            });
            document.querySelectorAll('[data-file-trigger]').forEach((el) => {
                el.addEventListener('click', (event) => {
                    if (event.target?.matches?.('input[type="file"]')) return;
                    document.getElementById(el.dataset.fileTrigger)?.click();
                });
            });
            document.getElementById('csv-file')?.addEventListener('change', (event) => {
                const fileName = document.getElementById('csv-file-name');
                const name = event.target.files?.[0]?.name || '';
                if (fileName) {
                    fileName.textContent = name;
                    fileName.classList.toggle('has-file', Boolean(name));
                }
                loadCSV();
            });
            document.getElementById('pdf-file')?.addEventListener('change', (event) => {
                const fileName = document.getElementById('pdf-file-name');
                const name = event.target.files?.[0]?.name || '';
                if (fileName) {
                    fileName.textContent = name;
                    fileName.classList.toggle('has-file', Boolean(name));
                }
                runAdminPrepAction('loadAnswers').catch(e => showAdminToast(e.message || '答案読み込みを開始できませんでした'));
            });
            const actions = {
                'toggle-entry-open': toggleEntryOpen,
                'toggle-disclosure-open': toggleDisclosureOpen,
                'toggle-max-entries': toggleMaxEntries,
                'save-entry-period': saveEntryPeriod,
                'export-entries-csv': exportEntriesCSV,
                'open-admin-entry-modal': openAdminEntryModal,
                'close-admin-entry-modal': closeAdminEntryModal,
                'copy-admin-entry-password': copyAdminEntryPassword,
                'copy-admin-entry-template': copyAdminEntryTemplate,
                'download-admin-entry-receipt': downloadAdminEntryReceipt,
                'finish-admin-entry': finishAdminEntryFlow,
                'generate-pdf': () => runAdminPrepAction('generatePDF'),
                'toggle-select-all': toggleSelectAll,
                'batch-delete': batchDelete,
                'export-csv': exportCSV,
                'export-graded-pdf': runGradedPdfExport,
                'render-analytics': renderAnalytics,
                'export-analytics-csv': exportAnalyticsCSV,
                'load-project-members': loadProjectMembers,
                'update-terms': updateTerms,
                'reset-project': resetProject,
            };
            document.querySelectorAll('[data-action]').forEach((el) => {
                const eventName = el.matches('input, select, textarea') ? 'change' : 'click';
                el.addEventListener(eventName, () => {
                    const fn = actions[el.dataset.action];
                    if (!fn) return;
                    Promise.resolve(fn()).catch(e => showAdminToast(e.message || '操作に失敗しました'));
                });
            });
            document.getElementById('admin-logout-btn')?.addEventListener('click', logout);

            // ARIA tablist を初期化（キーボード操作 + aria 同期）
            if (typeof initTablist === 'function') initTablist('#admin-tabs');
        }

        function setupPublicLinks() {
            const baseUrl = new URL('.', window.location.href).href;
            // 共有リンクは4本に集約(編集/キャンセル/遅刻/成績照会は my.html に統合)
            const links = {
                'registration-link': 'entry.html',
                'entry-link': 'entry_list.html',
                'my-link': 'my.html',
                'terms-link': 'terms.html',
            };

            Object.entries(links).forEach(([id, page]) => {
                const el = document.getElementById(id);
                if (!el) return;
                const url = `${baseUrl}${page}?pid=${encodeURIComponent(projectId)}`;
                el.href = url;
                el.textContent = url;
            });
        }

        function fallbackCopy(text) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.className = 'offscreen-copy-buffer';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }

        window.copyUrl = function(linkId, btn) {
            const url = document.getElementById(linkId)?.href;
            if (!url) return;
            const originalNodes = [...btn.childNodes].map(node => node.cloneNode(true));
            function onSuccess() {
                setIconOnlyButton(btn, 'check');
                btn.classList.add('copy-success');
                setTimeout(() => {
                    btn.textContent = '';
                    btn.append(...originalNodes.map(node => node.cloneNode(true)));
                    btn.classList.remove('copy-success');
                }, 1500);
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(onSuccess).catch(() => {
                    fallbackCopy(url);
                    onSuccess();
                });
            } else {
                fallbackCopy(url);
                onSuccess();
            }
        };

        function registerAdminShortcuts() {
            KeyboardShortcuts.register('1', '準備フェーズ', () => switchTab('tab-prep'));
            KeyboardShortcuts.register('2', '公開フェーズ', () => switchTab('tab-entries'));
            KeyboardShortcuts.register('3', '採点フェーズ', () => switchTab('tab-scan'));
            KeyboardShortcuts.register('4', '結果フェーズ', () => switchTab('tab-stats'));
            KeyboardShortcuts.register('5', '設定', () => switchTab('tab-settings'));
        }



        let totalQuestions = 100;
        let scoresData = {};
        let entryNumbers = [];
        let modelAnswers = [];
        let adminEntriesCount = 0;
        let adminProjectName = '';
        let requiredScorers = 3;
        let modelAnswersLoaded = false;

        function toLocalInputValue(isoValue) {
            if (!isoValue) return '';
            const d = new Date(isoValue);
            if (Number.isNaN(d.getTime())) return '';
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }

        function normalizeSupabaseEntry(row) {
            return {
                ...row,
                entryNumber: row.entry_number,
                encryptedPII: row.encrypted_pii,
                entryName: row.entry_name,
                isChubu: row.is_chubu,
                checkedIn: row.checked_in,
                waitlistPromotedAt: row.waitlist_promoted_at,
                waitlistPromotionNotice: row.waitlist_promotion_notice,
            };
        }

        async function refreshSupabaseScoringData() {
            if (!isSupabaseMode) return;
            const [votes, finals, scorers] = await Promise.all([
                CIQSupabaseAPI.listScoreVotes(projectId),
                CIQSupabaseAPI.listFinalResults(projectId),
                CIQSupabaseAPI.listQuestionScorers(projectId),
            ]);
            const entries = Object.values(window._entriesRaw || {});
            const entryNumberById = Object.fromEntries(entries.map(entry => [entry.id, entry.entryNumber || entry.entry_number]));
            const nextScores = {};

            for (const scorer of scorers) {
                if (!scorer.completed_at) continue;
                const key = `__completed__q${scorer.question_number}`;
                if (!nextScores[key]) nextScores[key] = {};
                nextScores[key][scorer.scorer_member_id] = true;
            }

            for (const vote of votes) {
                const entryNumber = entryNumberById[vote.entry_id];
                if (!entryNumber) continue;
                if (!nextScores[entryNumber]) nextScores[entryNumber] = {};
                const qKey = `q${vote.question_number}`;
                if (!nextScores[entryNumber][qKey]) nextScores[entryNumber][qKey] = {};
                nextScores[entryNumber][qKey][vote.scorer_member_id] = vote.result;
            }

            for (const finalResult of finals) {
                const entryNumber = entryNumberById[finalResult.entry_id];
                if (!entryNumber) continue;
                const key = `__final__q${finalResult.question_number}`;
                if (!nextScores[key]) nextScores[key] = {};
                nextScores[key][entryNumber] = finalResult.result;
            }

            scoresData = nextScores;
        }

        async function initSupabaseAdmin() {
            const project = await CIQSupabaseAPI.getProject(projectId);
            totalQuestions = project.question_count || 100;
            requiredScorers = project.required_scorers || 3;
            adminProjectName = project.name || projectId;

            window._adminPrivateKeyReadyPromise = ensureProjectPrivateKeyAvailable();

            document.getElementById('question-count').value = totalQuestions;
            document.getElementById('stat-total').textContent = totalQuestions;

            document.getElementById('entry-open-toggle').checked = project.entry_open === true;
            if (project.period_start) {
                const val = toLocalInputValue(project.period_start);
                document.getElementById('entry-period-start').value = val;
                document.getElementById('dt-start-display').textContent = formatDtDisplay(val);
            }
            if (project.period_end) {
                const val = toLocalInputValue(project.period_end);
                document.getElementById('entry-period-end').value = val;
                document.getElementById('dt-end-display').textContent = formatDtDisplay(val);
            }
            if (project.waitlist_promotion_period_end) {
                const val = toLocalInputValue(project.waitlist_promotion_period_end);
                document.getElementById('waitlist-period-end').value = val;
                document.getElementById('dt-waitlist-end-display').textContent = formatDtDisplay(val);
            } else if (typeof updateWaitlistPromotionDeadlineDisplay === 'function') {
                updateWaitlistPromotionDeadlineDisplay();
            }
            if (project.max_entries && project.max_entries > 0) {
                document.getElementById('max-entries-toggle').checked = true;
                document.getElementById('max-entries-status').textContent = `${project.max_entries}人`;
                document.getElementById('max-entries-status').className = 'status-badge status-open';
                document.getElementById('max-entries-input-area').classList.remove('u-hidden');
                document.getElementById('setting-max-entries').value = project.max_entries;
            } else {
                document.getElementById('max-entries-toggle').checked = false;
                document.getElementById('max-entries-status').textContent = '制限なし';
                document.getElementById('max-entries-status').className = 'status-badge status-closed';
                document.getElementById('max-entries-input-area').classList.add('u-hidden');
            }
            updateEntryOpenStatus();

            document.getElementById('setting-terms').value = project.terms || '';
            const notifyEdit = document.getElementById('setting-notify-entry-edit');
            const notifyCancel = document.getElementById('setting-notify-entry-cancel');
            const notifyLate = document.getElementById('setting-notify-late-notice');
            if (notifyEdit) notifyEdit.checked = project.notify_entry_edit !== false;
            if (notifyCancel) notifyCancel.checked = project.notify_entry_cancel !== false;
            if (notifyLate) notifyLate.checked = project.notify_late_notice !== false;
            const disclosureToggle = document.getElementById('disclosure-open-toggle');
            if (disclosureToggle) disclosureToggle.checked = project.disclosure_enabled === true;
            if (project.disclosure_period_start) {
                const val = toLocalInputValue(project.disclosure_period_start);
                document.getElementById('disclosure-period-start').value = val;
                document.getElementById('dt-disclosure-start-display').textContent = formatDtDisplay(val);
            }
            if (project.disclosure_period_end) {
                const val = toLocalInputValue(project.disclosure_period_end);
                document.getElementById('disclosure-period-end').value = val;
                document.getElementById('dt-disclosure-end-display').textContent = formatDtDisplay(val);
            }
            if (typeof updateDisclosureOpenStatus === 'function') updateDisclosureOpenStatus();

            modelAnswers = new Array(totalQuestions).fill('');
            updateAdminOverview();
        }

        async function loadModelAnswersOnce() {
            if (modelAnswersLoaded) return;
            modelAnswersLoaded = true;
            modelAnswers = new Array(totalQuestions).fill('');
            try {
                const rows = await CIQSupabaseAPI.listModelAnswers(projectId);
                rows.forEach(row => {
                    const idx = Number(row.question_number) - 1;
                    if (idx >= 0 && idx < modelAnswers.length) modelAnswers[idx] = row.answer || '';
                });
            } catch (e) {
                console.warn('模範解答の読み込みをスキップ:', e);
            }
            renderModelGrid();
        }

        function updateAdminOverview() {
            const entryStatus = document.getElementById('entry-open-status')?.textContent?.trim() || '確認中';
            const disclosureStatus = document.getElementById('disclosure-open-status')?.textContent?.trim() || '確認中';
            const entryCount = adminEntriesCount || (window._entriesRaw ? Object.keys(window._entriesRaw).length : 0);
            const done = document.getElementById('stat-done')?.textContent || '-';
            const conflict = document.getElementById('stat-conflict')?.textContent || '-';
            const total = totalQuestions || document.getElementById('stat-total')?.textContent || '-';
            const csvStatus = document.getElementById('csv-status');
            const outputReady = csvStatus?.classList.contains('ready');

            const setText = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };

            setText('overview-entry-status', entryStatus);
            setText('overview-entry-count', `参加者 ${entryCount} 名`);
            setText('overview-disclosure-status', disclosureStatus);
            setText('overview-disclosure-meta', '成績照会ページ');
            setText('overview-scoring-status', conflict !== '-' && Number(conflict) > 0 ? '要確認あり' : '進行中');
            setText('overview-scoring-count', `${done} / ${total} 問完了`);
            setText('overview-output-status', outputReady ? '出力可能' : '未確定');
            setText('overview-output-meta', outputReady ? 'CSV / PDF を出力できます' : '全問確定後に出力できます');

            // 要確認ステータスタイル（危険度に応じて色切替）
            const conflictNum = Number(conflict);
            const conflictTile = document.getElementById('status-tile-conflict');
            if (conflictTile) {
                conflictTile.classList.toggle('is-danger', Number.isFinite(conflictNum) && conflictNum > 0);
                conflictTile.classList.toggle('is-next', !(Number.isFinite(conflictNum) && conflictNum > 0) && disclosureStatus === '停止中');
            }
            setText('overview-conflict-count', Number.isFinite(conflictNum) ? (conflictNum > 0 ? `${conflictNum} 件` : '0') : '-');

            // タブの件数バッジを反映
            setTabCount('entries', entryCount, false);
            setTabCount('scan', adminScanCount, false);
            setTabCount('conflicts', Number.isFinite(conflictNum) ? conflictNum : '-', conflictNum > 0);
        }

        window.updateAdminOverview = updateAdminOverview;
        window.setAdminEntriesCount = function(count) {
            adminEntriesCount = count || 0;
            updateAdminOverview();
        };
        window.setAdminScanCount = function(count) {
            adminScanCount = Number.isFinite(Number(count)) ? Number(count) : null;
            updateAdminOverview();
        };

        // タブ切り替え（遅延ロード対応）
        const tabLoaded = { 'tab-entries': false, 'tab-prep': false, 'tab-checkin': false, 'tab-scan': false, 'tab-stats': false, 'tab-settings': false };

        function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(t => {
                t.classList.remove('active');
                t.hidden = true;
            });
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            const panel = document.getElementById(tabId);
            panel.classList.add('active');
            panel.hidden = false;
            const btns = document.querySelectorAll('.tab-btn');
            // フェーズ順に依存しないよう data-tab-target で対応ボタンを引く
            const activeBtn = document.querySelector(`.tab-btn[data-tab-target="${tabId}"]`);
            activeBtn?.classList.add('active');
            document.querySelectorAll('.phase-quick-btn[data-tab-target]').forEach(btn => {
                const isActive = btn.dataset.tabTarget === tabId;
                btn.classList.toggle('active', isActive);
                if (isActive) btn.setAttribute('aria-current', 'step');
                else btn.removeAttribute('aria-current');
            });
            // ARIA 同期（initTablist が未初期化の場合のフォールバック込み）
            btns.forEach(b => {
                const isActive = b.classList.contains('active');
                b.setAttribute('aria-selected', isActive ? 'true' : 'false');
                b.tabIndex = isActive ? 0 : -1;
            });

            // 遅延ロード: 初回表示時のみデータ取得
            if (!tabLoaded[tabId]) {
                tabLoaded[tabId] = true;
                switch (tabId) {
                    case 'tab-entries':
                        loadAdminEntries();
                        break;
                    case 'tab-prep':
                        loadModelAnswersOnce();
                        break;
                    case 'tab-scan':
                        loadEntryList();
                        break;
                    case 'tab-settings':
                        if (isSupabaseMode && typeof startProjectMembersAutoRefresh === 'function') startProjectMembersAutoRefresh();
                        else if (isSupabaseMode && typeof loadProjectMembers === 'function') loadProjectMembers();
                        break;
                }
            }
            // 集計タブは毎回更新
            if (tabId === 'tab-stats') updateStatsView();
            updateAdminOverview();
            activeBtn?.focus?.({ preventScroll: true });
        }

        // タブの件数バッジを更新（参加者数 / 答案数 / 要確認数）
        function setTabCount(name, count, warn) {
            document.querySelectorAll(`[data-tab-count="${name}"]`).forEach(el => {
                const hasCount = Number.isFinite(Number(count)) && Number(count) >= 0;
                el.textContent = hasCount ? count : '-';
                el.classList.toggle('has-warn', Boolean(warn) && Number(count) > 0);
                el.hidden = !hasCount;
            });
        }

        // ============================
        // 受付番号での手動受付(運営専用)
        // ============================
        // checkin.html は参加者が二次元コードをかざす前提の画面なので、番号だけで受付状態を書き換える操作は
        // そちらに置かず運営専用のこの画面に置く。サーバ側も owner/admin 限定にしてある。
        // 照会 -> 氏名・所属を目視確認 -> 確定 の2段階にして、打ち間違いで別人を受付済みにする事故も防ぐ。
        const MANUAL_CHECKIN_STATUS_LABEL = {
            registered: '登録済み',
            late: '遅刻連絡あり',
            waitlist: 'キャンセル待ち',
            canceled: 'キャンセル済み',
        };

        function setupManualCheckIn() {
            const form = document.getElementById('manual-checkin-form');
            const input = document.getElementById('manual-checkin-number');
            const lookupBtn = document.getElementById('manual-checkin-lookup');
            const confirmBox = document.getElementById('manual-checkin-confirm');
            const nameEl = document.getElementById('manual-checkin-name');
            const subEl = document.getElementById('manual-checkin-sub');
            const stateEl = document.getElementById('manual-checkin-state');
            const commitBtn = document.getElementById('manual-checkin-commit');
            const undoBtn = document.getElementById('manual-checkin-undo');
            const cancelBtn = document.getElementById('manual-checkin-cancel');
            const statusEl = document.getElementById('manual-checkin-status');
            if (!form || !input || !confirmBox) return;

            // 照会結果。確定・取り消しはこの id をサーバへ送り返し、照会を経ない実行を防ぐ。
            let pending = null;

            function resetPanel() {
                pending = null;
                confirmBox.classList.add('u-hidden');
                input.value = '';
                input.focus();
            }

            function showPending(entry) {
                pending = entry;
                nameEl.textContent = entry.entryName || `No.${padNum(entry.entryNumber)}`;
                subEl.textContent = [`受付番号 ${padNum(entry.entryNumber)}`, entrySubText(entry)].filter(Boolean).join(' · ');

                const statusLabel = MANUAL_CHECKIN_STATUS_LABEL[entry.status] || entry.status || '';
                const checkable = entry.status === 'registered' || entry.status === 'late';
                stateEl.textContent = entry.checkedIn ? `受付済み（${statusLabel}）` : `未受付（${statusLabel}）`;

                commitBtn.classList.toggle('u-hidden', Boolean(entry.checkedIn) || !checkable);
                undoBtn.classList.toggle('u-hidden', !entry.checkedIn);
                if (!checkable && !entry.checkedIn) {
                    setPageMessage(statusEl, 'この参加者は受付対象外です。状態を確認してください。', 'warning');
                }
                confirmBox.classList.remove('u-hidden');
            }

            function entrySubText(entry) {
                return [entry?.affiliation, entry?.grade].filter(Boolean).join(' / ');
            }

            async function withBusy(button, run) {
                const targets = [lookupBtn, commitBtn, undoBtn, cancelBtn, input].filter(Boolean);
                targets.forEach(el => { el.disabled = true; });
                try {
                    await run();
                } catch (e) {
                    setPageMessage(statusEl, e.message || '操作に失敗しました。', 'error');
                } finally {
                    targets.forEach(el => { el.disabled = false; });
                }
            }

            form.addEventListener('submit', (event) => {
                event.preventDefault();
                const value = Number(input.value);
                if (!Number.isFinite(value) || value <= 0) {
                    setPageMessage(statusEl, '受付番号を入力してください。', 'error');
                    return;
                }
                clearPageMessage(statusEl);
                withBusy(lookupBtn, async () => {
                    const entry = await CIQSupabaseAPI.lookupEntryByNumber(projectId, value);
                    showPending(entry);
                });
            });

            commitBtn?.addEventListener('click', () => {
                if (!pending) return;
                clearPageMessage(statusEl);
                withBusy(commitBtn, async () => {
                    const result = await CIQSupabaseAPI.checkInEntryManually(projectId, pending.entryNumber, pending.id);
                    const name = result.entry?.entryName || `No.${padNum(pending.entryNumber)}`;
                    if (result.result === 'already') {
                        setPageMessage(statusEl, `${name} はすでに受付済みです。`, 'warning');
                    } else {
                        setPageMessage(statusEl, `${name} を受付しました。`, 'success');
                    }
                    resetPanel();
                });
            });

            undoBtn?.addEventListener('click', async () => {
                if (!pending) return;
                const name = pending.entryName || `No.${padNum(pending.entryNumber)}`;
                const ok = await showConfirm(`${name} の受付を取り消します。よろしいですか?`, '取り消す');
                if (!ok) return;
                clearPageMessage(statusEl);
                withBusy(undoBtn, async () => {
                    await CIQSupabaseAPI.undoCheckIn(projectId, pending.entryNumber, pending.id);
                    setPageMessage(statusEl, `${name} の受付を取り消しました。`, 'success');
                    resetPanel();
                });
            });

            cancelBtn?.addEventListener('click', () => {
                clearPageMessage(statusEl);
                resetPanel();
            });
        }

        async function init() {
            setupAdminEventHandlers();
            setupManualCheckIn();
            setupPublicLinks();
            registerAdminShortcuts();
            if (typeof bindEmailSettingsAutosave === 'function') bindEmailSettingsAutosave();

            if (!isSupabaseMode) throw new Error('Supabase設定が必要です。');

            await initSupabaseAdmin();
            const hash = location.hash.replace('#', '');
            if (hash && document.getElementById(hash)) {
                switchTab(hash);
            } else {
                tabLoaded['tab-entries'] = true;
                if (typeof loadAdminEntries === 'function') loadAdminEntries();
            }
        }

        async function ensureProjectPrivateKeyAvailable() {
            if (!isSupabaseMode) return;
            if (session.get('projectKeyFunctionUnavailable') === 'true') return;
            const existing = projectKeyStore.get();
            if (existing) {
                try {
                    await CIQSupabaseAPI.storeProjectPrivateKey(projectId, JSON.parse(existing));
                } catch (e) {
                    if (e.status === 404) {
                        session.set('projectKeyFunctionUnavailable', 'true');
                        return;
                    }
                    console.warn('プロジェクト鍵の自動保管をスキップ:', e);
                }
                return;
            }

            try {
                const privateKeyJwk = await CIQSupabaseAPI.fetchProjectPrivateKey(projectId);
                projectKeyStore.set(JSON.stringify(privateKeyJwk));
            } catch (e) {
                if (e.status === 404) {
                    session.set('projectKeyFunctionUnavailable', 'true');
                    return;
                }
                console.warn('プロジェクト鍵の自動取得をスキップ:', e);
            }
        }

        // init() は admin_settings.js（最後に読み込まれるスクリプト）の末尾で呼び出し
