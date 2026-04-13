
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

        // ============================
        // TAB 1: 回答用紙
        // ============================
        const marker_b64 = [
            "data:image/png;base64,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",
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAfQAAAH0CAAAAADuvYBWAAAJk0lEQVR4Ae3BQQHAQAzDMJs/6IxE+tlFknmOzHNkniPzHJnnyDxH5jkyz5F5jsxzZJ4j8xyZ58g8R+Y5Ms+ReY7Mc2SeI/McmefIPEfmOTLPkXmOzHNkniPzHJnnyDxH5jkyz5F5jsxzZJ4j8xyZ58g8R+Y5Ms+ReY7Mc2SeI/McmefIPEfmOTLPkXmOzHNkniPzHJnnyDxH5jkyz5F5jsxzZJ4j8xyZ58g8R+Y5Ms+ReY7Mc2SeI/McmefIPEfmOTLPkZJQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRUy56QkVMick5JQIXNOSkKFzDkpCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RCSkKFdIQ/kgopCRXSEf5IKqQkVEhH+COpkJJQIR3hj6RC5jkyz5F5jsxzZJ4j8xyZ58g8R+Y5Ms+ReY7Mc2SeI/McmefIPEfmOTLPkXmOzHNkniPzHJnnyDxH5jkyz5F5jsxzZJ4j8xyZ58g8R+Y5Ms+ReY7Mc2SeI/McmefIPEfmOTLPkXmOzHNkniPzHJnnyDxH5jkyz5F5jsxzZJ4j8xyZ58g8R+Y5Ms+ReY7Mc2SeI/McmefIPEfmOTLPkXmOzHNkniPzHJnnfCsargSn6pZVAAAAAElFTkSuQmCC",
            "data:image/png;base64,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",
            "data:image/png;base64,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"
        ];

        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        async function buildLayoutConfig(qCount) {
            const qCols = 5;
            const pageWidth = 210, pageHeight = 297;
            const config = { questionCount: qCount, columns: qCols, questionOrder: 'horizontal', scale: 3, tombo: [], markCells: [], answerRegions: [] };
            const markerSize = 10, margin = 5;
            const markerPositions = [{ x: margin, y: margin, id: 0 }, { x: pageWidth - margin - markerSize, y: margin, id: 1 }, { x: margin, y: pageHeight - margin - markerSize, id: 2 }, { x: pageWidth - margin - markerSize, y: pageHeight - margin - markerSize, id: 3 }];
            
            for (const p of markerPositions) config.tombo.push({ x: p.x, y: p.y, w: markerSize, h: markerSize });
            
            const gridMarginX = 15, gridMarginTop = 5, gridSpaceWidth = pageWidth - gridMarginX * 2;
            const colWidth = gridSpaceWidth / qCols, rows = Math.ceil(qCount / qCols), maxGridHeight = 255, rowHeight = maxGridHeight / rows;
            
            for (let i = 0; i < qCount; i++) {
                const row = Math.floor(i / qCols), col = i % qCols;
                const x = gridMarginX + col * colWidth, y = gridMarginTop + row * rowHeight;
                config.answerRegions.push({ x, y, w: colWidth, h: rowHeight });
            }
            
            const boxX = 15, boxY = gridMarginTop + maxGridHeight + 5, boxW = 180, boxH = 26, rH = boxH / 3;
            const L2 = boxX + 13, bubbleW = 3.2, bubbleH = 5.0;
            
            for (let row = 0; row < 3; row++) {
                const cy = boxY + row * rH + rH / 2;
                for (let col = 0; col < 10; col++) {
                    const cx = L2 + 1.5 + col * 4.2;
                    config.markCells.push({ x: cx, y: cy - bubbleH / 2, w: bubbleW, h: bubbleH, row, col });
                }
            }
            return config;
        }

        async function saveQuestionCount() {
            const qCount = parseInt(document.getElementById('question-count').value);
            if (!qCount || qCount < 10 || qCount % 10 !== 0) { showAdminToast("問題数は10の倍数で指定してください"); return; }
            try {
                const config = await buildLayoutConfig(qCount);
                await dbSet(`projects/${projectId}/protected/${secretHash}/config`, config);
                totalQuestions = qCount;
                showAdminToast("問題数とレイアウトを保存しました！", "success");
            } catch (err) {
                showAdminToast("保存エラー: " + err.message);
            }
        }

        async function generatePDF() {
            try {
                const qCount = parseInt(document.getElementById('question-count').value);
                const qCols = 5;
                if (qCount < 10 || qCount % 10 !== 0) { showAdminToast("問題数は10の倍数で指定してください"); return; }
                // 自動的に問題数も保存
                await saveQuestionCount();
                window.jsPDF = window.jspdf.jsPDF;
                const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                const pageWidth = 210, pageHeight = 297;
                const config = { questionCount: qCount, columns: qCols, questionOrder: 'horizontal', scale: 3, tombo: [], markCells: [], answerRegions: [] };
                const markerSize = 10, margin = 5;
                // マーカー画像をcanvas経由でjsPDFに渡す（PNGデコーダ不具合 & JPEG劣化回避）
                const markerPositions = [{ x: margin, y: margin, id: 0 }, { x: pageWidth - margin - markerSize, y: margin, id: 1 }, { x: margin, y: pageHeight - margin - markerSize, id: 2 }, { x: pageWidth - margin - markerSize, y: pageHeight - margin - markerSize, id: 3 }];
                for (const p of markerPositions) {
                    const img = await new Promise((resolve, reject) => {
                        const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = `aruco_markers/marker_id${p.id}.png`;
                    });
                    const mc = document.createElement('canvas'); mc.width = img.width; mc.height = img.height;
                    const mctx = mc.getContext('2d');
                    mctx.fillStyle = '#ffffff'; mctx.fillRect(0, 0, mc.width, mc.height);
                    mctx.drawImage(img, 0, 0);
                    doc.addImage(mc, 'PNG', p.x, p.y, markerSize, markerSize);
                }
                const fontRes = await fetch("fonts/BIZUDGothic-Subset.ttf");
                const fontBuffer = await fontRes.arrayBuffer();
                let binary = ''; const bytes = new Uint8Array(fontBuffer);
                for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                doc.addFileToVFS('BIZUDGothic.ttf', window.btoa(binary));
                doc.addFont('BIZUDGothic.ttf', 'BIZUDGothic', 'normal');
                doc.setFont('BIZUDGothic'); doc.setFontSize(8); doc.setTextColor(50);
                const gridMarginX = 15, gridMarginTop = 5, gridSpaceWidth = pageWidth - gridMarginX * 2;
                const colWidth = gridSpaceWidth / qCols, rows = Math.ceil(qCount / qCols), maxGridHeight = 255, rowHeight = maxGridHeight / rows;
                doc.setLineWidth(0.2);
                for (let i = 0; i < qCount; i++) {
                    const row = Math.floor(i / qCols), col = i % qCols;
                    const x = gridMarginX + col * colWidth, y = gridMarginTop + row * rowHeight;
                    doc.rect(x, y, colWidth, rowHeight, 'S'); doc.text((i + 1).toString(), x + 2, y + 4);
                }
                function drawVerticalText(doc, str, x, centerY) {
                    const chars = str.split(''), spacing = 3.5, startY = centerY - ((chars.length - 1) * spacing) / 2;
                    chars.forEach((c, i) => doc.text(c, x, startY + i * spacing, { align: 'center', baseline: 'middle' }));
                }
                const boxX = 15, boxY = gridMarginTop + maxGridHeight + 5, boxW = 180, boxH = 26;
                doc.rect(boxX, boxY, boxW, boxH, 'S');
                const L1 = boxX + 6, L2 = boxX + 13, L3 = boxX + 57, L4 = L3 + 6, L5 = L4 + 18, L6 = L5 + 6, L7 = L6 + 40, L8 = L7 + 6;
                [L1, L2, L3, L4, L5, L6, L7, L8].forEach(lx => doc.line(lx, boxY, lx, boxY + boxH, 'S'));
                const rH = boxH / 3;
                doc.line(L1, boxY + rH, L3, boxY + rH, 'S'); doc.line(L1, boxY + rH * 2, L3, boxY + rH * 2, 'S');
                doc.setFontSize(8);
                drawVerticalText(doc, "受付番号", boxX + 3, boxY + boxH / 2);
                drawVerticalText(doc, "学年", L3 + 3, boxY + boxH / 2);
                drawVerticalText(doc, "所属", L5 + 3, boxY + boxH / 2);
                drawVerticalText(doc, "氏名", L7 + 3, boxY + boxH / 2);
                const bubbleW = 3.2, bubbleH = 5.0;
                for (let row = 0; row < 3; row++) {
                    const cy = boxY + row * rH + rH / 2;
                    for (let col = 0; col < 10; col++) {
                        const cx = L2 + 1.5 + col * 4.2;
                        doc.ellipse(cx + bubbleW / 2, cy, bubbleW / 2, bubbleH / 2, 'S');
                        doc.text(col.toString(), cx + bubbleW / 2, cy, { align: 'center', baseline: 'middle' });
                    }
                }
                doc.save(`answer_sheet_${qCount}q.pdf`);
                showAdminToast("PDFのダウンロードが完了しました！", "success");
            } catch (err) {
                showAdminToast("エラー: " + err.message);
            }
        }

        // ============================
        // TAB 2: 答案読込・管理
        // ============================
        const workCanvas = document.getElementById('work-canvas');
        const workCtx = workCanvas.getContext('2d');
        let scanConfig = null, scanAnswers = [];

        async function loadAnswers() {
            const fileInput = document.getElementById('pdf-file');
            const file = fileInput.files[0];
            if (!file) return;

            scanConfig = await dbGet(`projects/${projectId}/protected/${secretHash}/config`);
            if (!scanConfig) { showAdminToast('座標設定が見つかりません。先に回答用紙を発行してください。'); return; }

            const overlay = document.getElementById('save-overlay');
            const overlayBar = document.getElementById('save-overlay-bar');
            const overlayText = document.getElementById('save-overlay-text');
            const overlayTitle = overlay.querySelector('h2');
            overlay.style.display = 'flex';
            overlayBar.style.width = '0%';
            overlayTitle.textContent = '答案を読み込み中...';

            try {
                const arrayBuffer = await file.arrayBuffer();
                let pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                const total = pdfDoc.numPages; scanAnswers = [];

                for (let i = 1; i <= total; i++) {
                    overlayText.textContent = `${i} / ${total} ページ読込中`;
                    overlayBar.style.width = `${(i / total) * 100}%`;

                    const page = await pdfDoc.getPage(i);
                    const viewport = page.getViewport({ scale: scanConfig.scale || 1.8 });
                    workCanvas.width = viewport.width; workCanvas.height = viewport.height;
                    workCtx.fillStyle = '#ffffff'; workCtx.fillRect(0, 0, workCanvas.width, workCanvas.height);
                    await page.render({ canvasContext: workCtx, viewport }).promise;

                    let detectedResult = detectTombo(scanConfig.tombo);
                    if (!detectedResult.error && detectedResult.markerMap[0] && detectedResult.markerMap[2]) {
                        if (detectedResult.markerMap[0].y > detectedResult.markerMap[2].y) {
                            const tc = document.createElement('canvas'); tc.width = workCanvas.width; tc.height = workCanvas.height;
                            const tctx = tc.getContext('2d'); tctx.translate(tc.width, tc.height); tctx.rotate(Math.PI); tctx.drawImage(workCanvas, 0, 0);
                            workCtx.clearRect(0, 0, workCanvas.width, workCanvas.height); workCtx.drawImage(tc, 0, 0);
                            detectedResult = detectTombo(scanConfig.tombo);
                        }
                    }
                    if (detectedResult.error) {
                        const origData = workCtx.getImageData(0, 0, workCanvas.width, workCanvas.height);
                        for (const angle of [Math.PI, Math.PI / 2, -Math.PI / 2]) {
                            const tc = document.createElement('canvas'); const isR = Math.abs(angle) === Math.PI / 2;
                            tc.width = isR ? workCanvas.height : workCanvas.width; tc.height = isR ? workCanvas.width : workCanvas.height;
                            const tctx = tc.getContext('2d'); tctx.translate(tc.width / 2, tc.height / 2); tctx.rotate(angle);
                            tctx.drawImage(workCanvas, -workCanvas.width / 2, -workCanvas.height / 2);
                            workCanvas.width = tc.width; workCanvas.height = tc.height; workCtx.drawImage(tc, 0, 0);
                            const rr = detectTombo(scanConfig.tombo);
                            if (!rr.error || rr.foundCount > detectedResult.foundCount) detectedResult = rr;
                            if (!detectedResult.error) break;
                            workCanvas.width = origData.width; workCanvas.height = origData.height; workCtx.putImageData(origData, 0, 0);
                        }
                    }

                    const transform = calcPerspectiveTransform(scanConfig.tombo.map(r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })), detectedResult.points);
                    const entryNumber = readEntryNumber(scanConfig.markCells.map(cell => transformRegion(cell, transform)));
                    const cells = [];
                    for (let q = 0; q < (scanConfig.questionCount || 100); q++) {
                        const cr = transformRegion(scanConfig.answerRegions[q], transform);
                        cells.push({ q: q + 1, imageData: cutRegion(cr) });
                    }
                    scanAnswers.push({ page: i, entryNumber, cells, tomboError: detectedResult.error, pageImage: workCanvas.toDataURL('image/webp', 0.5) });
                }

                overlayTitle.textContent = 'サーバーへ保存中...';
                overlayBar.style.width = '0%';
                let current = 0; const totalBatch = scanAnswers.length;

                for (const a of scanAnswers) {
                    let pageImageUrl = null;
                    const cellUrls = {};

                    // Firebase Storage にアップロード
                    if (storage) {
                        try {
                            // ページ全体画像
                            const pageRef = storage.ref(`projects/${projectId}/answers/${a.entryNumber}/pageImage`);
                            const pageSnap = await pageRef.putString(a.pageImage, 'data_url');
                            pageImageUrl = await pageSnap.ref.getDownloadURL();

                            // セル画像（各問題）
                            for (const c of a.cells) {
                                const cellRef = storage.ref(`projects/${projectId}/answers/${a.entryNumber}/cells/q${c.q}`);
                                const cellSnap = await cellRef.putString(c.imageData, 'data_url');
                                cellUrls[`q${c.q}`] = await cellSnap.ref.getDownloadURL();
                            }
                        } catch (e) {
                            console.error('Storage upload error:', e);
                            showAdminToast(`受付番号 ${a.entryNumber}: 画像アップロード失敗 — Firebase Storage を有効にしてください`, 'error');
                            continue; // RTDB への巨大 Base64 書き込みを防止
                        }
                    } else {
                        showAdminToast('Firebase Storage が未設定です。管理者に連絡してください。', 'error');
                        overlay.style.display = 'none';
                        return;
                    }
                    const data = {
                        entryNumber: a.entryNumber,
                        page: a.page,
                        uploadedAt: SERVER_TIMESTAMP,
                        pageImageUrl: pageImageUrl,
                        cellUrls: cellUrls
                    };

                    await dbSet(`projects/${projectId}/protected/${secretHash}/answers/${a.entryNumber}`, data);
                    current++;
                    overlayBar.style.width = `${(current / totalBatch) * 100}%`;
                    overlayText.textContent = `${current} / ${totalBatch} 件保存`;
                }

                overlayText.textContent = '完了しました！';
                setTimeout(() => { overlay.style.display = 'none'; }, 1000);
                showAdminToast(`${scanAnswers.length}件の答案を処理しました`, 'success');
                loadEntryList();
            } catch (e) {
                console.error(e); overlay.style.display = 'none';
                showAdminToast('処理エラー: ' + e.message);
            } finally { fileInput.value = ''; }
        }

        function detectTombo(refTombo) {
            if (typeof AR === 'undefined') return { points: refTombo.map(r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })), error: true, foundCount: 0, markerMap: {} };
            const imageData = workCtx.getImageData(0, 0, workCanvas.width, workCanvas.height);
            const markers = new AR.Detector().detect(imageData);
            const detected = [], markerMap = {}; let error = false, foundCount = 0;
            [0, 1, 2, 3].forEach((id, i) => {
                const m = markers.find(m => m.id === id);
                if (m) { let sx = 0, sy = 0; m.corners.forEach(c => { sx += c.x; sy += c.y }); const pt = { x: sx / 4, y: sy / 4 }; detected.push(pt); markerMap[id] = pt; foundCount++; }
                else { const ref = refTombo[i] || refTombo[0]; detected.push({ x: ref.x + ref.w / 2, y: ref.y + ref.h / 2 }); error = true; }
            });
            return { points: detected, error, foundCount, markerMap };
        }
        function calcPerspectiveTransform(src, dst) {
            if (src.length < 4 || dst.length < 4) return null;
            const A = [], b = [];
            for (let i = 0; i < 4; i++) {
                const sx = src[i].x, sy = src[i].y, dx = dst[i].x, dy = dst[i].y;
                A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]); b.push(dx);
                A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]); b.push(dy);
            }
            const n = 8, M = A.map((row, i) => [...row, b[i]]);
            for (let col = 0; col < n; col++) { let mr = col; for (let r = col + 1; r < n; r++)if (Math.abs(M[r][col]) > Math.abs(M[mr][col])) mr = r;[M[col], M[mr]] = [M[mr], M[col]]; if (M[col][col] === 0) return null; for (let r = col + 1; r < n; r++) { const f = M[r][col] / M[col][col]; for (let j = col; j <= n; j++)M[r][j] -= f * M[col][j]; } }
            const h = new Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { h[i] = M[i][n] / M[i][i]; for (let j = i - 1; j >= 0; j--)M[j][n] -= M[j][i] * h[i]; }
            return { h00: h[0], h01: h[1], h02: h[2], h10: h[3], h11: h[4], h12: h[5], h20: h[6], h21: h[7] };
        }
        function transformPoint(x, y, t) { if (!t) return { x, y }; const d = t.h20 * x + t.h21 * y + 1; return { x: (t.h00 * x + t.h01 * y + t.h02) / d, y: (t.h10 * x + t.h11 * y + t.h12) / d }; }
        function transformRegion(r, t) { const tl = transformPoint(r.x, r.y, t), br = transformPoint(r.x + r.w, r.y + r.h, t); return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y, row: r.row, col: r.col }; }
        function readEntryNumber(markCells) { const rows = [[], [], []]; markCells.forEach(c => { if (c.row === undefined) return; rows[c.row].push({ col: c.col, darkness: getMeanDarkness(c) }); }); return rows.map(r => { if (!r.length) return 0; return [...r].sort((a, b) => b.darkness - a.darkness)[0].col; }).reduce((a, d, i) => a + d * Math.pow(10, 2 - i), 0); }
        function getMeanDarkness(r) { const x = Math.round(Math.max(0, r.x)), y = Math.round(Math.max(0, r.y)), w = Math.max(1, Math.round(Math.min(r.w, workCanvas.width - x))), h = Math.max(1, Math.round(Math.min(r.h, workCanvas.height - y))); const d = workCtx.getImageData(x, y, w, h); let t = 0; for (let i = 0; i < d.data.length; i += 4)t += (255 - (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3); return t / (d.data.length / 4); }
        function cutRegion(r) { const x = Math.round(Math.max(0, r.x)), y = Math.round(Math.max(0, r.y)), w = Math.max(1, Math.round(Math.min(r.w, workCanvas.width - x))), h = Math.max(1, Math.round(Math.min(r.h, workCanvas.height - y))); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(workCanvas, x, y, w, h, 0, 0, w, h); return c.toDataURL('image/webp', 0.7); }



        // 答案一覧
        let entryListData = [];
        async function loadEntryList() {
            const el = document.getElementById('entry-list');
            el.innerHTML = '<div style="color:#aaa">読み込み中...</div>';
            try {
                const data = await dbShallow(`projects/${projectId}/protected/${secretHash}/answers`);
                entryListData = data ? Object.keys(data).map(Number).sort((a, b) => a - b) : [];
            } catch (e) {
                console.error('答案リスト読み込みエラー:', e);
                entryListData = [];
            }
            entryNumbers = [...entryListData]; // 全体のentryNumbersも更新
            let masterData = getMasterData(projectId);

            // カウントバッジ更新
            document.getElementById('entry-count-badge').textContent = `${entryListData.length}件`;

            if (entryListData.length === 0) {
                el.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:40px;font-size:14px"><i class="fa-solid fa-box-open" style="font-size:28px;display:block;margin-bottom:12px;opacity:0.4"></i>保存済み答案はありません</div>';
                document.getElementById('select-all-label').hidden = true;
                document.getElementById('batch-delete-btn').hidden = true;
                return;
            }

            // コントロール表示
            document.getElementById('select-all-label').hidden = false;
            document.getElementById('batch-delete-btn').hidden = false;

            el.innerHTML = '';
            const grid = document.createElement('div');
            grid.className = 'entry-list-grid';
            entryListData.forEach(num => {
                const md = masterData[num] || {};
                const displayName = md.name || `No.${num}`;
                const subText = md.affiliation || '';
                const card = document.createElement('div');
                card.className = 'entry-card';
                card.innerHTML = `
                    <label class="scan-cb">
                        <input type="checkbox" class="entry-cb" data-num="${num}" />
                        <span class="cb-icon"><i class="fa-solid fa-check"></i></span>
                    </label>
                    <div class="entry-info">
                        <div class="entry-name">${displayName}</div>
                        ${subText ? `<div class="entry-sub">${subText}</div>` : ''}
                    </div>
                    <span class="entry-num-badge">#${num}</span>
                `;
                // チェック時のカードハイライト
                        const cb = card.querySelector('.entry-cb');
                cb.addEventListener('change', () => {
                    card.classList.toggle('selected', cb.checked);
                    updateBatchBtn();
                });
                // ダブルクリックでページプレビュー
                card.addEventListener('dblclick', (e) => {
                    if (e.target.closest('.scan-cb')) return; // チェックボックスは除外
                    showEntryPreview(num);
                });
                grid.appendChild(card);
            });
            el.appendChild(grid);
            document.getElementById('batch-delete-btn').disabled = true;
            document.getElementById('select-all-cb').checked = false;
        }

        function updateBatchBtn() {
            const checked = document.querySelectorAll('.entry-cb:checked').length;
            document.getElementById('batch-delete-btn').disabled = checked === 0;
        }
        function toggleSelectAll() {
            const all = document.getElementById('select-all-cb').checked;
            document.querySelectorAll('.entry-cb').forEach(cb => {
                cb.checked = all;
                cb.closest('.entry-card')?.classList.toggle('selected', all);
            });
            updateBatchBtn();
        }
        async function deleteEntry(num, e) {
            e?.stopPropagation();
            if (!(await showConfirm(`受付番号 ${num} の答案を削除しますか？`))) return;
            // Storage の画像も削除
            if (storage) {
                try {
                    const pageRef = storage.ref(`projects/${projectId}/answers/${num}/pageImage`);
                    await pageRef.delete().catch(() => {});
                } catch(e) {}
            }
            await dbRemove(`projects/${projectId}/protected/${secretHash}/answers/${num}`);
            await dbRemove(`projects/${projectId}/protected/${secretHash}/scores/${num}`);
            loadEntryList();
        }
        async function batchDelete() {
            const checked = [...document.querySelectorAll('.entry-cb:checked')].map(cb => cb.dataset.num);
            if (!checked.length) return;
            if (!(await showConfirm(`${checked.length}件の答案を一括削除しますか？`))) return;
            for (const num of checked) {
                await dbRemove(`projects/${projectId}/protected/${secretHash}/answers/${num}`);
                await dbRemove(`projects/${projectId}/protected/${secretHash}/scores/${num}`);
                // Storage cleanup
                if (storage) {
                    try { await storage.ref(`projects/${projectId}/answers/${num}/pageImage`).delete().catch(() => {}); } catch(e) {}
                }
            }
            loadEntryList();
        }

        async function showEntryPreview(num) {
            let overlay = document.getElementById('admin-preview-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'admin-preview-overlay';
                overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);backdrop-filter:blur(10px);z-index:10000;display:none;overflow-y:auto;padding:24px;';
                document.body.appendChild(overlay);
            }
            const masterData = getMasterData(projectId);
            const name = masterData[num]?.name || `No.${num}`;
            overlay.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;"><h2 style="color:white;font-size:18px"><i class="fa-solid fa-file-image"></i> ${name} の解答用紙</h2><button class="btn secondary" onclick="document.getElementById('admin-preview-overlay').style.display='none'">✕ 閉じる</button></div><div id="admin-preview-content" style="text-align:center"><div style="color:#aaa"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中...</div></div>`;
            overlay.style.display = 'block';
            const ansData = await dbGet(`projects/${projectId}/protected/${secretHash}/answers/${num}`);
            const pc = document.getElementById('admin-preview-content');
            const imageUrl = ansData?.pageImageUrl || ansData?.pageImage;
            if (imageUrl) {
                pc.innerHTML = `<img src="${imageUrl}" alt="${name}" style="max-width:100%;max-height:85vh;border-radius:8px;background:white;box-shadow:0 4px 24px rgba(0,0,0,0.5)">`;
            } else {
                pc.innerHTML = '<div style="color:#aaa;padding:40px">ページ画像が保存されていません。答案を再読み込みしてください。</div>';
            }
        }
        document.addEventListener('keydown', e => { if (e.key === 'Escape') { const o = document.getElementById('admin-preview-overlay'); if (o) o.style.display = 'none'; }});

        // ============================
        // TAB 3: 模範解答
        // ============================
        let dragSrcIdx = null;
        function renderModelGrid() {
            const grid = document.getElementById('model-answer-grid'); grid.innerHTML = '';
            modelAnswers.forEach((ans, i) => {
                const item = document.createElement('div'); item.className = 'model-cell';
                item.style.cursor = 'grab';
                item.draggable = true;
                item.dataset.idx = i;
                item.innerHTML = `<div class="q-label"><i class="fa-solid fa-hashtag"></i>${i + 1}</div><div class="q-answer" style="${ans ? '' : 'color:var(--text-muted);font-style:italic'}">${ans || '—'}</div>`;

                // ドラッグ開始
                item.addEventListener('dragstart', e => {
                    dragSrcIdx = i;
                    item.style.opacity = '0.4';
                    e.dataTransfer.effectAllowed = 'move';
                });
                item.addEventListener('dragend', () => { item.style.opacity = '1'; });

                // ドロップ先
                item.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; item.style.borderColor = 'var(--primary)'; });
                item.addEventListener('dragleave', () => { item.style.borderColor = ''; });
                item.addEventListener('drop', async e => {
                    e.preventDefault();
                    item.style.borderColor = '';
                    if (dragSrcIdx === null || dragSrcIdx === i) return;
                    // 配列内の要素を移動
                    const moved = modelAnswers.splice(dragSrcIdx, 1)[0];
                    modelAnswers.splice(i, 0, moved);
                    dragSrcIdx = null;
                    renderModelGrid();
                    await saveModelAnswers();
                    showAdminToast('並び替えを保存しました', 'success');
                });

                // クリックで編集
                item.addEventListener('click', () => {
                    if (item.querySelector('input')) return;
                    const ansDiv = item.querySelector('.q-answer');
                    const current = modelAnswers[i] || '';
                    ansDiv.innerHTML = `<input type="text" value="${current}" style="width:100%;padding:4px 6px;font-size:16px;font-weight:800;text-align:center;border:2px solid var(--primary);border-radius:6px;background:rgba(0,0,0,0.3);color:white;outline:none;" />`;
                    const input = ansDiv.querySelector('input');
                    item.draggable = false; // 編集中はドラッグ無効
                    input.focus();
                    input.select();
                    const save = async () => {
                        const newVal = input.value.trim();
                        modelAnswers[i] = newVal;
                        ansDiv.style = newVal ? '' : 'color:var(--text-muted);font-style:italic';
                        ansDiv.textContent = newVal || '—';
                        item.draggable = true;
                        await saveModelAnswers();
                    };
                    input.addEventListener('blur', save);
                    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') { ansDiv.textContent = current || '—'; item.draggable = true; } });
                });
                grid.appendChild(item);
            });
        }
        function loadCSV() {
            const file = document.getElementById('csv-file').files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async e => {
                const lines = e.target.result.split('\n').filter(l => l.trim());
                modelAnswers = new Array(totalQuestions).fill('');
                lines.forEach((line, idx) => {
                    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
                    if (cols.length >= 2 && !isNaN(parseInt(cols[0]))) { const q = parseInt(cols[0]); if (q >= 1 && q <= totalQuestions) modelAnswers[q - 1] = cols[1]; }
                    else if (idx < totalQuestions) modelAnswers[idx] = cols[0];
                });
                renderModelGrid();
                showAdminToast(`${lines.length}件読み込み中...`);
                await saveModelAnswers();
                showAdminToast(`${lines.length}件の模範解答を保存しました`, 'success');
            };
            reader.readAsText(file, 'UTF-8');
        }
        async function saveModelAnswers() {
            const data = {};
            modelAnswers.forEach((ans, idx) => { if (ans) data[idx + 1] = ans; });
            try {
                await dbSet(`projects/${projectId}/protected/${secretHash}/answers_text`, data);
            } catch(e) {
                showAdminToast('保存に失敗: ' + e.message);
            }
        }

        // ============================
        // TAB 4: 集計・設定
        // ============================
        function updateStatsView() {
            let confirmedCount = 0, doneCount = 0, conflictCount = 0, inprogressCount = 0, untouchedCount = 0, allConfirmed = true;
            for (let q = 1; q <= totalQuestions; q++) {
                const cs = Object.keys(scoresData[`__completed__q${q}`] || {}); 
                const allDone = cs.length >= 3; 
                let hasConflict = false, allResolved = true;
                
                if (allDone) { 
                    entryNumbers.forEach(en => { 
                        const qs = scoresData[en]?.[`q${q}`] || {}; 
                        const v = Object.values(qs); 
                        const co = v.filter(x => x === 'correct').length, 
                              wr = v.filter(x => x === 'wrong').length; 
                        if (co !== 3 && wr !== 3) { 
                            hasConflict = true; 
                            if (!scoresData[`__final__q${q}`]?.[en]) allResolved = false; 
                        } 
                    }); 
                }
                
                const fc = allDone && (!hasConflict || allResolved); 
                
                if (fc) { 
                    confirmedCount++; 
                } else if (hasConflict) { 
                    conflictCount++; allConfirmed = false; 
                } else if (allDone) { 
                    doneCount++; allConfirmed = false; 
                } else if (cs.length > 0) { 
                    inprogressCount++; allConfirmed = false; 
                } else { 
                    untouchedCount++; allConfirmed = false; 
                }
            }
            // 表示上は confirmedCount と doneCount をマージして「完了」とする
            const visualDoneCount = confirmedCount + doneCount;
            document.getElementById('stat-done').textContent = visualDoneCount; 
            document.getElementById('stat-conflict').textContent = conflictCount; 
            
            // Progress bar
            const bar = document.getElementById('stats-bar');
            const t = totalQuestions || 1;
            const pct = (n) => ((n / t) * 100).toFixed(1) + '%';
            bar.innerHTML = '';
            const segs = [
                { cls: 'confirmed', count: visualDoneCount, label: `${visualDoneCount}` },
                { cls: 'conflict', count: conflictCount, label: `${conflictCount}` },
                { cls: 'inprogress', count: inprogressCount, label: `${inprogressCount}` },
                { cls: 'untouched', count: untouchedCount, label: `${untouchedCount}` },
            ];
            segs.forEach(s => {
                if (s.count === 0) return;
                const seg = document.createElement('div');
                seg.className = `stats-bar-seg ${s.cls}`;
                seg.style.width = pct(s.count);
                if (s.count / t >= 0.08) seg.textContent = s.label;
                bar.appendChild(seg);
            });
            
            const csvS = document.getElementById('csv-status'), csvB = document.getElementById('csv-btn');
            // CSV出力の可否は表示用の完了カウントではなく、真の全問確定（allConfirmed）で判定
            if (allConfirmed && totalQuestions > 0) { 
                csvS.textContent = '全問確定済み。CSV出力できます。'; 
                csvS.className = 'csv-status ready'; 
                csvB.disabled = false; 
            } else { 
                csvS.textContent = `未確定の問題があります（確定済み: ${confirmedCount}/${totalQuestions}）`; 
                csvS.className = 'csv-status notready'; 
                csvB.disabled = true; 
            }
            renderAnalytics();
            generateDisclosure();
        }


        // ============================
        // CSV出力（仕様変更: 列順=所属,学年,氏名 / 点数・連答は非出力）
        // ============================
        async function exportCSV() {
            const entriesData = await dbGet(`projects/${projectId}/entries`);
            let masterData = {};
            if (entriesData) {
                const privJwkStr = session.get('privateKeyJwk');
                let privJwk = null;
                if (privJwkStr) { try { privJwk = JSON.parse(privJwkStr); } catch(e){} }

                for (const v of Object.values(entriesData)) {
                    if (!v.entryNumber) continue;
                    let name = '', affiliation = '', grade = '';
                    if (v.encryptedPII && privJwk) {
                        try {
                            const jsonStr = await AppCrypto.decryptRSA(v.encryptedPII, privJwk);
                            const pii = JSON.parse(jsonStr);
                            name = `${pii.familyName} ${pii.firstName}`;
                            affiliation = pii.affiliation || '';
                            grade = pii.grade || '';
                        } catch(e) {}
                    } else {
                        name = v.familyName ? `${v.familyName} ${v.firstName}` : '';
                        affiliation = v.affiliation || '';
                        grade = v.grade || '';
                    }
                    masterData[v.entryNumber] = { name, affiliation, grade };
                }
            }

            const results = entryNumbers.map(en => {
                const answers = []; for (let q = 1; q <= totalQuestions; q++) { const fd = scoresData[`__final__q${q}`] || {}; const r = fd[en] === 'correct' ? 1 : 0; answers.push(r); }
                const score = answers.reduce((a, b) => a + b, 0);
                // 連答計算（ソート用のみ使用、CSVには出力しない）
                const streaks = []; let cur = 0; answers.forEach(a => { if (a === 1) cur++; else { if (cur > 0) streaks.push(cur); cur = 0; } }); if (cur > 0) streaks.push(cur);
                const m = masterData[en] || {}; return { entryNumber: en, name: m.name || '', affiliation: m.affiliation || '', grade: m.grade || '', score, answers, streaks };
            });

            // ソート: 点数降順 → 連答降順
            results.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                for (let i = 0; i < totalQuestions; i++) { const d = b.answers[i] - a.answers[i]; if (d !== 0) return d; }
                return 0;
            });

            // ヘッダー: 所属, 学年, 氏名 のみ（点数・連答は非出力）
            const headers = ['所属', '学年', '氏名'];
            const rows = [headers];
            results.forEach(r => {
                rows.push([r.affiliation, r.grade, r.name]);
            });
            const csv = rows.map(r => r.join(',')).join('\n'); const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ciq_result.csv'; a.click();
        }

        async function getAnalyticsData() {
            const threshold = parseInt(document.getElementById('analytics-threshold').value) || 5;
            const masterData = getMasterData(projectId);
            const tp = entryNumbers.length || 1, qStats = [];
            for (let q = 1; q <= totalQuestions; q++) {
                const fd = scoresData[`__final__q${q}`] || {};
                // __final__ が空 = まだ確定していない → 未確定として扱う
                const hasFinal = Object.keys(fd).length > 0;
                if (!hasFinal) {
                    qStats.push({ q, correctCount: '-', rate: '-', type: '未確定', names: '', isRare: false });
                    continue;
                }
                let cc = 0, ce = [];
                entryNumbers.forEach(en => {
                    if (fd[en] === 'correct') { cc++; ce.push(en); }
                });
                const rate = Math.round((cc / tp) * 100);
                const names = ce.map(e => { const m = masterData[e] || {}; return m.name ? `${m.affiliation || ''} ${m.name}`.trim() : `番号${e}`; }).join(' / ');
                let type = ''; if (cc === 0) type = '全滅'; else if (cc === 1) type = '単独正解'; else if (cc <= threshold) type = '少数正解';
                qStats.push({ q, correctCount: cc, rate, type, names, isRare: cc <= threshold && cc > 0 });
            } return qStats;
        }
        async function renderAnalytics() {
            const tbody = document.getElementById('analytics-tbody'); if (!entryNumbers.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:12px">データがありません</td></tr>'; return; }
            const qs = await getAnalyticsData();
            tbody.innerHTML = qs.map(s => `<tr style="${s.isRare ? 'background:rgba(255,152,0,0.2);font-weight:bold' : ''}"><td >${s.q}</td><td >${s.correctCount}人</td><td >${s.rate}%</td><td >${s.type}</td><td >${s.names}</td></tr>`).join('');
        }
        async function exportAnalyticsCSV() {
            const qs = await getAnalyticsData(); const headers = ['問題番号', '正答数', '正答率(%)', '状態', '正解者一覧']; const rows = [headers];
            qs.forEach(s => rows.push([s.q, s.correctCount, s.rate, s.type, `"${s.names.replace(/"/g, '""')}"`]));
            const csv = rows.map(r => r.join(',')).join('\n'); const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'analytics_all_qs.csv'; a.click();
        }

        async function openDeleteModal() {
            const confirmed = await showConfirm(
                `プロジェクトを完全に削除しますか？\n\nこの操作は元に戻せません。\nプロジェクトID: ${projectId}`,
                '削除する'
            );
            if (!confirmed) return;
            try {
                // Storage の画像も全削除
                if (storage) {
                    try {
                        const listResult = await storage.ref(`projects/${projectId}`).listAll();
                        for (const item of listResult.items) { await item.delete().catch(() => {}); }
                        for (const prefix of listResult.prefixes) {
                            const sub = await prefix.listAll();
                            for (const item of sub.items) { await item.delete().catch(() => {}); }
                        }
                    } catch(e) {}
                }
                await dbRemove(`projects/${projectId}`);
                showAdminToast('プロジェクトが削除されました。', 'success');
                setTimeout(() => { session.clear(); location.href = 'index.html'; }, 1500);
            } catch(e) {
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
        // 設定更新処理
        // ============================

        async function updateProjectName() {
            const name = document.getElementById('setting-project-name').value.trim();
            if(!name) return showAdminToast('プロジェクト名を入力してください');
            await dbSet(`projects/${projectId}/publicSettings/projectName`, name);
            showAdminToast('プロジェクト名を更新しました', 'success');
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
            tbody.innerHTML = '<tr><td colspan="7" style="padding:12px;text-align:center">読み込み中...</td></tr>';

            try {
                const entriesData = await dbGet(`projects/${projectId}/entries`);
                if (!entriesData) {
                    tbody.innerHTML = '<tr><td colspan="7" style="padding:12px;text-align:center">名簿データがありません。</td></tr>';
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
                    <td >${v.entryNumber || '-'}</td>
                    <td >${pii.familyName || '-'} ${pii.firstName || '-'}<br><span style="font-size:11px;color:#aaa">${pii.familyNameKana || ''} ${pii.firstNameKana || ''}</span></td>
                    <td >${pii.entryName || ''}</td>
                    <td >${pii.affiliation || ''}</td>
                    <td >${pii.grade || ''}</td>
                    <td ><span style="font-size:11px;color:#aaa">${pii.email || ''}</span><br>${pii.inquiry || '-'}</td>
                    <td >${statText}</td>
                `;
                    tbody.appendChild(tr);
                }
            } catch (e) {
                tbody.innerHTML = '<tr><td colspan="7" style="padding:12px;text-align:center;color:#ef5350">読み込みに失敗しました: ' + e.message + '</td></tr>';
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