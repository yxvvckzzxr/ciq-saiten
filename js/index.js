
function generateStrongPassword() {
	const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	const lower = 'abcdefghijklmnopqrstuvwxyz';
	const num = '0123456789';
	const all = upper + lower + num + '!@#';
	let pwd = '';
	pwd += upper[Math.floor(Math.random() * upper.length)];
	pwd += lower[Math.floor(Math.random() * lower.length)];
	pwd += num[Math.floor(Math.random() * num.length)];
	for(let i = 3; i < 12; i++) {
		pwd += all[Math.floor(Math.random() * all.length)];
	}
	return pwd.split('').sort(() => 0.5 - Math.random()).join('');
}



let currentTab = 'join';

function setTab(tab) {
	currentTab = tab;
	document.getElementById('tab-join').className = tab === 'join' ? 'tab active' : 'tab';
	document.getElementById('tab-create').className = tab === 'create' ? 'tab active' : 'tab';
	
	

	document.getElementById('section-join').style.display = tab === 'join' ? 'block' : 'none';
	document.getElementById('section-create').style.display = tab === 'create' ? 'block' : 'none';
	document.getElementById('section-import').style.display = tab === 'import' ? 'block' : 'none';
}

function showError(msg) {
	const el = document.getElementById('status-msg');
	el.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + msg;
	el.style.display = 'block';
	setTimeout(() => el.style.display = 'none', 5000);
}

function togglePassword(id, iconId) {
	const input = document.getElementById(id);
	const icon = document.getElementById(iconId);
	if (input.type === "password") {
		input.type = "text";
		if (icon) { icon.classList.remove('fa-eye'); icon.classList.add('fa-eye-slash'); }
	} else {
		input.type = "password";
		if (icon) { icon.classList.remove('fa-eye-slash'); icon.classList.add('fa-eye'); }
	}
}

async function copyToClipboard(id, btn) {
	const input = document.getElementById(id);
	try {
		await navigator.clipboard.writeText(input.value);
		const orig = btn.innerHTML;
		btn.innerHTML = '<i class="fa-solid fa-check"></i>';
		setTimeout(() => btn.innerHTML = orig, 1500);
	} catch (err) {
		showError('コピーに失敗しました');
	}
}

function generateSecureId() {
	return [1, 2, 3, 4].map(() => Math.random().toString(36).substring(2, 6).padStart(4, '0')).join('-');
}

async function joinProject() {
	const pid = document.getElementById('join-id').value.trim();
	const pwd = document.getElementById('join-password').value;
	const name = document.getElementById('join-name').value.trim();
	const btn = document.getElementById('login-btn');

	if (!pid || !pwd || !name) {
		showError('全ての項目を入力してください');
		return;
	}

	btn.disabled = true;
	btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 認証中...';

	try {
		// まず公開設定が存在するか確認する
		const snapPub = await db.ref(`projects/${pid}/publicSettings`).once('value');
		if (!snapPub.exists()) {
			// 旧バージョンとの互換性チェック
			const snapOld = await db.ref(`projects/${pid}/settings`).once('value');
			if (snapOld.exists()) {
				// 旧システムのログイン
				const settings = snapOld.val();
				const pwdHash = await AppCrypto.hashPassword(pwd);
				if (settings.passwordHash ? settings.passwordHash !== pwdHash : settings.password !== pwd) {
					throw new Error('パスワードが間違っています。');
				}
				session.set('projectId', pid);
				session.set('scorer_name', name);
				session.set('scorer_role', 'admin');
				location.href = 'admin.html';
				return;
			}
			throw new Error('指定されたプロジェクトIDが見つかりません');
		}

		// 新バージョンのログイン判定 (入力されたパスワードのハッシュで探る)
		const hash = await AppCrypto.hashPassword(pwd);

		// Admin判定
		const snapAdmin = await db.ref(`projects/${pid}/protected/${hash}/settings`).once('value');
		if (snapAdmin.exists()) {
			const adminConfig = snapAdmin.val();
			session.set('projectId', pid);
			session.set('scorer_name', name);
			session.set('scorer_role', 'admin');
			session.set('secretHash', adminConfig.scorerHash); // 採点者領域へのアクセス権
			session.set('adminHash', hash); // 管理者領域へのアクセス権

			// PII復号用に暗号化された秘密鍵を一時的に解読してセッションへ
			try {
				const privJwkStr = await AppCrypto.decryptAES(adminConfig.encryptedPrivateKey, pwd);
				session.set('privateKeyJwk', privJwkStr);
			} catch (e) {
				console.error("Failed to decrypt private key");
			}
			location.href = 'admin.html';
			return;
		}

		// Scorer判定
		const snapScorer = await db.ref(`projects/${pid}/protected/${hash}/settings`).once('value');
		if (snapScorer.exists()) {
			session.set('projectId', pid);
			session.set('scorer_name', name);
			session.set('scorer_role', 'scorer');
			session.set('secretHash', hash); // 採点者領域へのアクセス権のみ
			location.href = 'judge.html';
			return;
		}

		throw new Error('アクセスコード または パスワードが間違っています');

	} catch (e) {
		showError(e.message);
		btn.disabled = false;
		btn.innerHTML = '部屋へ入る <i class="fa-solid fa-arrow-right-to-bracket"></i>';
	}
}

async function createProject() {
	const pName = document.getElementById('create-project-name').value.trim();
	const adminPwd = generateStrongPassword();
	const scorerPwd = generateStrongPassword();
	const name = document.getElementById('create-name').value.trim();
	const btn = document.getElementById('create-btn');

	if (!pName || !name) {
		showError('全ての項目を入力してください');
		return;
	}

	btn.disabled = true;
	btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 作成中...';

	try {
		const pid = generateSecureId();

		// ハッシュ計算
		const adminHash = await AppCrypto.hashPassword(adminPwd);
		const scorerHash = await AppCrypto.hashPassword(scorerPwd);

		// RSAキーペアの生成 (PIIのE2E暗号化用)
		const { publicKeyJwk, privateKeyJwk } = await AppCrypto.generateRSAKeyPair();

		// 秘密鍵を管理者パスワードでAES暗号化
		const encryptedPriv = await AppCrypto.encryptAES(JSON.stringify(privateKeyJwk), adminPwd);

		// DB保存 (個別の権限エリアに対するマルチパスアップデートでPERMISSION_DENIEDを回避)
		const updates = {};
		updates[`publicSettings`] = {
			projectName: pName,
			publicKey: publicKeyJwk
		};
		// entriesは空なので初期化不要
		updates[`protected/${scorerHash}/settings`] = {
			role: 'scorer',
			createdAt: firebase.database.ServerValue.TIMESTAMP
		};
		updates[`protected/${adminHash}/settings`] = {
			adminCreator: name,
			scorerHash: scorerHash,
			encryptedPrivateKey: encryptedPriv
		};

		await db.ref(`projects/${pid}`).update(updates);

		// セッションセットアップ
		session.set('projectId', pid);
		session.set('scorer_name', name);
		session.set('scorer_role', 'admin');
		session.set('secretHash', scorerHash);
		session.set('adminHash', adminHash);
		session.set('privateKeyJwk', JSON.stringify(privateKeyJwk));

		// UIDisplay
		document.getElementById('tabs-container').style.display = 'none';
		document.getElementById('section-create').style.display = 'none';
		document.getElementById('section-success').style.display = 'block';
		document.getElementById('success-id').value = pid;
		document.getElementById('success-admin-pwd').value = adminPwd;
		document.getElementById('success-pwd').value = scorerPwd;

	} catch (e) {
		showError('作成に失敗しました: ' + e.message);
		btn.disabled = false;
		btn.innerHTML = '新しいプロジェクトを作成 <i class="fa-solid fa-plus"></i>';
	}
}

async function importProject() {
	const file = document.getElementById('import-file').files[0];
	const pName = document.getElementById('import-project-name').value.trim();
	const adminPwd = generateStrongPassword();
	const scorerPwd = generateStrongPassword();
	const name = document.getElementById('import-name').value.trim();
	const btn = document.getElementById('import-btn');

	if (!file || !pName || !name) {
		showError('全ての項目を入力・選択してください');
		return;
	}

	btn.disabled = true;
	btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 復元中...';

	try {
		const text = await file.text();
		const data = JSON.parse(text);

		const pid = generateSecureId();
		const adminHash = await AppCrypto.hashPassword(adminPwd);
		const scorerHash = await AppCrypto.hashPassword(scorerPwd);

		const { publicKeyJwk, privateKeyJwk } = await AppCrypto.generateRSAKeyPair();
		const encryptedPriv = await AppCrypto.encryptAES(JSON.stringify(privateKeyJwk), adminPwd);

		const updates = {};
		updates[`publicSettings`] = { projectName: pName, publicKey: publicKeyJwk };
		if (data.entries) updates[`entries`] = data.entries;
		
		updates[`protected/${scorerHash}`] = {
			answers: data.answers || {},
			answers_text: data.answers_text || {},
			scores: data.scores || {},
			config: data.config || {},
			entryConfig: data.entryConfig || {},
			disclosure: data.disclosure || {},
			settings: { role: 'scorer', createdAt: firebase.database.ServerValue.TIMESTAMP }
		};
		
		updates[`protected/${adminHash}/settings`] = {
			adminCreator: name,
			scorerHash: scorerHash,
			encryptedPrivateKey: encryptedPriv
		};

		await db.ref(`projects/${pid}`).update(updates);

		session.set('projectId', pid);
		session.set('scorer_name', name);
		session.set('scorer_role', 'admin');
		session.set('secretHash', scorerHash);
		session.set('adminHash', adminHash);
		session.set('privateKeyJwk', JSON.stringify(privateKeyJwk));

		document.getElementById('tabs-container').style.display = 'none';
		document.getElementById('section-import').style.display = 'none';
		document.getElementById('section-success').style.display = 'block';
		document.getElementById('success-id').value = pid;
		document.getElementById('success-admin-pwd').value = adminPwd;
		document.getElementById('success-pwd').value = scorerPwd;

	} catch (e) {
		showError('インポートに失敗しました: ' + e.message);
		btn.disabled = false;
		btn.innerHTML = '復元して新設 <i class="fa-solid fa-upload"></i>';
	}
}

// エンターキー対応
let composing = false;
document.addEventListener('compositionstart', () => { composing = true; });
document.addEventListener('compositionend', () => {
	setTimeout(() => { composing = false; }, 500);
});
document.addEventListener('keyup', (e) => {
	if (e.key === 'Enter' && !composing) {
		if (currentTab === 'join') {
			joinProject();
		} else if (currentTab === 'create') {
			createProject();
		}
	}
});