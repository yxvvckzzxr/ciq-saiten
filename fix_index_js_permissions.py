import re
with open("js/index.js", "r") as f:
    content = f.read()

# Update createProject
old_create_set = """		// DB保存
		const newData = {
			publicSettings: {
				projectName: pName,
				publicKey: publicKeyJwk
			},
			entries: {}, // エントリー書き込みは公開領域
			protected: {
				[scorerHash]: {
					settings: { role: 'scorer', createdAt: firebase.database.ServerValue.TIMESTAMP }
				},
				[adminHash]: {
					settings: {
						adminCreator: name,
						scorerHash: scorerHash,
						encryptedPrivateKey: encryptedPriv
					}
				}
			}
		};

		await db.ref(`projects/${pid}`).set(newData);"""

new_create_set = """		// DB保存 (個別の権限エリアに対するマルチパスアップデートでPERMISSION_DENIEDを回避)
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

		await db.ref(`projects/${pid}`).update(updates);"""

content = content.replace(old_create_set, new_create_set)

# Update importProject
old_import_set = """		const newData = {
			publicSettings: { projectName: pName, publicKey: publicKeyJwk },
			entries: data.entries || {},
			protected: {
				[scorerHash]: {
					answers: data.answers || {},
					answers_text: data.answers_text || {},
					scores: data.scores || {},
					config: data.config || {},
					entryConfig: data.entryConfig || {},
					disclosure: data.disclosure || {},
					settings: { role: 'scorer', createdAt: firebase.database.ServerValue.TIMESTAMP }
				},
				[adminHash]: {
					settings: {
						adminCreator: name,
						scorerHash: scorerHash,
						encryptedPrivateKey: encryptedPriv
					}
				}
			}
		};

		await db.ref(`projects/${pid}`).set(newData);"""

new_import_set = """		const updates = {};
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

		await db.ref(`projects/${pid}`).update(updates);"""

content = content.replace(old_import_set, new_import_set)

with open("js/index.js", "w") as f:
    f.write(content)
