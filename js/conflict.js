// conflict.js — コンフリクト解消（REST + ポーリング版・WebSocket接続ゼロ）

const auth = requireAuth({ requireAdmin: true });
if (!auth) throw new Error('auth');
const { projectId, secretHash } = auth;

        let answersData = {};
        let answersText = {};
        let scoresData = {};
        let entryNumbers = [];
        let selectedIndex = 0;
        let currentConflicts = [];

        let totalQuestions = 100;

        async function init() {
            // 独立した3つのクエリを並列実行 (REST)
            const [config, shallowData, answersTextData] = await Promise.all([
                dbGet(`projects/${projectId}/protected/${secretHash}/config`),
                dbShallow(`projects/${projectId}/protected/${secretHash}/answers`).catch(e => { console.error('答案キー取得エラー:', e); return null; }),
                dbGet(`projects/${projectId}/protected/${secretHash}/answers_text`)
            ]);

            if (config) totalQuestions = config.questionCount || 100;
            if (shallowData) entryNumbers = Object.keys(shallowData).map(Number).sort((a, b) => a - b);
            if (answersTextData) answersText = answersTextData;

            // ポーリングでスコアを定期取得（WebSocket .on() の代替）
            const scorePoller = new Poller(
                `projects/${projectId}/protected/${secretHash}/scores`,
                (data) => {
                    scoresData = data || {};
                    render();
                },
                3000
            );
            IdleManager.register(scorePoller);
            scorePoller.start();
            IdleManager.init();
        }

        function render() {
            const conflicts = [];

            for (let q = 1; q <= totalQuestions; q++) {
                const completedScorers = Object.keys(scoresData[`__completed__q${q}`] || {});
                if (completedScorers.length < 3) continue;

                entryNumbers.forEach(entryNum => {
                    const qScores = scoresData[entryNum]?.[`q${q}`] || {};
                    const entries = Object.entries(qScores);
                    const corrects = entries.filter(([, v]) => v === 'correct').length;
                    const wrongs = entries.filter(([, v]) => v === 'wrong').length;

                    // 3票一致以外はすべてコンフリクト（管理者判断が必要）
                    if (corrects !== 3 && wrongs !== 3) {
                        const finalResult = scoresData[`__final__q${q}`]?.[entryNum];
                        conflicts.push({ q, entryNum, qScores, finalResult });
                    }
                });
            }

            // ページ画像キャッシュ
            const pageImageCache = new Map();
            async function loadPageImage(url) {
                if (pageImageCache.has(url)) return pageImageCache.get(url);
                const p = new Promise((resolve, reject) => {
                    const img = new Image(); img.crossOrigin = 'anonymous';
                    img.onload = () => resolve(img); img.onerror = reject;
                    img.src = url;
                });
                pageImageCache.set(url, p);
                return p;
            }

            const promises = conflicts.map(async c => {
                if (!answersData[c.entryNum]) answersData[c.entryNum] = { cells: {} };
                if (answersData[c.entryNum].cells[`q${c.q}`] === undefined) {
                    const ansData = await dbGet(`projects/${projectId}/protected/${secretHash}/answers/${c.entryNum}`);
                    const region = ansData?.cellRegions?.[`q${c.q}`];
                    if (region && ansData?.pageImageUrl) {
                        try {
                            const img = await loadPageImage(ansData.pageImageUrl);
                            const cv = document.createElement('canvas');
                            cv.width = region.w; cv.height = region.h;
                            cv.getContext('2d').drawImage(img, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
                            answersData[c.entryNum].cells[`q${c.q}`] = cv.toDataURL('image/webp', 0.8);
                        } catch (e) { answersData[c.entryNum].cells[`q${c.q}`] = null; }
                    } else {
                        const cellUrl = ansData?.cellUrls?.[`q${c.q}`] || ansData?.cells?.[`q${c.q}`] || null;
                        answersData[c.entryNum].cells[`q${c.q}`] = cellUrl;
                    }
                }
            });
            Promise.all(promises).then(() => {

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
                const displayName = masterData[entryNum]?.name || `受付番号 ${entryNum}`;

                const card = document.createElement('div');
                card.className = `conflict-card ${finalResult ? 'resolved ' + finalResult : ''} ${idx === selectedIndex ? 'selected' : ''}`;

                const votesHtml = Object.values(qScores).map(val => {
                    if (val === 'correct') return `<span class="vote-dot correct">○</span>`;
                    if (val === 'wrong') return `<span class="vote-dot wrong">×</span>`;
                    if (val === 'hold') return `<span class="vote-dot hold">△</span>`;
                    return '';
                }).join(' ');

                card.innerHTML = `
                  <img src="${imageData || ''}" alt="${displayName} ${q}問" loading="lazy" />
                  <div class="q-tag-badge">${q}問</div>
                  ${modelAnswer ? `<div class="model-ans-badge" title="${modelAnswer}">${modelAnswer}</div>` : ''}
                  <div class="entry-num">${displayName}</div>
                  <div class="votes-mini">${votesHtml}</div>
                `;
                card.addEventListener('click', () => selectConflictCard(idx));
                card.addEventListener('dblclick', () => showPreview(projectId, secretHash, entryNum));
                grid.appendChild(card);
            });

            scrollToSelectedConflict();
            }); // End of Promise.all
        }

        async function setFinal(q, entryNum, result) {
            await dbSet(`projects/${projectId}/protected/${secretHash}/scores/__final__q${q}/${entryNum}`, result);
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