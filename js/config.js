// Firebase 共通設定
const firebaseConfig = {
  apiKey: "AIzaSyBddMg4lPD3PNMbFVgCANF3CSWhRubCWws",
  authDomain: "ciq-digital.firebaseapp.com",
  projectId: "ciq-digital",
  messagingSenderId: "863546263613",
  appId: "1:863546263613:web:bc5c52656b35ff74a0c254",
  measurementId: "G-N32TSS5J4J",
  databaseURL: "https://ciq-digital-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

// Firebase SDK初期化
let _authReadyPromise = Promise.resolve(null);
if (typeof firebase !== 'undefined') {
  firebase.initializeApp(firebaseConfig);
  // Anonymous Auth: ユーザーには見えないが、セキュリティルールで auth != null を満たす
  _authReadyPromise = firebase.auth().signInAnonymously().catch(e => {
    console.warn('Anonymous auth failed:', e);
    return null;
  });
}


// セッション管理ヘルパー（localStorageベースに統一）
const session = {
  get(key) { return localStorage.getItem(key); },
  set(key, val) { localStorage.setItem(key, val); },
  clear() {
    const projectId = localStorage.getItem('projectId');
    ['projectId', 'scorer_name', 'scorer_role', 'secretHash', 'adminHash', 'privateKeyJwk'].forEach(k => localStorage.removeItem(k));
    // masterData キャッシュも削除
    if (projectId) localStorage.removeItem(`masterData_${projectId}`);
  },
  get projectId() { return this.get('projectId'); },
  get scorerName() { return this.get('scorer_name'); },
  get scorerRole() { return this.get('scorer_role'); }
};

// メール通知設定 (AWS SES via Lambda)
// AWS セットアップ完了後に endpoint と apiKey を記入する
const EMAIL_CONFIG = {
  endpoint: 'https://x6fnhov5w5.execute-api.ap-northeast-1.amazonaws.com/send-email',
  apiKey: 'ciq2026ses',
};
// email.js より後に実行されるよう遅延初期化
document.addEventListener('DOMContentLoaded', () => {
  if (typeof CIQEmail !== 'undefined' && EMAIL_CONFIG.endpoint) {
    CIQEmail.configure(EMAIL_CONFIG);
  }
});
