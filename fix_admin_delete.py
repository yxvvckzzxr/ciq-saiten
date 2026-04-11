import re
with open("js/admin.js", "r") as f:
    content = f.read()

old_delete = """        async function resetEntries() {
            if (confirm('名簿データを全て削除しますか？（答案や採点結果は残ります）')) {
                await db.ref(`projects/${projectId}/entries`).remove();
                showAdminToast('名簿データをリセットしました');
            }
        }

        async function deleteProject() {
            if (confirm('【危険】プロジェクトの全データを完全に削除し、ログイン画面に戻ります。\\n本当によろしいですか？')) {
                await db.ref(`projects/${projectId}`).remove(); 
                session.clear();
                location.href = 'index.html';
            }
        }"""

new_delete = """        async function resetEntries() {
            if (confirm('名簿データを全て削除しますか？（答案や採点結果は残ります）')) {
                await db.ref(`projects/${projectId}/entries`).remove();
                showAdminToast('名簿データをリセットしました');
            }
        }

        async function deleteProject() {
            if (confirm('【危険】プロジェクトの全データを完全に削除し、ログイン画面に戻ります。\\n本当によろしいですか？')) {
                const adminHash = session.get('adminHash');
                const updates = {};
                updates[`publicSettings`] = null;
                updates[`entries`] = null;
                updates[`protected/${secretHash}`] = null;
                if (adminHash && adminHash !== secretHash) {
                    updates[`protected/${adminHash}`] = null;
                }
                try {
                    await db.ref(`projects/${projectId}`).update(updates);
                } catch(e) { console.error(e); }
                session.clear();
                location.href = 'index.html';
            }
        }"""

content = content.replace(old_delete, new_delete)

with open("js/admin.js", "w") as f:
    f.write(content)
