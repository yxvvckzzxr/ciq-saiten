const projectId = session.projectId;
        const secretHash = session.get("secretHash");
        const scorerRole = session.scorerRole;
        if (!projectId || scorerRole !== 'admin') {
            document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#f87171;font-weight:bold;">管理者としてプロジェクトに入室してください。3秒後にトップページへ戻ります。</div>';
            setTimeout(() => location.href = 'index.html', 3000);
            return;
        }

        let answersData = {};
        let answersText = {};
        let scoresData = {};
        let entryNumbers = [];
        let selectedIndex = 0;
        let currentConflicts = [];

        let totalQuestions = 100;

        function logout() {
            session.clear();
            location.href = 'index.html';
        }

        async function init() {

            const configSnap = await db.ref(`projects/${projectId}/protected/${secretHash}/config`).once('value');
            if(configSnap.exists()) {
                totalQuestions = configSnap.val().questionCount || 100;
            }

            try {
                const res = await fetch(`https://quziopus-default-rtdb.asia-southeast1.firebasedatabase.app/projects/${projectId}/protected/${secretHash}/answers.json?shallow=true`);
                const data = await res.json();
                if (data) entryNumbers = Object.keys(data).map(Number).sort((a, b) => a - b);
            } catch(e) {
                console.error('答案キー取得エラー:', e);
            }

            const answersTextSnap = await db.ref(`projects/${projectId}/protected/${secretHash}/answers_text`).get();
            if (answersTextSnap.exists()) {
                answersText = answersTextSnap.val();
            }

            db.ref(`projects/${projectId}/protected/${secretHash}/scores`).on('value', snap => {
                scoresData = snap.val() || {};
                render();
            });
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

            // 画像の必要部分だけダイナミックに一括取得
            const promises = conflicts.map(async c => {
                if (!answersData[c.entryNum]) answersData[c.entryNum] = { cells: {} };
                if (answersData[c.entryNum].cells[`q${c.q}`] === undefined) {
                    const snap = await db.ref(`projects/${projectId}/protected/${secretHash}/answers/${c.entryNum}/cells/q${c.q}`).get();
                    answersData[c.entryNum].cells[`q${c.q}`] = snap.val() || null;
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

            let masterData = {};
            try { masterData = JSON.parse(localStorage.getItem(`masterData_${projectId}`) || '{}'); } catch(e) {}

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
                card.addEventListener('dblclick', () => showPreview(entryNum));
                grid.appendChild(card);
            });

            scrollToSelectedConflict();
            }); // End of Promise.all
        }

        async function setFinal(q, entryNum, result) {
            await db.ref(`projects/${projectId}/protected/${secretHash}/scores/__final__q${q}/${entryNum}`).set(result);
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
        async function showPreview(entryNum) {
            let overlay = document.getElementById('preview-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'preview-overlay';
                overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);backdrop-filter:blur(10px);z-index:10000;display:none;overflow-y:auto;padding:24px;';
                document.body.appendChild(overlay);
            }
            let masterData = {}; try { masterData = JSON.parse(localStorage.getItem(`masterData_${projectId}`)||'{}'); } catch(e) {}
            const name = masterData[entryNum]?.name || `受付番号 ${entryNum}`;
            overlay.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;"><h2 style="color:white;font-size:18px"><i class="fa-solid fa-file-image"></i> ${name} の解答用紙</h2><button class="btn secondary" onclick="document.getElementById('preview-overlay').style.display='none'">✕ 閉じる</button></div><div id="preview-content" style="text-align:center"><div style="color:#aaa"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中...</div></div>`;
            overlay.style.display = 'block';
            const snap = await db.ref(`projects/${projectId}/protected/${secretHash}/answers/${entryNum}/pageImage`).get();
            const pc = document.getElementById('preview-content');
            if (snap.exists()) {
                pc.innerHTML = `<img src="${snap.val()}" alt="${name}" style="max-width:100%;max-height:85vh;border-radius:8px;background:white;box-shadow:0 4px 24px rgba(0,0,0,0.5)">`;
            } else { pc.innerHTML = '<div style="color:#aaa;padding:40px">ページ画像が保存されていません。管理画面から答案を再読み込みしてください。</div>'; }
        }
        document.addEventListener('keydown', e => { if (e.key === 'Escape') { const o = document.getElementById('preview-overlay'); if (o) o.style.display = 'none'; }});