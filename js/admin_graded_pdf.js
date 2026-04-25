// admin_graded_pdf.js — 採点済みPDF出力
        async function exportGradedPDF() {
            const overlay = document.getElementById('save-overlay');
            const overlayBar = document.getElementById('save-overlay-bar');
            const overlayText = document.getElementById('save-overlay-text');
            const overlayTitle = overlay.querySelector('h2');
            overlay.style.display = 'flex';
            overlayBar.style.width = '0%';
            overlayTitle.textContent = '採点済みPDFを生成中...';

            try {
                // 1) 採点結果を全問取得
                const finalResults = {}; // finalResults[qNum][entryNum] = 'correct' | undefined
                for (let q = 1; q <= totalQuestions; q++) {
                    finalResults[q] = scoresData[`__final__q${q}`] || {};
                }

                // 2) エントリーごとにスコア・連答を計算
                const entryResults = {};
                for (const en of entryNumbers) {
                    const answers = [];
                    for (let q = 1; q <= totalQuestions; q++) {
                        answers.push(finalResults[q][en] === 'correct' ? 1 : 0);
                    }
                    const score = answers.reduce((a, b) => a + b, 0);
                    const streaks = []; let cur = 0;
                    answers.forEach(a => { if (a === 1) { cur++; } else { streaks.push(cur); cur = 0; } });
                    streaks.push(cur);
                    // 上位2連答（降順ソート）
                    const topStreaks = [...streaks].sort((a, b) => b - a).slice(0, 2);
                    entryResults[en] = { score, topStreaks, answers };
                }

                // 3) 受付番号順にソート
                const sortedEntries = [...entryNumbers].sort((a, b) => a - b);

                // 4) jsPDF初期化
                window.jsPDF = window.jspdf.jsPDF;
                const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                const pdfW = 210, pdfH = 297;
                let isFirstPage = true;

                const total = sortedEntries.length;
                for (let idx = 0; idx < total; idx++) {
                    const en = sortedEntries[idx];
                    overlayText.textContent = `${idx + 1} / ${total} 人処理中`;
                    overlayBar.style.width = `${((idx + 1) / total) * 100}%`;

                    // ページ画像取得
                    let imageUrl = await dbGet(`projects/${projectId}/protected/${secretHash}/answerImages/${en}`);
                    if (!imageUrl) {
                        const ansData = await dbGet(`projects/${projectId}/protected/${secretHash}/answers/${en}`);
                        imageUrl = ansData?.pageImage;
                    }
                    if (!imageUrl) continue;

                    // セル座標取得
                    const ansData = await dbGet(`projects/${projectId}/protected/${secretHash}/answers/${en}`);
                    const cellRegions = ansData?.cellRegions;
                    if (!cellRegions) continue;

                    // 画像をCanvasにロード
                    const img = await new Promise((resolve, reject) => {
                        const i = new Image();
                        i.onload = () => resolve(i);
                        i.onerror = reject;
                        i.src = imageUrl;
                    });

                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);

                    // 座標スケール: cellRegionsはフル解像度基準、画像は縮小済み
                    const originalWidth = ansData.pageWidth || img.width;
                    const scaleX = img.width / originalWidth;
                    // pageHeightは未保存 → A4比率(297/210)から推定してY軸を個別スケール
                    const estimatedOriginalHeight = originalWidth * (297 / 210);
                    const scaleY = img.height / estimatedOriginalHeight;
                    if (idx === 0) console.log(`[GradedPDF] img: ${img.width}x${img.height}, pageWidth: ${originalWidth}, scaleX: ${scaleX.toFixed(4)}, scaleY: ${scaleY.toFixed(4)}`);

                    // ○/× マーク描画（半透明）
                    const result = entryResults[en];
                    for (let q = 1; q <= totalQuestions; q++) {
                        const region = cellRegions[`q${q}`];
                        if (!region) continue;
                        // X/Y別スケール適用
                        const rx = region.x * scaleX;
                        const ry = region.y * scaleY;
                        const rw = region.w * scaleX;
                        const rh = region.h * scaleY;
                        const cx = rx + rw / 2;
                        const cy = ry + rh / 2;
                        const radius = Math.min(rw, rh) * 0.3;
                        const isCorrect = result.answers[q - 1] === 1;

                        ctx.save();
                        ctx.lineWidth = Math.max(2, radius * 0.15);

                        if (isCorrect) {
                            // ○ 緑（半透明）
                            ctx.globalAlpha = 0.45;
                            ctx.strokeStyle = '#22c55e';
                            ctx.beginPath();
                            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                            ctx.stroke();
                        } else {
                            // × 赤（半透明）
                            ctx.globalAlpha = 0.45;
                            ctx.strokeStyle = '#ef4444';
                            const d = radius * 0.75;
                            ctx.beginPath();
                            ctx.moveTo(cx - d, cy - d);
                            ctx.lineTo(cx + d, cy + d);
                            ctx.moveTo(cx + d, cy - d);
                            ctx.lineTo(cx - d, cy + d);
                            ctx.stroke();
                        }
                        ctx.restore();
                    }

                    // スコア情報をマークシート上部に描画（赤文字）
                    const fontSize = Math.round(canvas.width * 0.022);
                    ctx.save();
                    ctx.font = `bold ${fontSize}px "Inter", sans-serif`;
                    ctx.fillStyle = '#ef4444';
                    ctx.globalAlpha = 0.9;

                    const lastRegion = cellRegions[`q${totalQuestions}`];
                    const scoreY = lastRegion
                        ? (lastRegion.y + lastRegion.h) * scaleY + fontSize * 1.5
                        : canvas.height * 0.88;

                    const scoreText = `Score: ${result.score}  |  Streak 1: ${result.topStreaks[0] || 0}  |  Streak 2: ${result.topStreaks[1] || 0}`;
                    ctx.fillText(scoreText, canvas.width * 0.05, scoreY);
                    ctx.restore();

                    // jsPDFにページ追加
                    if (!isFirstPage) doc.addPage();
                    isFirstPage = false;

                    // 画像のアスペクト比を維持してA4に収める
                    const imgAspect = canvas.width / canvas.height;
                    const pageAspect = pdfW / pdfH;
                    let drawW, drawH, drawX, drawY;
                    if (imgAspect > pageAspect) {
                        drawW = pdfW;
                        drawH = pdfW / imgAspect;
                        drawX = 0;
                        drawY = (pdfH - drawH) / 2;
                    } else {
                        drawH = pdfH;
                        drawW = pdfH * imgAspect;
                        drawX = (pdfW - drawW) / 2;
                        drawY = 0;
                    }

                    doc.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', drawX, drawY, drawW, drawH);
                }

                overlayText.textContent = 'PDFを保存中...';
                doc.save('graded_results.pdf');
                overlayText.textContent = '完了しました！';
                setTimeout(() => { overlay.style.display = 'none'; }, 1000);
                showAdminToast(`${total}人分の採点済みPDFを出力しました`, 'success');

            } catch (e) {
                console.error('PDF生成エラー:', e);
                overlay.style.display = 'none';
                showAdminToast('PDF生成エラー: ' + e.message);
            }
        }
