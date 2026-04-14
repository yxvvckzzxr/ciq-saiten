// admin_prep.js — 回答用紙生成 + 答案読み取り処理
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
            // レイアウト座標が未生成の場合は自動生成して保存
            if (!scanConfig.tombo || !scanConfig.markCells || !scanConfig.answerRegions) {
                const qCount = scanConfig.questionCount || totalQuestions;
                scanConfig = await buildLayoutConfig(qCount);
                await dbSet(`projects/${projectId}/protected/${secretHash}/config`, scanConfig);
            }

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
                    // セルのクロップ座標を計算（画像は保存しない — 採点画面でオンデマンドクロップ）
                    const cellRegions = {};
                    for (let q = 0; q < (scanConfig.questionCount || 100); q++) {
                        const cr = transformRegion(scanConfig.answerRegions[q], transform);
                        cellRegions[`q${q + 1}`] = { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.w), h: Math.round(cr.h) };
                    }
                    scanAnswers.push({ page: i, entryNumber, cellRegions, tomboError: detectedResult.error, pageImage: workCanvas.toDataURL('image/webp', 0.5) });
                }

                overlayTitle.textContent = 'サーバーへ保存中...';
                overlayBar.style.width = '0%';
                let current = 0; const totalBatch = scanAnswers.length;

                if (!storage) {
                    showAdminToast('Firebase Storage が未設定です。管理者に連絡してください。', 'error');
                    overlay.style.display = 'none';
                    return;
                }

                // 並列バッチアップロード（5件同時）
                const UPLOAD_CONCURRENCY = 5;
                const bucket = firebaseConfig.storageBucket;

                async function uploadEntry(a) {
                    try {
                        const storagePath = `projects/${projectId}/answers/${a.entryNumber}/pageImage`;
                        const pageRef = storage.ref(storagePath);
                        await pageRef.putString(a.pageImage, 'data_url');
                        // getDownloadURL() を省略 — URLを直接構築（ルールが read: if true の場合有効）
                        const pageImageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media`;

                        const data = {
                            entryNumber: a.entryNumber,
                            page: a.page,
                            uploadedAt: SERVER_TIMESTAMP,
                            pageImageUrl: pageImageUrl,
                            cellRegions: a.cellRegions
                        };
                        await dbSet(`projects/${projectId}/protected/${secretHash}/answers/${a.entryNumber}`, data);
                    } catch (e) {
                        console.error(`Entry ${a.entryNumber} upload error:`, e);
                        showAdminToast(`受付番号 ${a.entryNumber}: アップロード失敗`, 'error');
                    }
                    current++;
                    overlayBar.style.width = `${(current / totalBatch) * 100}%`;
                    overlayText.textContent = `${current} / ${totalBatch} 件保存`;
                }

                // 並列実行（同時接続数制限付き）
                for (let i = 0; i < scanAnswers.length; i += UPLOAD_CONCURRENCY) {
                    const batch = scanAnswers.slice(i, i + UPLOAD_CONCURRENCY);
                    await Promise.all(batch.map(uploadEntry));
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
