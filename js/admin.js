
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

        document.getElementById('project-id-display').innerHTML = `<i class="fa-solid fa-copy"></i> ${projectId}`;
        const menuName = document.getElementById('menu-scorer-name');
        if (menuName) menuName.textContent = auth.scorerName;

        function copyProjectId() {
            const el = document.getElementById('project-id-display');
            navigator.clipboard.writeText(projectId).then(() => {
                el.querySelector('i').className = 'fa-solid fa-check';
                el.querySelector('i').style.color = '#34d399';
                setTimeout(() => {
                    el.querySelector('i').className = 'fa-solid fa-copy';
                    el.querySelector('i').style.color = '';
                }, 1500);
            });
        }



        let totalQuestions = 100;
        let scoresData = {};
        let entryNumbers = [];
        let modelAnswers = [];

        // タブ切り替え（遅延ロード対応）
        const tabLoaded = { 'tab-entries': false, 'tab-prep': false, 'tab-scan': false, 'tab-stats': false, 'tab-settings': false };

        function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            const btns = document.querySelectorAll('.tab-btn');
            const tabs = ['tab-entries', 'tab-prep', 'tab-scan', 'tab-stats', 'tab-settings'];
            btns[tabs.indexOf(tabId)]?.classList.add('active');

            // 遅延ロード: 初回表示時のみデータ取得
            if (!tabLoaded[tabId]) {
                tabLoaded[tabId] = true;
                switch (tabId) {
                    case 'tab-entries':
                        loadAdminEntries();
                        break;
                    case 'tab-scan':
                        loadEntryList();
                        break;
                    case 'tab-stats':
                        // スコアリスナーが既に動いているので updateStatsView を呼ぶだけ
                        updateStatsView();
                        break;
                }
            }
        }

        async function init() {
            await waitForAuth();
            // ハッシュによるタブ指定
            const hash = location.hash.replace('#', '');
            if (hash && document.getElementById(hash)) {
                switchTab(hash);
            } else {
                // デフォルトタブ (参加者) を遅延ロード
                tabLoaded['tab-entries'] = true;
                loadAdminEntries();
            }

            // プロジェクトアクセス日時更新とデータクリーンアップ（非同期、awaitなし）
            dbSet(`projects/${projectId}/publicSettings/lastAccess`, SERVER_TIMESTAMP).catch(() => {});
            purgeOldImages();


            // キーボードショートカット登録（管理画面固有）
            KeyboardShortcuts.register('1', '参加者タブ', () => switchTab('tab-entries'));
            KeyboardShortcuts.register('2', '採点準備タブ', () => switchTab('tab-prep'));
            KeyboardShortcuts.register('3', '答案管理タブ', () => switchTab('tab-scan'));
            KeyboardShortcuts.register('4', '集計タブ', () => switchTab('tab-stats'));
            KeyboardShortcuts.register('5', '設定タブ', () => switchTab('tab-settings'));

            // リンクURL設定
            const lOrigins = window.location.origin + window.location.pathname.replace('admin.html', '');
            document.getElementById('entry-link').href = `${lOrigins}entry_list.html?pid=${projectId}`;
            document.getElementById('entry-link').textContent = `${lOrigins}entry_list.html?pid=${projectId}`;
            document.getElementById('registration-link').href = `${lOrigins}entry.html?pid=${projectId}`;
            document.getElementById('registration-link').textContent = `${lOrigins}entry.html?pid=${projectId}`;
            document.getElementById('cancel-link').href = `${lOrigins}cancel.html?pid=${projectId}`;
            document.getElementById('cancel-link').textContent = `${lOrigins}cancel.html?pid=${projectId}`;
            document.getElementById('disclosure-link').href = `${lOrigins}disclosure.html?pid=${projectId}`;
            document.getElementById('disclosure-link').textContent = `${lOrigins}disclosure.html?pid=${projectId}`;

            window.copyUrl = function(linkId, btn) {
                const url = document.getElementById(linkId).href;
                const original = btn.innerHTML;
                function onSuccess() {
                    btn.innerHTML = '<i class="fa-solid fa-check"></i>';
                    btn.style.background = '#10b981';
                    setTimeout(() => { btn.innerHTML = original; btn.style.background = ''; }, 1500);
                }
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(url).then(onSuccess).catch(() => {
                        fallbackCopy(url); onSuccess();
                    });
                } else {
                    fallbackCopy(url); onSuccess();
                }
            };
            function fallbackCopy(text) {
                const ta = document.createElement('textarea');
                ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select();
                document.execCommand('copy'); document.body.removeChild(ta);
            }

            // 設定データ読み込み
            const cfg = await dbGet(`projects/${projectId}/protected/${secretHash}/config`);
            if (cfg) {
                totalQuestions = cfg.questionCount || 100;
                document.getElementById('question-count').value = totalQuestions;
            } else {
                await dbSet(`projects/${projectId}/protected/${secretHash}/config`, { questionCount: 100 });
            }

            const ec = await dbGet(`projects/${projectId}/protected/${secretHash}/entryConfig`);
            if (ec) {
                const isOpen = ec.entryOpen === true;
                document.getElementById('entry-open-toggle').checked = isOpen;
                if (ec.periodStart) {
                    document.getElementById('entry-period-start').value = ec.periodStart;
                    document.getElementById('dt-start-display').textContent = formatDtDisplay(ec.periodStart);
                }
                if (ec.periodEnd) {
                    document.getElementById('entry-period-end').value = ec.periodEnd;
                    document.getElementById('dt-end-display').textContent = formatDtDisplay(ec.periodEnd);
                }
                if (ec.maxEntries && ec.maxEntries > 0) {
                    document.getElementById('max-entries-toggle').checked = true;
                    document.getElementById('max-entries-status').textContent = `${ec.maxEntries}人`;
                    document.getElementById('max-entries-status').className = 'status-badge status-open';
                    document.getElementById('max-entries-input-area').style.display = 'block';
                    document.getElementById('setting-max-entries').value = ec.maxEntries;
                }
                updateEntryOpenStatus();
            }

            // publicSettings の読み込み（規約等）
            const publicSettings = await dbGet(`projects/${projectId}/publicSettings`) || {};

            if (publicSettings.terms) {
                document.getElementById('setting-terms').value = publicSettings.terms;
            }

            document.getElementById('stat-total').textContent = totalQuestions;

            // 必要採点者数を3人に固定（DB書き込み）
            await dbSet(`projects/${projectId}/protected/${secretHash}/requiredScorers`, 3);

            // エントリ番号取得
            try {
                const data = await dbShallow(`projects/${projectId}/protected/${secretHash}/answers`);
                if (data) entryNumbers = Object.keys(data).map(Number).sort((a, b) => a - b);
            } catch (e) {
                console.error('エントリ番号取得エラー:', e);
            }

            // リアルタイムリスナーでスコア取得
            const scorePoller = new Poller(
                `projects/${projectId}/protected/${secretHash}/scores`,
                (data) => {
                    scoresData = data || {};
                    // 集計タブが表示中の場合のみ更新
                    if (document.getElementById('tab-stats')?.classList.contains('active')) {
                        updateStatsView();
                    }
                },
                5000
            );
            scorePoller.start();

            // 模範解答はオンデマンド → prep/模範解答タブで初回ロード
            const modelData = await dbGet(`projects/${projectId}/protected/${secretHash}/answers_text`);
            modelAnswers = new Array(totalQuestions).fill('');
            if (modelData) {
                Object.keys(modelData).forEach(q => { modelAnswers[q - 1] = modelData[q]; });
            }
            renderModelGrid();
        }


        // init() は admin_settings.js（最後に読み込まれるスクリプト）の末尾で呼び出し
