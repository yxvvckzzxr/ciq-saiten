// question.js — 採点画面（Firebase SDK WebSocket版）
// SDK トランザクションによる採点者ロック（4人目滑り込み防止）
// 楽観的UI更新（ポーリングの空白中もサクサク操作可能）

const auth = requireAuth();
const { projectId, secretHash, scorerName } = auth || {};
if (!auth) throw new Error('auth');
const currentQ = parseInt(localStorage.getItem('current_q') || '1');

        document.getElementById('q-badge').textContent = `${currentQ} 問`;

        let answers = {};
        let myScores = {};
        let entryNumbers = [];
        let isCompleted = false;
        let selectedIndex = 0;
        // 楽観的UI更新: 自分が送信した変更をポーリング到着まで保護するバッファ
        let pendingWrites = {};
        // answer データキャッシュ（同一ページ内での再fetch防止）
        const answerDataCache = {};

        async function init() {
            await waitForAuth();
            // 模範解答と全答案データを一括取得
            const [answerText, allAnswers] = await Promise.all([
                dbGet(`projects/${projectId}/protected/${secretHash}/answers_text/${currentQ}`),
                dbGet(`projects/${projectId}/protected/${secretHash}/answers`)
            ]);
            document.getElementById('answer-badge').textContent = answerText || '未設定';

            if (allAnswers) {
                entryNumbers = Object.keys(allAnswers).map(Number).filter(n => n > 0).sort((a, b) => a - b);
                // キャッシュに格納
                entryNumbers.forEach(num => {
                    answerDataCache[num] = allAnswers[num];
                });
            }

            if (entryNumbers.length === 0) {
                document.getElementById('answer-grid').innerHTML = '<div class="loading-state" style="grid-column:1/-1"><i class="fa-solid fa-inbox"></i> 答案データがありません</div>';
                return;
            }

            // キャッシュからCSSクロップデータを生成（HTTPリクエスト不要）
            entryNumbers.forEach(entryNum => {
                const cellData = answerDataCache[entryNum];
                if (!answers[entryNum]) answers[entryNum] = { cells: {} };
                const region = cellData?.cellRegions?.[`q${currentQ}`];
                if (region && cellData?.pageImageUrl && cellData?.pageWidth) {
                    answers[entryNum].cells[`q${currentQ}`] = {
                        type: 'crop',
                        url: cellData.pageImageUrl,
                        x: region.x, y: region.y, w: region.w, h: region.h,
                        pageW: cellData.pageWidth
                    };
                } else {
                    const cellUrl = cellData?.cellUrls?.[`q${currentQ}`] || cellData?.cells?.[`q${currentQ}`];
                    answers[entryNum].cells[`q${currentQ}`] = cellUrl;
                }
            });

            // スコアリスナーを即開始（描画を最速にする）
            const scorePoller = new Poller(
                `projects/${projectId}/protected/${secretHash}/scores`,
                (allScores) => {
                    allScores = allScores || {};
                    myScores = {};
                    entryNumbers.forEach(entryNum => {
                        if (pendingWrites[entryNum] !== undefined) {
                            myScores[entryNum] = pendingWrites[entryNum];
                        } else {
                            myScores[entryNum] = allScores[entryNum]?.[`q${currentQ}`]?.[scorerName] || null;
                        }
                    });
                    for (const en of Object.keys(pendingWrites)) {
                        const serverVal = allScores[en]?.[`q${currentQ}`]?.[scorerName];
                        if (serverVal === pendingWrites[en]) {
                            delete pendingWrites[en];
                        }
                    }
                    isCompleted = allScores[`__completed__q${currentQ}`]?.[scorerName] === true;
                    renderGrid();
                    checkAutoCompletion(allScores);
                },
                3000
            );
            scorePoller.start();

            // 採点者登録はバックグラウンドで実行（描画をブロックしない）
            dbTransaction(
                `projects/${projectId}/protected/${secretHash}/scores/__scorers__q${currentQ}`,
                (current) => {
                    const scorers = current || {};
                    const names = Object.keys(scorers);
                    if (names.includes(scorerName)) return { ...scorers };
                    if (names.length >= 3) return undefined;
                    return { ...scorers, [scorerName]: true };
                }
            ).catch(e => {
                if (e.message.includes('中止') || e.message.includes('リトライ')) {
                    showToast('すれ違いで満員になりました。問題一覧に戻ります。', 'error', 3000);
                    setTimeout(() => location.href = 'judge.html', 2000);
                }
            });
        }

        function renderGrid() {
            const grid = document.getElementById('answer-grid');
            if (selectedIndex >= entryNumbers.length) selectedIndex = Math.max(0, entryNumbers.length - 1);

            const total = entryNumbers.length;
            const done = entryNumbers.filter(n => myScores[n] !== null).length;
            document.getElementById('progress-text').textContent = `${done} / ${total} 件`;

            let masterData = getMasterData(projectId);

            // DOMを毎度作り直すと画像がチラつくため、既に要素があればクラスのみ更新
            if (grid.children.length === entryNumbers.length && grid.children[0]?.className?.includes('answer-card')) {
                entryNumbers.forEach((entryNum, idx) => {
                    const myScore = myScores[entryNum];
                    const card = grid.children[idx];
                    card.className = `answer-card ${myScore === 'correct' ? 'correct' : myScore === 'wrong' ? 'wrong' : myScore === 'hold' ? 'hold' : ''} ${idx === selectedIndex ? 'selected' : ''}`;
                });
            } else {
                grid.innerHTML = '';

                entryNumbers.forEach((entryNum, idx) => {
                    const imageData = answers[entryNum]?.cells[`q${currentQ}`];
                    const myScore = myScores[entryNum];
                    const displayName = masterData[entryNum]?.name || `受付番号 ${entryNum}`;

                    const card = document.createElement('div');
                    card.className = `answer-card ${myScore === 'correct' ? 'correct' : myScore === 'wrong' ? 'wrong' : myScore === 'hold' ? 'hold' : ''} ${idx === selectedIndex ? 'selected' : ''}`;

                    let imgHtml;
                    if (imageData?.type === 'crop') {
                        const pctW = imageData.pageW / imageData.w * 100;
                        const pctML = -imageData.x / imageData.w * 100;
                        const pctMT = -imageData.y / imageData.w * 100;
                        const pctH = imageData.h / imageData.w * 100;
                        imgHtml = `<div class="crop-wrap" style="width:100%;padding-top:${pctH}%;position:relative;overflow:hidden;background:white;border-radius:4px">
                            <img src="${imageData.url}" alt="${displayName}" loading="eager" decoding="async"
                                 style="position:absolute;top:0;left:0;display:block;width:${pctW}%;height:auto;object-fit:initial;max-width:none;margin-left:${pctML}%;margin-top:${pctMT}%" />
                        </div>`;
                    } else if (imageData) {
                        imgHtml = `<img src="${imageData}" alt="${displayName}" loading="eager" decoding="async" />`;
                    } else {
                        imgHtml = `<div class="img-expired"><i class="fa-solid fa-clock"></i> 画像の有効期限切れ</div>`;
                    }

                    card.innerHTML = `${imgHtml}<div class="entry-num">${displayName}</div>`;
                    card.addEventListener('click', () => selectCard(idx));
                    card.addEventListener('dblclick', () => showPreview(projectId, secretHash, entryNum));
                    grid.appendChild(card);
                });
            }

            scrollToSelected();
        }

        function mark(entryNum, result) {
            // 楽観的UI更新: 即座にローカル反映
            pendingWrites[entryNum] = result;
            myScores[entryNum] = result;
            renderGrid();
            // バックグラウンドでサーバーに書き込み
            dbSet(`projects/${projectId}/protected/${secretHash}/scores/${entryNum}/q${currentQ}/${scorerName}`, result)
                .catch(e => {
                    console.error('スコア書き込みエラー:', e);
                    delete pendingWrites[entryNum];
                    showToast('採点の保存に失敗しました', 'error');
                });
        }

        function selectCard(idx) {
            if (idx < 0 || idx >= entryNumbers.length) return;
            selectedIndex = idx;
            const cards = document.querySelectorAll('.answer-card');
            cards.forEach((card, i) => card.classList.toggle('selected', i === selectedIndex));
            scrollToSelected();
        }

        function advanceSelection() {
            if (selectedIndex < entryNumbers.length - 1) {
                selectCard(selectedIndex + 1);
            }
        }

        function getGridCols() {
            const grid = document.getElementById('answer-grid');
            return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
        }

        function scrollToSelected() {
            const cards = document.querySelectorAll('.answer-card');
            if (cards[selectedIndex]) {
                cards[selectedIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }

        
        window.scoreSelected = function(status) {
            if (entryNumbers.length === 0) return;
            const entryNum = entryNumbers[selectedIndex];
            
            // UI visual feedback
            const cards = document.querySelectorAll('.answer-card');
            const card = cards[selectedIndex];
            if (card) {
                card.style.transform = 'scale(1.05)';
                setTimeout(() => card.style.transform = 'scale(1)', 150);
            }

            mark(entryNum, status);

            // 最後の回答でなければ自動で次の回答へ移動
            if (selectedIndex < entryNumbers.length - 1) {
                selectedIndex++;
                selectCard(selectedIndex);
            }
        };

        // Re-use logic in keydown
document.addEventListener('keydown', (e) => {
            if (entryNumbers.length === 0) return;
            const key = e.key;
            if (key === 'm' || key === 'M') {
                e.preventDefault();
                const entryNum = entryNumbers[selectedIndex];
                if (entryNum !== undefined) {
                    mark(entryNum, 'correct');
                    advanceSelection();
                }
            } else if (key === 'x' || key === 'X') {
                e.preventDefault();
                const entryNum = entryNumbers[selectedIndex];
                if (entryNum !== undefined) {
                    mark(entryNum, 'wrong');
                    advanceSelection();
                }
            } else if (key === 'h' || key === 'H') {
                e.preventDefault();
                const entryNum = entryNumbers[selectedIndex];
                if (entryNum !== undefined) {
                    mark(entryNum, 'hold');
                    advanceSelection();
                }
            } else if (key === 'ArrowRight') {
                e.preventDefault();
                selectCard(selectedIndex + 1);
            } else if (key === 'ArrowLeft') {
                e.preventDefault();
                selectCard(selectedIndex - 1);
            } else if (key === 'ArrowDown') {
                e.preventDefault();
                selectCard(selectedIndex + getGridCols());
            } else if (key === 'ArrowUp') {
                e.preventDefault();
                selectCard(selectedIndex - getGridCols());
            }
        });

        async function checkAutoCompletion(allScores) {
            const total = entryNumbers.length;
            const done = entryNumbers.filter(n => myScores[n] !== null).length;
            const allDone = done === total && total > 0;

            document.getElementById('progress-text').textContent = `${done} / ${total} 件`;

            if (allDone && !isCompleted) {
                isCompleted = true; // 重複実行ブロック
                await dbSet(`projects/${projectId}/protected/${secretHash}/scores/__completed__q${currentQ}/${scorerName}`, true);

                if (!allScores) {
                    allScores = await dbGet(`projects/${projectId}/protected/${secretHash}/scores`) || {};
                }
                await checkAutoConfirm(allScores, currentQ);
                
                location.href = 'judge.html';
            }
        }

        async function checkAutoConfirm(allScores, q) {
            const completedScorers = Object.keys(allScores[`__completed__q${q}`] || {});
            if (completedScorers.length < 3) return;

            const entryNums = Object.keys(allScores)
                .filter(k => !k.startsWith('__'))
                .map(Number);

            const finals = {};
            let allAgree = true;

            for (const entryNum of entryNums) {
                const qScores = allScores[entryNum]?.[`q${q}`] || {};
                const vals = Object.values(qScores);
                const corrects = vals.filter(v => v === 'correct').length;
                const wrongs = vals.filter(v => v === 'wrong').length;

                // 3票完全一致のみ自動確定。それ以外はコンフリクト（管理者判断待ち）
                if (corrects === 3) {
                    finals[entryNum] = 'correct';
                } else if (wrongs === 3) {
                    finals[entryNum] = 'wrong';
                } else {
                    // 意見が割れている → 自動確定しない
                    allAgree = false;
                    break;
                }
            }

            if (allAgree) {
                await dbSet(`projects/${projectId}/protected/${secretHash}/scores/__final__q${q}`, finals);
            }
        }


        init();