// disclosure.js — 成績照会（メールアドレス + パスワード認証）

const params = new URLSearchParams(location.search);
    const projectId = params.get('pid');

    if (!projectId) {
        document.querySelector('.page-container').innerHTML = '<div class="page-card page-disabled"><i class="fa-solid fa-ban"></i><p>プロジェクトが指定されていません。</p><p style="margin-top:8px;font-size:13px">正しいリンクからアクセスしてください。</p></div>';
    }

    async function init() {
        if (!projectId) return;
        await waitForAuth();

        // プロジェクト名を取得して表示
        try {
            let pName = await dbGet(`projects/${projectId}/publicSettings/projectName`);
            if (!pName) pName = await dbGet(`projects/${projectId}/settings/projectName`);
            document.getElementById('logo-title').textContent = pName || projectId;
            document.title = (pName || projectId) + ' - 成績照会';
        } catch(e) {
            document.getElementById('logo-title').textContent = projectId;
        }
    }

    async function checkDisclosure() {
        const email = document.getElementById('f-email').value.trim();
        const pw = document.getElementById('pw-input').value.trim();
        const errEl = document.getElementById('error-msg');
        const btn = document.getElementById('submit-btn');

        errEl.style.display = 'none';

        if (!email || !pw) {
            errEl.textContent = 'メールアドレスとパスワードを入力してください。';
            errEl.style.display = 'block'; return;
        }

        btn.disabled = true; btn.textContent = '確認中...';

        try {
            // メールアドレスのハッシュで検索
            const emailHash = await AppCrypto.hashPassword(email.toLowerCase());
            const entriesData = await dbQuery(`projects/${projectId}/entries`, 'emailHash', emailHash);

            if (!entriesData || Object.keys(entriesData).length === 0) {
                errEl.textContent = '該当するメールアドレスが見つかりません。';
                errEl.style.display = 'block'; btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-unlock"></i> 成績を確認する'; return;
            }

            let matched = false;
            let entryData = null;
            const pwHash = await AppCrypto.hashPassword(pw);

            for (const d of Object.values(entriesData)) {
                if (d.disclosurePw === pwHash || d.disclosurePw === pw) {
                    matched = true; entryData = d;
                }
            }

            if (!matched) {
                errEl.textContent = 'パスワードが正しくありません。';
                errEl.style.display = 'block'; btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-unlock"></i> 成績を確認する'; return;
            }

            const num = entryData.entryNumber;

            // 開示データ取得
            const disc = await dbGet(`projects/${projectId}/disclosure/${num}`);
            if (!disc) {
                errEl.textContent = '開示データがまだ生成されていません。管理者にお問い合わせください。';
                errEl.style.display = 'block'; btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-unlock"></i> 成績を確認する'; return;
            }

            showResult(disc);

        } catch(e) {
            errEl.textContent = 'エラーが発生しました。もう一度お試しください。';
            errEl.style.display = 'block';
        }
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-unlock"></i> 成績を確認する';
    }

    function showResult(disc) {
        document.getElementById('login-card').style.display = 'none';
        document.getElementById('result-card').style.display = 'block';
        document.getElementById('result-name').textContent = disc.displayName || '';
        document.getElementById('result-rank').textContent = disc.rank || '';
        document.getElementById('result-rank-sub').textContent = `/ ${disc.totalEntries || '?'}`;
        document.getElementById('result-score').textContent = disc.score;
        document.getElementById('result-total').textContent = `${disc.score} / ${disc.totalQuestions || 100}`;

        // 連答表示
        const streaksEl = document.getElementById('result-streaks');
        if (disc.streaks && disc.streaks.length > 0) {
            const show = disc.streaks.slice(0, 2);
            const streakItems = show.map((s, i) => 
                `<span class="streak-item"><span class="streak-label">${ordinal(i + 1)}</span><span class="streak-val">${s}</span></span>`
            ).join('');
            streaksEl.innerHTML = `<div class="streak-title">Streak</div><div class="streak-list">${streakItems}</div>`;
        } else {
            streaksEl.innerHTML = '';
        }
    }

    function ordinal(n) {
        const s = ['th','st','nd','rd'];
        const v = n % 100;
        return n + (s[(v-20)%10] || s[v] || s[0]);
    }

    function showLogin() {
        document.getElementById('result-card').style.display = 'none';
        document.getElementById('login-card').style.display = 'block';
    }

    // Enterキーで送信
    document.addEventListener('keydown', e => {
        if (e.key === 'Enter' && document.getElementById('login-card').style.display !== 'none') {
            checkDisclosure();
        }
    });

    init();