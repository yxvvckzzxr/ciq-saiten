import re

def wrap_init(filepath):
    with open(filepath, "r") as f: content = f.read()
    
    error_gui_js = """
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
"""
    if "showDbAuthError" not in content:
        content = error_gui_js + content
    
    # Catching the unhandled promise rejection generically since initializeApp is called directly
    catch_block = """
window.addEventListener('unhandledrejection', function(event) {
    if (event.reason && event.reason.message && event.reason.message.includes('PERMISSION_DENIED')) {
        event.preventDefault(); // hide from console
        document.body.innerHTML = ''; // wipe loading
        showDbAuthError();
    }
});
"""
    if "unhandledrejection" not in content:
        content = catch_block + content
        
    with open(filepath, "w") as f: f.write(content)

wrap_init("js/admin.js")
wrap_init("js/judge.js")
wrap_init("js/question.js")

