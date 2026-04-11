
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
            <p>Firebaseのセキュリティルールが原因でデータが読み込めません。<br>（PERMISSION_DENIEDエラー）<br><br>管理者に連絡し、最新のルールがFirebase Consoleに適用されているか確認してください。</p>
            <button class="btn danger" onclick="location.href='index.html'">ログイン画面へ戻る</button>
        </div>
    `;
    document.body.appendChild(div);
}
const projectId = session.projectId;
        const secretHash = session.get("secretHash");
        const scorerName = session.scorerName;
        const scorerRole = session.scorerRole;

        if (!projectId || !scorerName) location.href = 'index.html';

        let totalQuestions = 100;

        async function initializeApp() {
            // プロジェクト設定を取得
            const snapConfig = await db.ref(`projects/${projectId}/protected/${secretHash}/config`).once('value');
            if (snapConfig.exists()) {
                totalQuestions = snapConfig.val().questionCount || 100;
            }
            const snapSettings = await db.ref(`projects/${projectId}/settings`).once('value');
            if (snapSettings.exists()) {
                const settings = snapSettings.val();
                document.getElementById('project-title').textContent = settings.projectName || '問題一覧';
            }

            // Firebaseのentriesから参加者情報を取得してマスタとして保持 (オプション)
            fetchEntriesMaster();

            document.getElementById('scorer-badge').textContent =
                `${scorerName}（${scorerRole === 'admin' ? '管理者' : '採点者'}）`;

            if (scorerRole === 'admin') {
                document.getElementById('admin-bar').style.display = 'inline-block';
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

            db.ref(`projects/${projectId}/protected/${secretHash}/scores`).on('value', snap => {
                updateGrid(snap.val() || {});
            });
        }

        function fetchEntriesMaster() {
            db.ref(`projects/${projectId}/entries`).once('value', async snap => {
                if (snap.exists()) {
                    const masterData = {};
                    const privJwkStr = session.get('privateKeyJwk');
                    let privJwk = null;
                    if (privJwkStr) {
                        try { privJwk = JSON.parse(privJwkStr); } catch(e){}
                    }

                    const children = [];
                    snap.forEach(c => children.push(c.val()));
                    
                    for (const v of children) {
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
                    localStorage.setItem('masterData', JSON.stringify(masterData));
                }
            });
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
                    statusEl.textContent = '満員';
                } else if (allDone) {
                    statusEl.className = 'q-status status-done';
                    statusEl.textContent = '完了';
                } else if (scorerList.length > 0) {
                    statusEl.className = 'q-status status-inprogress';
                    statusEl.textContent = `採点中 ${scorerList.length}/3`;
                } else {
                    statusEl.className = 'q-status status-open';
                    statusEl.textContent = '未着手';
                }
            }
        }

        function enterQ(q) {
            const card = document.getElementById(`qcard-${q}`);
            if (card.classList.contains('locked')) return;
            localStorage.setItem('current_q', q);
            location.href = 'question.html';
        }

        function logout() {
            session.clear();
            location.href = 'index.html';
        }

        initializeApp();