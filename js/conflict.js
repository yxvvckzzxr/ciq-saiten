// conflict.js — コンフリクト解消（Firebase SDK WebSocket版）

const auth = requireAuth({ requireAdmin: true });
if (!auth) throw new Error('auth');
const { projectId, secretHash } = auth;
const adminHash = session.get('adminHash');

        let answersData = {};
        let answersText = {};
        let scoresData = {};
        let entryNumbers = [];
        let selectedIndex = 0;
        let currentConflicts = [];
        let answersDataCache = {}; // 全答案データキャッシュ

        let totalQuestions = 100;
        let requiredScorers = 3;

        async function init() {
            await waitForAuth();
            // 軽量データのみ先に取得（config, スコア, 模範解答, 必要採点者数）
            const [config, answersTextData, rs] = await Promise.all([
                dbGet(`projects/${projectId}/protected/${secretHash}/config`),
                dbGet(`projects/${projectId}/protected/${secretHash}/answers_text`),
                dbGet(`projects/${projectId}/protected/${secretHash}/requiredScorers`)
            ]);
            if (rs) requiredScorers = rs;
            if (config) totalQuestions = config.questionCount || 100;
            if (answersTextData) answersText = answersTextData;

            // エントリー番号一覧を取得（answersのキーだけ、値は不要）
            const answersSnap = await dbRef(`projects/${projectId}/protected/${secretHash}/answers`).once('value');
            if (answersSnap.exists()) {
                answersSnap.forEach(child => {
                    const num = Number(child.key);
                    if (num > 0) entryNumbers.push(num);
                });
                entryNumbers.sort((a, b) => a - b);
            }

            // スコアリスナー即開始（画像は render 後に遅延取得）
            // scorerHash側のスコア + adminHash側の確定結果を両方監視
            let scorerScores = {};
            let adminFinals = {};
            const mergeData = () => {
                scoresData = { ...scorerScores };
                // adminHash側の __final__ を scoresData にマージ
                for (const [key, val] of Object.entries(adminFinals)) {
                    scoresData[key] = val;
                }
                render();
            };
            const scorePoller = new Poller(
                `projects/${projectId}/protected/${secretHash}/scores`,
                (data) => { scorerScores = data || {}; mergeData(); },
                3000
            );
            scorePoller.start();
            // adminHash 側の確定結果を監視
            const finalPoller = new Poller(
                `projects/${projectId}/protected/${adminHash}/finalResults`,
                (data) => { adminFinals = data || {}; mergeData(); },
                5000
            );
            finalPoller.start();
        }

        function render() {
            const conflicts = [];

            for (let q = 1; q <= totalQuestions; q++) {
                const completedScorers = Object.keys(scoresData[`__completed__q${q}`] || {});
                if (completedScorers.length < requiredScorers) continue;

                entryNumbers.forEach(entryNum => {
                    const qScores = scoresData[entryNum]?.[`q${q}`] || {};
                    const entries = Object.entries(qScores);
                    const corrects = entries.filter(([, v]) => v === 'correct').length;
                    const wrongs = entries.filter(([, v]) => v === 'wrong').length;

                    // 全票一致以外はすべてコンフリクト（管理者判断が必要）
                    if (corrects !== requiredScorers && wrongs !== requiredScorers) {
                        // adminHash側の確定結果を優先、なければ自動確定を参照
                        const finalResult = adminFinals[`q${q}`]?.[entryNum]
                            || scorerScores[`__auto_final__q${q}`]?.[entryNum];
                        conflicts.push({ q, entryNum, qScores, finalResult });
                    }
                });
            }

            // コンフリクトがある問題の画像だけ遅延取得
            const needsLoad = [];
            conflicts.forEach(c => {
                if (!answersData[c.entryNum]) answersData[c.entryNum] = { cells: {} };
                if (answersData[c.entryNum].cells[`q${c.q}`] === undefined) {
                    answersData[c.entryNum].cells[`q${c.q}`] = null; // placeholder
                    needsLoad.push(c);
                }
            });

            if (needsLoad.length > 0) {
                // answerCells から個別取得
                Promise.all(needsLoad.map(async c => {
                    const cellImg = await dbGet(`projects/${projectId}/protected/${secretHash}/answerCells/q${c.q}/${c.entryNum}`);
                    if (cellImg) {
                        answersData[c.entryNum].cells[`q${c.q}`] = cellImg;
                    } else {
                        // フォールバック: answersから取得
                        const ansData = answersDataCache[c.entryNum] || await dbGet(`projects/${projectId}/protected/${secretHash}/answers/${c.entryNum}`);
                        if (ansData) {
                            answersDataCache[c.entryNum] = ansData;
                            answersData[c.entryNum].cells[`q${c.q}`] = ansData?.cells?.[`q${c.q}`] || null;
                        }
                    }
                })).then(() => render());
            }
            {

            currentConflicts = conflicts;
            if (selectedIndex >= conflicts.length) selectedIndex = Math.max(0, conflicts.length - 1);

            const unresolvedCount = conflicts.filter(c => !c.finalResult).length;
            const counter = document.getElementById('counter');
            if (unresolvedCount === 0) {
                counter.textContent = `全${conflicts.length}件 確定済み`;
                counter.className = 'counter all-clear';
            } else {
                counter.textContent = `残 ${unresolvedCount} / ${conflicts.length}件`;
                counter.className = 'counter has-conflicts';
            }

            const grid = document.getElementById('conflict-grid');

            if (conflicts.length === 0) {
                grid.innerHTML = '<div class="no-conflict"><i class="fa-solid fa-circle-check" style="font-size:48px;display:block;margin-bottom:16px;color:#34d399"></i> 要確認はありません</div>';
                return;
            }

            grid.innerHTML = '';

            const masterData = getMasterData(projectId);

            conflicts.forEach(({ q, entryNum, qScores, finalResult }, idx) => {
                const imageData = answersData[entryNum]?.cells[`q${q}`];
                const modelAnswer = answersText[q] || '';
                const displayName = masterData[entryNum]?.name || `No.${padNum(entryNum)}`;

                const card = document.createElement('div');
                card.className = `conflict-card ${finalResult ? 'resolved ' + finalResult : ''} ${idx === selectedIndex ? 'selected' : ''}`;

                const votesHtml = Object.values(qScores).map(val => {
                    if (val === 'correct') return `<span class="vote-dot correct">○</span>`;
                    if (val === 'wrong') return `<span class="vote-dot wrong">×</span>`;
                    if (val === 'hold') return `<span class="vote-dot hold">△</span>`;
                    return '';
                }).join(' ');

                // CSSクロップ方式 vs 旧方式
                let imgHtml;
                if (imageData?.type === 'crop') {
                    const pctW = imageData.pageW / imageData.w * 100;
                    const pctML = -imageData.x / imageData.w * 100;
                    const pctMT = -imageData.y / imageData.w * 100;
                    const pctH = imageData.h / imageData.w * 100;
                    imgHtml = `<div style="width:100%;padding-top:${pctH}%;position:relative;overflow:hidden;background:white;border-radius:4px">
                        <img src="${imageData.url}" alt="${displayName} ${q}問" loading="eager" decoding="async"
                             style="position:absolute;top:0;left:0;display:block;width:${pctW}%;height:auto;object-fit:initial;max-width:none;margin-left:${pctML}%;margin-top:${pctMT}%" />
                    </div>`;
                } else if (imageData) {
                    imgHtml = `<img src="${imageData}" alt="${displayName} ${q}問" loading="eager" decoding="async" />`;
                } else {
                    imgHtml = `<div class="img-expired"><i class="fa-solid fa-clock"></i> 画像の有効期限切れ</div>`;
                }
                card.innerHTML = `
                  ${imgHtml}
                  <div class="q-tag-badge">${q}問</div>
                  <div class="entry-num">${displayName}</div>
                  ${modelAnswer ? `<div class="conflict-model-ans"><strong>${modelAnswer}</strong></div>` : ''}
                  <div class="votes-mini">${votesHtml}</div>
                `;
                card.addEventListener('click', () => selectConflictCard(idx));
                card.addEventListener('dblclick', () => showPreview(projectId, secretHash, entryNum));
                grid.appendChild(card);
            });

            scrollToSelectedConflict();
            } // End of render block
        }

        async function setFinal(q, entryNum, result) {
            // adminHash配下に書き込み（採点者からは書き換え不可能）
            await dbSet(`projects/${projectId}/protected/${adminHash}/finalResults/q${q}/${entryNum}`, result);
        }

        function selectConflictCard(idx) {
            if (idx < 0 || idx >= currentConflicts.length) return;
            selectedIndex = idx;
            const cards = document.querySelectorAll('.conflict-card');
            cards.forEach((card, i) => card.classList.toggle('selected', i === selectedIndex));
            scrollToSelectedConflict();
        }

        function advanceConflictSelection() {
            if (selectedIndex < currentConflicts.length - 1) {
                selectConflictCard(selectedIndex + 1);
            }
        }

        function getConflictGridCols() {
            const grid = document.getElementById('conflict-grid');
            return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
        }

        function scrollToSelectedConflict() {
            const cards = document.querySelectorAll('.conflict-card');
            if (cards[selectedIndex]) {
                cards[selectedIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }

        document.addEventListener('keydown', (e) => {
            if (currentConflicts.length === 0) return;
            const key = e.key;
            if (key === 'm' || key === 'M') {
                e.preventDefault();
                const conflict = currentConflicts[selectedIndex];
                if (conflict) {
                    setFinal(conflict.q, conflict.entryNum, 'correct');
                    advanceConflictSelection();
                }
            } else if (key === 'x' || key === 'X') {
                e.preventDefault();
                const conflict = currentConflicts[selectedIndex];
                if (conflict) {
                    setFinal(conflict.q, conflict.entryNum, 'wrong');
                    advanceConflictSelection();
                }
            } else if (key === 'ArrowRight') {
                e.preventDefault();
                selectConflictCard(selectedIndex + 1);
            } else if (key === 'ArrowLeft') {
                e.preventDefault();
                selectConflictCard(selectedIndex - 1);
            } else if (key === 'ArrowDown') {
                e.preventDefault();
                selectConflictCard(selectedIndex + getConflictGridCols());
            } else if (key === 'ArrowUp') {
                e.preventDefault();
                selectConflictCard(selectedIndex - getConflictGridCols());
            }
        });



        init();