
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

        // Firebase Storage 初期化 (admin.html のみ読み込み)
        const storage = (typeof firebase !== 'undefined' && firebase.storage) ? firebase.storage() : null;

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

            // オンボーディングチェックリスト（セットアップ状況に応じて表示）
            renderOnboarding();

            // キーボードショートカット登録（管理画面固有）
            KeyboardShortcuts.register('1', '参加者タブ', () => switchTab('tab-entries'));
            KeyboardShortcuts.register('2', '採点準備タブ', () => switchTab('tab-prep'));
            KeyboardShortcuts.register('3', '答案管理タブ', () => switchTab('tab-scan'));
            KeyboardShortcuts.register('4', '集計タブ', () => switchTab('tab-stats'));
            KeyboardShortcuts.register('5', '設定タブ', () => switchTab('tab-settings'));
            KeyboardShortcuts.register('e', 'データエクスポート', () => exportProjectData());

            // インタラクティブチュートリアル（初回訪問時に自動開始）
            const adminTour = new TourGuide('admin_tour', [
                { selector: '.tabs', title: 'タブナビゲーション', text: 'ここで各機能を切り替えます。キーボードの 1〜5 でも切替可能です。' },
                { selector: '#entry-open-toggle', title: 'エントリー受付', text: 'トグルで受付の開始・停止を制御します。期間設定も可能です。', position: 'bottom' },
                { selector: '.link-row', title: '公開リンク', text: 'エントリーフォーム、名簿、キャンセルフォーム等のURLです。参加者に共有してください。', position: 'bottom' },
                { selector: '[onclick="switchTab(\'tab-prep\')"]', title: '採点準備タブ', text: '回答用紙の生成と、模範解答の登録を行います。' },
                { selector: '[onclick="switchTab(\'tab-scan\')"]', title: '答案管理タブ', text: '回収した答案PDFをアップロードして読み取り・保存します。' },
                { selector: '[onclick="switchTab(\'tab-stats\')"]', title: '集計タブ', text: '採点状況のリアルタイム集計とCSV出力を行います。' },
                { selector: '[onclick="switchTab(\'tab-settings\')"]', title: '設定タブ', text: 'プロジェクト名の変更、大会形式の設定、データのバックアップ・削除はここから。' },
            ]);
            adminTour.autoStart(2000);

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

            // 設定データ読み込み (REST)
            const cfg = await dbGet(`projects/${projectId}/protected/${secretHash}/config`);
            if (cfg) {
                totalQuestions = cfg.questionCount || 100;
                document.getElementById('question-count').value = totalQuestions;
            } else {
                await dbSet(`projects/${projectId}/protected/${secretHash}/config`, { questionCount: 100 });
            }

            const ec = await dbGet(`projects/${projectId}/protected/${secretHash}/entryConfig`);
            if (ec) {
                const isOpen = ec.entryOpen !== false;
                document.getElementById('entry-open-toggle').checked = isOpen;
                if (ec.periodStart) {
                    document.getElementById('entry-period-start').value = ec.periodStart;
                    document.getElementById('dt-start-display').textContent = formatDtDisplay(ec.periodStart);
                }
                if (ec.periodEnd) {
                    document.getElementById('entry-period-end').value = ec.periodEnd;
                    document.getElementById('dt-end-display').textContent = formatDtDisplay(ec.periodEnd);
                }
                updateEntryOpenStatus();
            }

            // publicSettings の一括読み込み（フルオープン、規約、エントリーネーム使用設定）
            const publicSettings = await dbGet(`projects/${projectId}/publicSettings`) || {};
            
            if (publicSettings.fullOpen) {
                document.getElementById('full-open-toggle').checked = true;
                document.getElementById('full-open-status').textContent = 'フルオープン';
                document.getElementById('full-open-status').className = 'status-badge status-open';
            }
            if (publicSettings.terms) {
                document.getElementById('setting-terms').value = publicSettings.terms;
            }
            if (publicSettings.allowEntryNameForParticipation) {
                document.getElementById('allow-entry-name-toggle').checked = true;
                document.getElementById('allow-entry-name-status').textContent = '許可';
                document.getElementById('allow-entry-name-status').className = 'status-badge status-open';
            }

            document.getElementById('stat-total').textContent = totalQuestions;

            // エントリ番号取得（REST shallow）
            try {
                const data = await dbShallow(`projects/${projectId}/protected/${secretHash}/answers`);
                if (data) entryNumbers = Object.keys(data).map(Number).sort((a, b) => a - b);
            } catch (e) {
                console.error('エントリ番号取得エラー:', e);
            }

            // スコアポーリング（WebSocket .on() の代替 — 5秒間隔）
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
            IdleManager.register(scorePoller);
            scorePoller.start();
            IdleManager.init();

            // 模範解答はオンデマンド → prep/模範解答タブで初回ロード
            const modelData = await dbGet(`projects/${projectId}/protected/${secretHash}/answers_text`);
            modelAnswers = new Array(totalQuestions).fill('');
            if (modelData) {
                Object.keys(modelData).forEach(q => { modelAnswers[q - 1] = modelData[q]; });
            }
            renderModelGrid();
        }


        // init() は admin_settings.js（最後に読み込まれるスクリプト）の末尾で呼び出し
