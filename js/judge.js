// judge.js — 問題一覧（Firebase SDK WebSocket版）

const auth = requireAuth();
const { projectId, secretHash, scorerName, scorerRole } = auth || {};
if (!auth) throw new Error('auth');

let totalQuestions = 100;

        async function initializeApp() {
            await waitForAuth();
            // プロジェクト設定を取得
            const config = await dbGet(`projects/${projectId}/protected/${secretHash}/config`);
            if (config) {
                totalQuestions = config.questionCount || 100;
            }
            const settings = await dbGet(`projects/${projectId}/publicSettings`);
            if (settings) {
                document.getElementById('project-title').textContent = settings.projectName || '問題一覧';
            }

            // Firebaseのentriesから参加者情報を取得してマスタとして保持 (オプション)
            fetchEntriesMaster();

            document.getElementById('menu-scorer-name').textContent = scorerName;
            document.getElementById('menu-scorer-role').innerHTML = scorerRole === 'admin'
                ? '<span class="menu-role-badge admin"><i class="fa-solid fa-crown"></i> 管理者</span>'
                : '<span class="menu-role-badge scorer"><i class="fa-solid fa-user-check"></i> 採点者</span>';

            if (scorerRole === 'admin') {
                document.getElementById('admin-menu-section').style.display = 'block';
            }

            const qGrid = document.getElementById('q-grid');
            qGrid.innerHTML = ''; // クリア
            for (let i = 1; i <= totalQuestions; i++) {
                const card = document.createElement('div');
                card.className = 'q-card';
                card.id = `qcard-${i}`;
                card.innerHTML = `
            <div class="q-num">${i}問</div>
            <div class="q-scorers" id="qscorers-${i}"></div>
            <div class="q-status status-open" id="qstatus-${i}">未着手</div>
          `;
                card.onclick = () => enterQ(i);
                qGrid.appendChild(card);
            }

            // リアルタイムリスナーでスコア状態を取得
            const scorePoller = new Poller(
                `projects/${projectId}/protected/${secretHash}/scores`,
                (data) => updateGrid(data || {}),
                3000
            );
            scorePoller.start();
        }

        async function fetchEntriesMaster() {
            const entriesData = await dbGet(`projects/${projectId}/entries`);
            if (entriesData) {
                const masterData = {};
                const privJwkStr = session.get('privateKeyJwk');
                let privJwk = null;
                if (privJwkStr) {
                    try { privJwk = JSON.parse(privJwkStr); } catch(e){}
                }

                for (const v of Object.values(entriesData)) {
                    if (!v.entryNumber) continue;
                    let name = '回答者 ' + v.entryNumber;
                    if (v.encryptedPII && privJwk) {
                        try {
                            const jsonStr = await AppCrypto.decryptRSA(v.encryptedPII, privJwk);
                            const pii = JSON.parse(jsonStr);
                            name = `${pii.familyName} ${pii.firstName}`;
                        } catch(e) {}
                    } else if (!v.encryptedPII && v.familyName) {
                        name = `${v.familyName} ${v.firstName}`;
                    }
                    masterData[v.entryNumber] = { name };
                }
                localStorage.setItem(`masterData_${projectId}`, JSON.stringify(masterData));
            }
        }

        function updateGrid(scores) {
            for (let q = 1; q <= totalQuestions; q++) {
                const scorers = new Set();
                Object.keys(scores).forEach(key => {
                    if (key.startsWith('__')) return;
                    const qScores = scores[key]?.[`q${q}`] || {};
                    Object.keys(qScores).forEach(name => scorers.add(name));
                });
                const scorerReg = scores[`__scorers__q${q}`] || {};
                Object.keys(scorerReg).forEach(name => scorers.add(name));

                const scorerList = [...scorers];
                const completedScorers = Object.keys(scores[`__completed__q${q}`] || {});
                const isMine = scorerList.includes(scorerName);
                const isFull = scorerList.length >= 3 && !isMine;
                const allDone = scorerList.length >= 3 && completedScorers.length >= 3;

                const card = document.getElementById(`qcard-${q}`);
                const statusEl = document.getElementById(`qstatus-${q}`);
                const scorersEl = document.getElementById(`qscorers-${q}`);

                card.className = 'q-card';
                if (isMine) card.classList.add('mine');
                if (isFull) card.classList.add('locked');
                if (allDone) card.classList.add('done');
                else if (scorerList.length > 0) card.classList.add('inprogress');

                scorersEl.innerHTML = scorerList.map(name => {
                    const done = completedScorers.includes(name);
                    return `${done ? '✓' : '…'} ${name}`;
                }).join('<br>');

                if (isFull && !isMine) {
                    statusEl.className = 'q-status status-locked';
                    statusEl.innerHTML = '<i class="fa-solid fa-ban"></i> 満員';
                } else if (allDone) {
                    statusEl.className = 'q-status status-done';
                    statusEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> 完了';
                } else if (scorerList.length > 0) {
                    statusEl.className = 'q-status status-inprogress';
                    statusEl.innerHTML = `<i class="fa-solid fa-pen"></i> 採点中 ${scorerList.length}/3`;
                } else {
                    statusEl.className = 'q-status status-open';
                    statusEl.innerHTML = '<i class="fa-regular fa-circle"></i> 未着手';
                }
            }
        }

        function enterQ(q) {
            const card = document.getElementById(`qcard-${q}`);
            if (card.classList.contains('locked')) return;
            localStorage.setItem('current_q', q);
            location.href = 'question.html';
        }

        initializeApp();