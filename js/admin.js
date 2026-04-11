
window.addEventListener('unhandledrejection', function(event) {
    if (event.reason && event.reason.message && event.reason.message.includes('PERMISSION_DENIED')) {
        event.preventDefault(); // hide from console
        document.body.innerHTML = ''; // wipe loading
        showDbAuthError();
    }
});

function showDbAuthError() {
    const div = document.createElement('div');
    div.className = 'error-overlay';
    div.innerHTML = `
        <div class="error-dialog">
            <h2><i class="fa-solid fa-triangle-exclamation"></i> データベース通信拒否</h2>
            <p>データベースへの接続が拒否されました。<br><br><br>運営者にお問い合わせください。</p>
            <button class="btn danger" onclick="location.href='index.html'">ログイン画面へ戻る</button>
        </div>
    `;
    document.body.appendChild(div);
}
        function showAdminToast(msg, type = 'error') {
            const t = document.getElementById('admin-toast');
            if(!t) return;
            t.innerHTML = msg;
            t.style.background = type === 'error' ? '#ef5350' : '#4caf50';
            t.style.display = 'block';
            setTimeout(() => t.style.display = 'none', 3000);
        }

        // ============================
        // 共通初期化
        // ============================
        const projectId = session.projectId;
        const secretHash = session.get("secretHash");
        const scorerRole = session.scorerRole;
        if (!projectId || scorerRole !== 'admin') { showAdminToast('管理者としてプロジェクトに入室してください'); setTimeout(() => location.href = 'index.html', 1500); }

        document.getElementById('project-id-display').innerHTML = `<i class="fa-solid fa-copy"></i> ${projectId}`;

        let totalQuestions = 100;
        let scoresData = {};
        let entryNumbers = [];
        let modelAnswers = [];

        // タブ切り替え
        function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            const btns = document.querySelectorAll('.tab-btn');
            const tabs = ['tab-entries', 'tab-sheet', 'tab-scan', 'tab-model', 'tab-stats', 'tab-settings'];
            btns[tabs.indexOf(tabId)]?.classList.add('active');
        }

        async function init() {
            // ハッシュによるタブ指定
            const hash = location.hash.replace('#', '');
            if (hash && document.getElementById(hash)) {
                switchTab(hash);
            }

            // プロジェクトアクセス日時更新とデータクリーンアップ
            db.ref(`projects/${projectId}/lastAccess`).set(firebase.database.ServerValue.TIMESTAMP);
            purgeOldImages();

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

            const configSnap = await db.ref(`projects/${projectId}/protected/${secretHash}/config`).once('value');
            if (configSnap.exists()) {
                const cfg = configSnap.val();
                totalQuestions = cfg.questionCount || 100;
                document.getElementById('question-count').value = totalQuestions;
            }

            const entryConfigSnap = await db.ref(`projects/${projectId}/protected/${secretHash}/entryConfig`).once('value');
            if (entryConfigSnap.exists()) {
                const ec = entryConfigSnap.val();
                document.getElementById('entry-list-toggle').checked = !!ec.listEnabled;
            }
            // 開示は常に有効
            await db.ref(`projects/${projectId}/protected/${secretHash}/entryConfig/disclosureEnabled`).set(true);

            // 集計用: 問題セル初期化
            const po = document.getElementById('progress-overview');
            po.innerHTML = '';
            for (let i = 1; i <= totalQuestions; i++) {
                const cell = document.createElement('div');
                cell.className = 'po-cell'; cell.id = `po-${i}`; cell.textContent = i;
                po.appendChild(cell);
            }
            document.getElementById('stat-total').textContent = totalQuestions;

            // エントリ番号取得
            try {
                const res = await fetch(`https://ciq-saiten-default-rtdb.asia-southeast1.firebasedatabase.app/projects/${projectId}/answers.json?shallow=true`);
                const data = await res.json();
                if (data) entryNumbers = Object.keys(data).map(Number).sort((a, b) => a - b);
            } catch (e) {
                const snap = await db.ref(`projects/${projectId}/protected/${secretHash}/answers`).get();
                if (snap.exists()) entryNumbers = Object.keys(snap.val()).map(Number).sort((a, b) => a - b);
            }

            // スコアリアルタイム
            db.ref(`projects/${projectId}/protected/${secretHash}/scores`).on('value', snap => {
                scoresData = snap.val() || {};
                updateStatsView();
            });

            // 模範解答読み込み
            const modelSnap = await db.ref(`projects/${projectId}/protected/${secretHash}/answers_text`).get();
            modelAnswers = new Array(totalQuestions).fill('');
            if (modelSnap.exists()) {
                const d = modelSnap.val();
                Object.keys(d).forEach(q => { modelAnswers[q - 1] = d[q]; });
            }
            renderModelGrid();
        }

        // ============================
        // TAB 1: 回答用紙
        // ============================
        const marker_b64 = [
            "data:image/png;base64,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",
            "data:image/png;base64,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",
            "data:image/png;base64,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",
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAfQAAAH0CAAAAADuvYBWAAAJBklEQVR4Ae3BgQ3AMAzDMOn/o7MnHKBYTEqdI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50idI3WO1DlS50jIECG1TkKGCKl1EjJESK2TkCFCap2EDBFS6yRkiJBaJyFDhNQ6CRkipNZJyBAhtU5ChgipdRIyREitk5AhQmqdhAwRUuskZIiQWichQ4TUOgkZIqTWScgQIbVOQoYIqXUSMkRIrZOQIUJqnYQMEVLrJGSIkFonIUOE1DoJGSKk1knIECG1TkKGCKl1EjJESK2TkCFCap2EDBFS6yRkiJBaJyFDhNQ6CRkipNZJyBAhtU5ChgipdRIyREitk5AhQmqdhAwRUuskZIiQWichQ4TUOgkZIqTWScgQIbVOQoYIqXUSMkRIrZOQIUJqnYQMEVLrJGSIkFonIUOE1DoJGSKk1knIECG1TkKGCKl1EjJESK2TkCFCap2EDBFS6yRkiJBaJyFDhNQ6CRkipNZJyBAhtU5ChgipdRIyREitk5AhQmqdhAwRUuskZIiQWichQ4TUOgkZIqTWScgQIbVOQoYIqXUSMkRIrZOQIUJqnYQMEVLrJGSIkFonIUOE1DoJGSKk1knIECG1TkKGCKl1EjJESK2TkCFCap2EDBFS6yRkiJBaJyFDhNQ6CRkipNZJyBAhtU5ChgipdRIyREitk5AhQmqdhAwRUuskZIiQWichQ4TUOgkZIqTWScgQIbVOQoYIqXUSMkRIrZOQIUJqnYQMEVLrJGSIkFonIUOE1DoJGSKk1knIECG1TkKGCKl1EjJESK2TkCFCap2EDBFS6yRkiJBaJyFDhNQ6CRkipNZJyBAhtU5ChgipdRIyREitk5AhQmqdhAwRUuskZIiQWichQ4TUOgkZIqTWScgQIbVOQoYIqXUSMkRIrZOQIUJqnYQMEVLrJGSIkFonIUOE1DoJGSKk1knIECG1TkKGCKl1EjJESK2TkCFCap2EDBFS6yRkiJBaJyFDhNQ6CRkipNZJyBAhtU5ChgipdRIyREitk5AhQmqdhAwRUuskZIiQWichQ4TUOgkZIqTWScgQIbVOQoYIqXUSMkRIrZOQIUJqnYQMEVLrJGSIkFonIUOE1DoJGSKk1knIECG1TkKGCKl1EjJESK2TkCFCap2EDBFS6yRkiJBaJyFDhNQ6CRkipNZJyBAhtU5ChgipdRIyREitk5AhQmqdhAwRUuskZIiQWichQ4TUOgkZIqTWScgQIbVOQoYIqXUSMkRIrZOQIUJqnYQMEVLrJGSIkFonIUOE1DoJGSKk1knIECG1TkKGCKl1EjJESK2TkCFCap2EDBFS6yRkiJBaJyFDhNQ6CRkipNZJyBAhtU5ChgipdRIyREitk5AhQmqdhAwRUuskZIiQWichQ4TUOgkZIqTWScgQIbVOQoYIqXUSMkRIrZOQIUJqnYQMEVLrJGSIkFonbxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4ibxl+SV4idY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnSJ0jdY7UOVLnfH+DZwTWPaogAAAAAElFTkSuQmCC"
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
                await db.ref(`projects/${projectId}/protected/${secretHash}/config`).set(config);
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
                const fontRes = await fetch("fonts/BIZUDGothic-Regular.ttf");
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
            const file = document.getElementById('pdf-file').files[0];
            if (!file) { showAdminToast('PDFを選択してください'); return; }
            const snap = await db.ref(`projects/${projectId}/protected/${secretHash}/config`).get();
            if (!snap.exists()) { showAdminToast('座標設定が見つかりません。先に回答用紙を発行してください。'); return; }
            scanConfig = snap.val();
            const arrayBuffer = await file.arrayBuffer();
            let pdfDoc;
            try { pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise; }
            catch (e) { showAdminToast('PDFの読み込みに失敗: ' + e.message); return; }
            const total = pdfDoc.numPages; scanAnswers = [];
            document.getElementById('status-text').textContent = `0 / ${total} ページ処理中...`;
            document.getElementById('progress-bar').style.width = '0%';
            for (let pageNum = 1; pageNum <= total; pageNum++) {
                const page = await pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({ scale: scanConfig.scale || 1.5 });
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
                        const tc = document.createElement('canvas');
                        const isR = Math.abs(angle) === Math.PI / 2;
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
                const refCenterPoints = scanConfig.tombo.map(r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }));
                const transform = calcPerspectiveTransform(refCenterPoints, detectedResult.points);
                const correctedMarkCells = scanConfig.markCells.map(cell => transformRegion(cell, transform));
                const entryNumber = readEntryNumber(correctedMarkCells);
                const cells = []; const qTotal = scanConfig.questionCount || 100;
                for (let q = 0; q < qTotal; q++) {
                    const cr = transformRegion(scanConfig.answerRegions[q], transform);
                    cells.push({ q: q + 1, imageData: cutRegion(cr) });
                }
                scanAnswers.push({ page: pageNum, entryNumber, cells, tomboError: detectedResult.error, pageImage: workCanvas.toDataURL('image/jpeg', 0.5) });
                document.getElementById('progress-bar').style.width = Math.round((pageNum / total) * 100) + '%';
                document.getElementById('status-text').textContent = `${pageNum} / ${total} ページ処理中...`;
            }
            document.getElementById('status-text').textContent = `完了: ${total}ページ処理しました`;
            showScanResults();
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
        function cutRegion(r) { const x = Math.round(Math.max(0, r.x)), y = Math.round(Math.max(0, r.y)), w = Math.max(1, Math.round(Math.min(r.w, workCanvas.width - x))), h = Math.max(1, Math.round(Math.min(r.h, workCanvas.height - y))); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(workCanvas, x, y, w, h, 0, 0, w, h); return c.toDataURL('image/jpeg', 0.7); }

        function showScanResults() {
            document.getElementById('result-section').style.display = 'block';
            const list = document.getElementById('answer-list'); list.innerHTML = '';
            let ok = 0, err = 0, warn = 0;
            scanAnswers.forEach(a => {
                const valid = a.entryNumber >= 1 && a.entryNumber <= 999;
                if (valid && !a.tomboError) ok++; else if (!valid) err++; else warn++;
                const item = document.createElement('div'); item.className = 'answer-item';
                if (!valid || a.tomboError) item.style.background = a.tomboError ? '#3a2b00' : '#3a1b1b';
                item.innerHTML = `<img src="${a.cells[0]?.imageData}" alt="1問目"/><span>P${a.page}</span><span>受付番号: <strong>${a.entryNumber}</strong></span>${a.tomboError ? '<span style="font-size:11px;color:#ff9800"><i class="fa-solid fa-triangle-exclamation"></i> トンボ検出失敗</span>' : ''}<span class="badge ${valid ? (a.tomboError ? 'warn' : 'ok') : 'error'}">${valid ? 'OK' : 'エラー'}</span>`;
                list.appendChild(item);
            });
            let txt = `${ok}件OK / ${warn}件警告 / ${err}件エラー`;
            if (warn > 0 || err > 0) txt += '  <i class="fa-solid fa-triangle-exclamation"></i> エラーのあるページは再スキャンを推奨';
            document.getElementById('result-summary').textContent = txt;
            if (err === 0) document.getElementById('save-btn').disabled = false;
        }

        async function saveToFirebase() {
            document.getElementById('save-btn').disabled = true;
            let current = 0;
            const total = scanAnswers.length;
            document.getElementById('status-text').textContent = '保存中...';
            
            const overlay = document.getElementById('save-overlay');
            const overlayBar = document.getElementById('save-overlay-bar');
            const overlayText = document.getElementById('save-overlay-text');
            overlay.style.display = 'flex';
            overlayBar.style.width = '0%';
            overlayText.textContent = `0 / ${total} 件`;

            for (const a of scanAnswers) {
                const data = {
                    entryNumber: a.entryNumber, page: a.page, pageImage: a.pageImage,
                    uploadedAt: firebase.database.ServerValue.TIMESTAMP,
                    cells: a.cells.reduce((o, c) => { o[`q${c.q}`] = c.imageData; return o; }, {})
                };
                await db.ref(`projects/${projectId}/protected/${secretHash}/answers/${a.entryNumber}`).set(data);
                current++;
                overlayBar.style.width = `${(current / total) * 100}%`;
                overlayText.textContent = `${current} / ${total} 件`;
            }

            document.getElementById('status-text').textContent = '保存完了しました';
            overlayText.textContent = '保存完了！';
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 800);
            document.getElementById('save-btn').disabled = false;
            loadEntryList();
        }

        // 答案一覧
        let entryListData = [];
        async function loadEntryList() {
            const el = document.getElementById('entry-list');
            el.innerHTML = '<div style="color:#aaa">読み込み中...</div>';
            try {
                const res = await fetch(`https://ciq-saiten-default-rtdb.asia-southeast1.firebasedatabase.app/projects/${projectId}/answers.json?shallow=true`);
                const data = await res.json();
                entryListData = data ? Object.keys(data).map(Number).sort((a, b) => a - b) : [];
            } catch (e) {
                const snap = await db.ref(`projects/${projectId}/protected/${secretHash}/answers`).get();
                entryListData = snap.exists() ? Object.keys(snap.val()).map(Number).sort((a, b) => a - b) : [];
            }
            entryNumbers = [...entryListData]; // 全体のentryNumbersも更新
            let masterData = {};
            try { masterData = JSON.parse(localStorage.getItem('masterData') || '{}'); } catch (e) { }
            if (entryListData.length === 0) { el.innerHTML = '<div style="color:#aaa">保存済み答案はありません</div>'; return; }
            el.innerHTML = '';
            entryListData.forEach(num => {
                const md = masterData[num] || {};
                const displayName = md.name || `No.${num}`;
                const subInfo = md.name ? `No.${num}${md.affiliation ? ' / ' + md.affiliation : ''}` : '';
                const item = document.createElement('div'); item.className = 'entry-list-item';
                item.innerHTML = `<input type="checkbox" class="entry-cb" data-num="${num}"><span style="font-weight:bold;min-width:80px">${displayName}</span><span style="color:#aaa;font-size:13px">${subInfo}</span><button class="btn danger" style="margin-left:auto;padding:4px 10px;font-size:12px" onclick="deleteEntry(${num},event)">削除</button>`;
                el.appendChild(item);
            });
            document.getElementById('batch-delete-btn').disabled = true;
            document.getElementById('select-all-cb').checked = false;
            document.querySelectorAll('.entry-cb').forEach(cb => cb.addEventListener('change', updateBatchBtn));
        }

        function updateBatchBtn() {
            const checked = document.querySelectorAll('.entry-cb:checked').length;
            document.getElementById('batch-delete-btn').disabled = checked === 0;
        }
        function toggleSelectAll() {
            const all = document.getElementById('select-all-cb').checked;
            document.querySelectorAll('.entry-cb').forEach(cb => cb.checked = all);
            updateBatchBtn();
        }
        async function deleteEntry(num, e) {
            e?.stopPropagation();
            if (!confirm(`受付番号 ${num} の答案を削除しますか？`)) return;
            await db.ref(`projects/${projectId}/protected/${secretHash}/answers/${num}`).remove();
            await db.ref(`projects/${projectId}/protected/${secretHash}/scores/${num}`).remove();
            loadEntryList();
        }
        async function batchDelete() {
            const checked = [...document.querySelectorAll('.entry-cb:checked')].map(cb => cb.dataset.num);
            if (!checked.length) return;
            if (!confirm(`${checked.length}件の答案を削除しますか？`)) return;
            const updates = {};
            checked.forEach(num => { updates[`projects/${projectId}/protected/${secretHash}/answers/${num}`] = null; updates[`projects/${projectId}/protected/${secretHash}/scores/${num}`] = null; });
            await db.ref('/').update(updates);
            loadEntryList();
        }

        // ============================
        // TAB 3: 模範解答
        // ============================
        function renderModelGrid() {
            const grid = document.getElementById('model-answer-grid'); grid.innerHTML = '';
            modelAnswers.forEach((ans, i) => {
                const item = document.createElement('div'); item.className = 'model-cell';
                item.innerHTML = `<div class="q-label"><i class="fa-solid fa-hashtag"></i>${i + 1}</div><div class="q-answer" style="${ans ? '' : 'color:var(--text-muted);font-style:italic'}">${ans || '—'}</div>`;
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
                document.getElementById('model-status').textContent = `${lines.length}件読み込み・保存中...`; document.getElementById('model-status').style.display = 'block';
                await saveModelAnswers();
                document.getElementById('model-status').textContent = `${lines.length}件保存しました`;
                setTimeout(() => document.getElementById('model-status').style.display = 'none', 3000);
            };
            reader.readAsText(file, 'UTF-8');
        }
        async function saveModelAnswers() {
            const data = {};
            modelAnswers.forEach((ans, idx) => { if (ans) data[idx + 1] = ans; });
            try {
                await db.ref(`projects/${projectId}/protected/${secretHash}/answers_text`).set(data);
            } catch(e) {
                showAdminToast('保存に失敗: ' + e.message);
            }
        }

        // ============================
        // TAB 4: 集計・設定
        // ============================
        function updateStatsView() {
            let doneCount = 0, conflictCount = 0, confirmedCount = 0, allConfirmed = true;
            for (let q = 1; q <= totalQuestions; q++) {
                const cs = Object.keys(scoresData[`__completed__q${q}`] || {}); const allDone = cs.length >= 3; let hasConflict = false, allResolved = true;
                if (allDone) { entryNumbers.forEach(en => { const qs = scoresData[en]?.[`q${q}`] || {}; const v = Object.values(qs); const co = v.filter(x => x === 'correct').length, wr = v.filter(x => x === 'wrong').length, ho = v.filter(x => x === 'hold').length; if ((co > 0 && wr > 0) || ho > 0) { hasConflict = true; if (!scoresData[`__final__q${q}`]?.[en]) allResolved = false; } }); }
                const fc = allDone && (!hasConflict || allResolved); const cell = document.getElementById(`po-${q}`); cell.className = 'po-cell';
                if (fc) { cell.classList.add('confirmed'); confirmedCount++; } else if (hasConflict) { cell.classList.add('conflict'); conflictCount++; allConfirmed = false; }
                else if (allDone) { cell.classList.add('done'); doneCount++; allConfirmed = false; } else if (cs.length > 0) { cell.classList.add('inprogress'); allConfirmed = false; } else { allConfirmed = false; }
            }
            document.getElementById('stat-done').textContent = doneCount + confirmedCount; document.getElementById('stat-conflict').textContent = conflictCount; document.getElementById('stat-confirmed').textContent = confirmedCount;
            const csvS = document.getElementById('csv-status'), csvB = document.getElementById('csv-btn');
            if (allConfirmed && confirmedCount === totalQuestions) { csvS.textContent = '全問確定済み。CSV出力できます。'; csvS.className = 'csv-status ready'; csvB.disabled = false; }
            else { csvS.textContent = `未確定の問題があります（確定済み: ${confirmedCount}/${totalQuestions}）`; csvS.className = 'csv-status notready'; csvB.disabled = true; }
            renderAnalytics();
            
            // 開示データは常に自動連携
            generateDisclosure();
        }

        async function exportCSV() {
            const snap = await db.ref(`projects/${projectId}/entries`).get();
            let masterData = {};
            if (snap.exists()) {
                snap.forEach(c => { const v = c.val(); masterData[v.entryNumber] = { name: `${v.familyName} ${v.firstName}`, affiliation: v.affiliation, grade: v.grade }; });
            }
            const results = entryNumbers.map(en => {
                const answers = []; for (let q = 1; q <= totalQuestions; q++) { const fd = scoresData[`__final__q${q}`] || {}; const qs = scoresData[en]?.[`q${q}`] || {}; let r; if (fd[en]) r = fd[en] === 'correct' ? 1 : 0; else { const v = Object.values(qs); r = v.filter(x => x === 'correct').length >= 2 ? 1 : 0; } answers.push(r); }
                const score = answers.reduce((a, b) => a + b, 0); const streaks = []; let cur = 0; answers.forEach(a => { if (a === 1) cur++; else { if (cur > 0) streaks.push(cur); cur = 0; } }); if (cur > 0) streaks.push(cur);
                const m = masterData[en] || {}; return { entryNumber: en, name: m.name || '', affiliation: m.affiliation || '', grade: m.grade || '', score, answers, streaks };
            });
            results.sort((a, b) => { if (b.score !== a.score) return b.score - a.score; for (let i = 0; i < totalQuestions; i++) { const d = b.answers[i] - a.answers[i]; if (d !== 0) return d; } return 0; });
            const ms = Math.max(...results.map(r => r.streaks.length), 0); const headers = ['順位', '氏名', '所属', '学年', '点数']; for (let i = 1; i <= ms; i++)headers.push(`第${i}連答`);
            const rows = [headers]; let rank = 1;
            results.forEach((r, idx) => {
                if (idx > 0) { const p = results[idx - 1]; if (p.score !== r.score) rank = idx + 1; else { let d = false; for (let i = 0; i < totalQuestions; i++)if (p.answers[i] !== r.answers[i]) { d = true; break; } if (d) rank = idx + 1; } }
                const row = [rank, r.name, r.affiliation, r.grade, r.score]; for (let i = 0; i < ms; i++)row.push(r.streaks[i] || 0); rows.push(row);
            });
            const csv = rows.map(r => r.join(',')).join('\n'); const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ciq_result.csv'; a.click();
        }

        async function getAnalyticsData() {
            const threshold = parseInt(document.getElementById('analytics-threshold').value) || 5;
            let masterData = {}; try { masterData = JSON.parse(localStorage.getItem('masterData') || '{}'); } catch (e) { }
            const tp = entryNumbers.length || 1, qStats = [];
            for (let q = 1; q <= totalQuestions; q++) {
                let cc = 0, ce = []; entryNumbers.forEach(en => { const fd = scoresData[`__final__q${q}`] || {}; const qs = scoresData[en]?.[`q${q}`] || {}; let r; if (fd[en]) r = fd[en] === 'correct' ? 1 : 0; else { r = Object.values(qs).filter(v => v === 'correct').length >= 2 ? 1 : 0; } if (r === 1) { cc++; ce.push(en); } });
                const rate = Math.round((cc / tp) * 100); const names = ce.map(e => { const m = masterData[e] || {}; return m.name ? `${m.affiliation || ''} ${m.name}`.trim() : `番号${e}`; }).join(' / ');
                let type = ''; if (cc === 0) type = '全滅'; else if (cc === 1) type = '単独正解'; else if (cc <= threshold) type = '少数正解';
                qStats.push({ q, correctCount: cc, rate, type, names, isRare: cc <= threshold });
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

        function openDeleteModal() {
            document.getElementById('delete-target-id').textContent = projectId;
            document.getElementById('delete-id-input').value = '';
            document.getElementById('delete-modal').style.display = 'flex';
        }

        async function confirmDeleteProject() {
            const typed = document.getElementById('delete-id-input').value;
            if (typed !== projectId) { showAdminToast('プロジェクトIDが一致しません。'); return; }
            document.getElementById('delete-modal').style.display = 'none';
            try {
                await db.ref(`projects/${projectId}`).remove(); 
                showAdminToast('プロジェクトが削除されました。', 'success'); 
                setTimeout(() => { session.clear(); location.href = 'index.html'; }, 1500);
            } catch(e) {
                showAdminToast('削除エラー: ' + e.message);
            }
        }

        // ============================
        // 設定更新処理
        // ============================

        async function updateProjectName() {
            const name = document.getElementById('setting-project-name').value.trim();
            if(!name) return showAdminToast('プロジェクト名を入力してください');
            await db.ref(`projects/${projectId}/publicSettings/projectName`).set(name);
            showAdminToast('プロジェクト名を更新しました', 'success');
        }

        async function purgeOldImages() {
            // 3日以上前のanswers画像を全削除
            const snap = await db.ref(`projects/${projectId}/protected/${secretHash}/answers`).get();
            if (!snap.exists()) return;
            const now = Date.now();
            const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
            const updates = {};
            snap.forEach(child => {
                const data = child.val();
                if (data.uploadedAt && (now - data.uploadedAt > THREE_DAYS)) {
                    // 画像データのみnullにする（成績の参照番号としては残す）
                    updates[`projects/${projectId}/protected/${secretHash}/answers/${child.key}/pageImage`] = null;
                    updates[`projects/${projectId}/protected/${secretHash}/answers/${child.key}/cells`] = null;
                }
            });
            if (Object.keys(updates).length > 0) {
                await db.ref().update(updates);
            }
        }

        // ============================
        // 参加者管理・受付管理
        // ============================
        async function toggleEntryList() {
            const enabled = document.getElementById('entry-list-toggle').checked;
            await db.ref(`projects/${projectId}/protected/${secretHash}/entryConfig/listEnabled`).set(enabled);
        }

        async function loadAdminEntries() {
            const tbody = document.getElementById('admin-entries-tbody');
            tbody.innerHTML = '<tr><td colspan="7" style="padding:12px;text-align:center">読み込み中...</td></tr>';

            try {
                const snap = await db.ref(`projects/${projectId}/entries`).orderByChild('entryNumber').once('value');
                if (!snap.exists()) {
                    tbody.innerHTML = '<tr><td colspan="7" style="padding:12px;text-align:center">名簿データがありません。</td></tr>';
                    return;
                }

                tbody.innerHTML = '';
                const children = [];
                snap.forEach(c => { children.push(c.val()); });
                
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
            const snap = await db.ref(`projects/${projectId}/entries`).orderByChild('entryNumber').get();
            if (!snap.exists()) return;
            const rows = [['受付番号', '姓', '名', 'セイ', 'メイ', 'メールアドレス', '所属機関', '学年', 'エントリー名', '意気込み', '連絡事項', '状態', 'UUID']];
            
            const children = [];
            snap.forEach(child => { children.push(child.val()); });
            
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
            await db.ref(`projects/${projectId}/protected/${secretHash}/entryConfig/disclosureEnabled`).set(enabled);
            document.getElementById('disclosure-url').style.display = enabled ? 'block' : 'none';
            if (enabled) {
                await generateDisclosure();
            }
        }

        async function generateDisclosure() {
            try {
                const updates = {};
                // すべてのentryNumbersについてスコアを計算
                entryNumbers.forEach(en => {
                    const results = {};
                    for (let q = 1; q <= totalQuestions; q++) {
                        const fd = scoresData[`__final__q${q}`] || {};
                        const qs = scoresData[en]?.[`q${q}`] || {};
                        let r = 'hold';
                        if (fd[en]) { r = fd[en]; }
                        else {
                            const vals = Object.values(qs);
                            const co = vals.filter(x => x === 'correct').length;
                            const wr = vals.filter(x => x === 'wrong').length;
                            const ho = vals.filter(x => x === 'hold').length;
                            if (ho > 0 || (co > 0 && wr > 0)) {  }
                            else if (co >= 2) r = 'correct';
                            else if (wr >= 2) r = 'wrong';
                            else if (co === 1) r = 'correct';
                            else if (wr === 1) r = 'wrong';
                        }
                        results[`q${q}`] = r;
                    }
                    const score = Object.values(results).filter(x => x === 'correct').length;
                    updates[`projects/${projectId}/protected/${secretHash}/disclosure/${en}`] = {
                        score,
                        totalQuestions,
                        results
                    };
                });
                await db.ref().update(updates);
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
                    const snap = await db.ref(`projects/${projectId}/${sec}`).get();
                    if (snap.exists()) {
                        data[sec] = snap.val();
                    }
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

        init();