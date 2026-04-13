/**
 * QuizOpus 共通ユーティリティ (shared.js)
 * 
 * 全ページで使い回す関数・定数を集約。
 * config.js, crypto.js の後に読み込むこと。
 *
 * === Zero-Cost Scale Architecture ===
 * すべてのデータベース通信を REST API (fetch) で行い、
 * WebSocket 接続数 (Spark: 100) の制限を完全に回避する。
 */

// ============================================
//  定数
// ============================================

// Firebase REST API ベースURL
const FIREBASE_REST_BASE = 'https://quziopus-default-rtdb.asia-southeast1.firebasedatabase.app';

// firebase.database.ServerValue.TIMESTAMP の REST 版
const SERVER_TIMESTAMP = { ".sv": "timestamp" };

// ============================================
//  REST API ヘルパー
// ============================================

/**
 * データ取得 (GET)
 * @param {string} path - 例: 'projects/xxx/publicSettings'
 * @returns {Promise<any>} data or null
 */
async function dbGet(path) {
    const res = await fetch(`${FIREBASE_REST_BASE}/${path}.json`);
    if (!res.ok) {
        if (res.status === 401 || res.status === 403) { showDbAuthError(); throw new Error('PERMISSION_DENIED'); }
        throw new Error(`dbGet(${path}) failed: ${res.status}`);
    }
    return await res.json();
}

/**
 * データセット (PUT) — パス全体を上書き
 */
async function dbSet(path, data) {
    const res = await fetch(`${FIREBASE_REST_BASE}/${path}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        if (res.status === 401 || res.status === 403) { showDbAuthError(); throw new Error('PERMISSION_DENIED'); }
        throw new Error(`dbSet(${path}) failed: ${res.status}`);
    }
    return await res.json();
}

/**
 * データ更新 (PATCH) — 既存データにマージ
 */
async function dbUpdate(path, data) {
    const res = await fetch(`${FIREBASE_REST_BASE}/${path}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        if (res.status === 401 || res.status === 403) { showDbAuthError(); throw new Error('PERMISSION_DENIED'); }
        throw new Error(`dbUpdate(${path}) failed: ${res.status}`);
    }
    return await res.json();
}

/**
 * データ削除 (DELETE)
 */
async function dbRemove(path) {
    const res = await fetch(`${FIREBASE_REST_BASE}/${path}.json`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`dbRemove(${path}) failed: ${res.status}`);
}

/**
 * シャロー読み取り (キーのみ高速取得)
 */
async function dbShallow(path) {
    const res = await fetch(`${FIREBASE_REST_BASE}/${path}.json?shallow=true`);
    if (!res.ok) throw new Error(`dbShallow(${path}) failed: ${res.status}`);
    return await res.json();
}

/**
 * クエリ (orderByChild + equalTo)
 */
async function dbQuery(path, orderBy, equalTo) {
    const eqParam = typeof equalTo === 'string' ? `"${equalTo}"` : equalTo;
    const url = `${FIREBASE_REST_BASE}/${path}.json?orderBy="${orderBy}"&equalTo=${eqParam}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`dbQuery(${path}) failed: ${res.status}`);
    return await res.json();
}

/**
 * ETag ベースのトランザクション（排他制御付き読み書き）
 * WebSocket 接続なしでアトミックな更新を実現する。
 * 4人目の滑り込み防止や受付番号の連番管理に使用。
 *
 * @param {string} path
 * @param {function} updateFn - 現在の値を受け取り新しい値を返す。undefined で中止。
 * @param {number} maxRetries
 * @returns {Promise<{committed: boolean, value: any}>}
 */
async function dbTransaction(path, updateFn, maxRetries = 25) {
    const url = `${FIREBASE_REST_BASE}/${path}.json`;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const res = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' } });
        if (!res.ok) throw new Error(`dbTransaction GET failed: ${res.status}`);
        const etag = res.headers.get('ETag');
        const currentVal = await res.json();
        const newVal = updateFn(currentVal);
        if (newVal === undefined) return { committed: false, value: currentVal };

        const putRes = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'if-match': etag },
            body: JSON.stringify(newVal)
        });
        if (putRes.ok) {
            return { committed: true, value: newVal };
        }
        if (putRes.status === 412) {
            // 指数バックオフ + ジッター（200人同時エントリーでも衝突を分散）
            const baseDelay = Math.min(50 * Math.pow(2, attempt), 2000);
            const jitter = Math.random() * baseDelay;
            await new Promise(r => setTimeout(r, baseDelay + jitter));
            continue;
        }
        throw new Error(`dbTransaction PUT failed: ${putRes.status}`);
    }
    throw new Error('dbTransaction: リトライ回数超過。時間を置いて再度お試しください。');
}

// ============================================
//  ポーリング（リアルタイム同期の代替）
//  3〜5秒間隔でデータを取得し、WebSocket 接続ゼロを実現
// ============================================

class Poller {
    /**
     * @param {string} path - Firebase パス
     * @param {function} callback - データ受信時のコールバック
     * @param {number} intervalMs - ポーリング間隔 (デフォルト 3000ms)
     */
    constructor(path, callback, intervalMs = 3000) {
        this.path = path;
        this.callback = callback;
        this.intervalMs = intervalMs;
        this._timerId = null;
        this._active = false;
        this._failCount = 0;
        this._lastETag = null;      // 帯域最適化: 変更なしなら 304 で応答を節約
        this._notifiedError = false;
    }

    async _tick() {
        if (!this._active) return;
        try {
            // ETag 条件付き GET で帯域節約（データ未変更時は 304 → コールバック不要）
            const headers = {};
            if (this._lastETag) headers['If-None-Match'] = this._lastETag;
            headers['X-Firebase-ETag'] = 'true';

            const res = await fetch(`${FIREBASE_REST_BASE}/${this.path}.json`, { headers });

            if (res.status === 304) {
                // データ変更なし → スキップ（帯域節約）
            } else if (res.ok) {
                this._lastETag = res.headers.get('ETag');
                const data = await res.json();
                this.callback(data);
            } else if (res.status === 401 || res.status === 403) {
                showDbAuthError();
                this._active = false;
                return;
            } else {
                throw new Error(`HTTP ${res.status}`);
            }
            // 成功 → 連続失敗カウンタをリセット
            if (this._failCount > 0) {
                this._failCount = 0;
                if (this._notifiedError) {
                    this._notifiedError = false;
                    if (typeof showToast === 'function') showToast('通信が回復しました', 'success');
                }
            }
        } catch (e) {
            this._failCount++;
            console.error(`Poller(${this.path}) fail #${this._failCount}:`, e);
            if (this._failCount >= 3 && !this._notifiedError) {
                this._notifiedError = true;
                if (typeof showToast === 'function') showToast('サーバーとの通信に問題が発生しています', 'error', 8000);
            }
        }
        if (this._active) {
            this._timerId = setTimeout(() => this._tick(), this.intervalMs);
        }
    }

    start() {
        if (this._active) return this;
        this._active = true;
        this._tick(); // 初回は即座に取得
        return this;
    }

    stop() {
        this._active = false;
        if (this._timerId) { clearTimeout(this._timerId); this._timerId = null; }
        return this;
    }

    restart() { this.stop(); this._lastETag = null; this.start(); return this; }
}

// ============================================
//  アイドル監視 & 通信管理
//  無操作時にポーリングを停止して帯域を節約
// ============================================

const IdleManager = {
    _pollers: [],
    _idleTimer: null,
    _visTimer: null,
    _slowTimer: null,
    _paused: false,
    _slow: false,
    IDLE_MS: 10 * 60 * 1000,    // 10分無操作で通信停止
    SLOW_MS: 30 * 1000,          // 30秒無操作でポーリング間隔を倍に

    register(poller) { this._pollers.push(poller); },

    init() {
        // タブ切替監視
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this._visTimer = setTimeout(() => {
                    if (document.hidden) this.pause();
                }, 60000); // 裏に回って60秒後に停止
            } else {
                clearTimeout(this._visTimer);
                if (this._paused) this.resume();
                this.resetIdle();
            }
        });
        // ユーザー操作監視
        ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
            document.addEventListener(evt, () => {
                if (this._paused) this.resume();
                if (this._slow) this._restoreSpeed();
                this.resetIdle();
            }, { passive: true });
        });
        this.resetIdle();
    },

    resetIdle() {
        if (this._idleTimer) clearTimeout(this._idleTimer);
        if (this._slowTimer) clearTimeout(this._slowTimer);
        this._idleTimer = setTimeout(() => this.pause(), this.IDLE_MS);
        // 30秒操作なし → ポーリング間隔を倍にして帯域節約
        this._slowTimer = setTimeout(() => this._enterSlow(), this.SLOW_MS);
    },

    _enterSlow() {
        if (this._slow || this._paused) return;
        this._slow = true;
        this._pollers.forEach(p => {
            p._origInterval = p._origInterval || p.intervalMs;
            p.intervalMs = p._origInterval * 2;
        });
    },

    _restoreSpeed() {
        this._slow = false;
        this._pollers.forEach(p => {
            if (p._origInterval) { p.intervalMs = p._origInterval; }
        });
    },

    pause() {
        if (this._paused) return;
        this._paused = true;
        this._pollers.forEach(p => p.stop());
        if (typeof showToast === 'function') showToast('無操作のため通信を一時停止しました。画面を操作すると再開します。', 'info', 15000);
    },

    resume() {
        if (!this._paused) return;
        this._paused = false;
        this._slow = false;
        this._pollers.forEach(p => {
            if (p._origInterval) { p.intervalMs = p._origInterval; }
            p.start();
        });
    }
};

// ============================================
//  共通UIユーティリティ
// ============================================

/**
 * データベース認証エラー表示
 * PERMISSION_DENIED 時に呼び出す共通オーバーレイ
 */
function showDbAuthError() {
    const div = document.createElement('div');
    div.className = 'error-overlay';
    div.innerHTML = `
        <div class="error-dialog">
            <h2><i class="fa-solid fa-triangle-exclamation"></i> データベース通信拒否</h2>
            <p>データベースへの接続が拒否されました。<br><br><br>運営者にお問い合わせください。</p>
            <button class="btn danger" onclick="location.href='index.html'"><i class="fa-solid fa-arrow-left"></i> ログイン画面へ戻る</button>
        </div>
    `;
    document.body.appendChild(div);
}

/**
 * PERMISSION_DENIED の自動ハンドリング
 */
window.addEventListener('unhandledrejection', function(event) {
    if (event.reason && event.reason.message && event.reason.message.includes('PERMISSION_DENIED')) {
        event.preventDefault();
        document.body.innerHTML = '';
        showDbAuthError();
    }
});

/**
 * ログアウト — セッションを破棄してトップへ
 */
function logout() {
    session.clear();
    location.href = 'index.html';
}

/**
 * masterData をローカルストレージから取得
 * @param {string} projectId
 * @returns {Object} { [entryNumber]: { name, affiliation?, grade? } }
 */
function getMasterData(projectId) {
    try {
        return JSON.parse(localStorage.getItem(`masterData_${projectId}`) || '{}');
    } catch (e) {
        return {};
    }
}

/**
 * 答案画像プレビューオーバーレイ (REST版)
 * question.html / conflict.html で共通利用
 */
async function showPreview(projectId, secretHash, entryNum) {
    let overlay = document.getElementById('preview-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'preview-overlay';
        overlay.className = 'preview-overlay';
        document.body.appendChild(overlay);
    }
    const masterData = getMasterData(projectId);
    const name = masterData[entryNum]?.name || `受付番号 ${entryNum}`;

    overlay.innerHTML = `
        <div class="preview-header">
            <h2><i class="fa-solid fa-file-image"></i> ${name} の解答用紙</h2>
            <button class="preview-close" onclick="document.getElementById('preview-overlay').style.display='none'">✕ 閉じる</button>
        </div>
        <div id="preview-content" style="text-align:center">
            <div style="color:#aaa"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中...</div>
        </div>`;
    overlay.style.display = 'block';

    const answerData = await dbGet(`projects/${projectId}/protected/${secretHash}/answers/${entryNum}`);
    const pc = document.getElementById('preview-content');
    // Storage URL 優先、旧 Base64 フォールバック
    const imageUrl = answerData?.pageImageUrl || answerData?.pageImage;
    if (imageUrl) {
        pc.innerHTML = `<img src="${imageUrl}" alt="${name}" style="max-width:100%;max-height:85vh;border-radius:8px;background:white;box-shadow:0 4px 24px rgba(0,0,0,0.5)">`;
    } else {
        pc.innerHTML = '<div style="color:#aaa;padding:40px">ページ画像が保存されていません。管理画面から答案を再読み込みしてください。</div>';
    }
}

// Escキーでプレビュー/メニューを閉じる
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        const o = document.getElementById('preview-overlay');
        if (o) o.style.display = 'none';
        const panel = document.getElementById('menu-panel');
        if (panel && panel.classList.contains('open')) toggleMenu();
    }
});

/**
 * スライドパネルメニューの開閉
 */
function toggleMenu() {
    const panel = document.getElementById('menu-panel');
    const backdrop = document.getElementById('menu-backdrop');
    if (!panel || !backdrop) return;
    const isOpen = panel.classList.contains('open');
    panel.classList.toggle('open', !isOpen);
    backdrop.classList.toggle('active', !isOpen);
    document.body.style.overflow = isOpen ? '' : 'hidden';
}

/**
 * 認証チェック。セッション不正なら index.html へリダイレクト。
 * @param {Object} opts
 * @param {boolean} [opts.requireAdmin=false] - admin ロール必須か
 * @returns {{ projectId, secretHash, scorerName, scorerRole }} セッション情報
 */
function requireAuth(opts = {}) {
    const projectId = session.projectId;
    const secretHash = session.get('secretHash');
    const scorerName = session.scorerName;
    const scorerRole = session.scorerRole;

    if (!projectId || !scorerName) {
        location.href = 'index.html';
        return null;
    }
    if (opts.requireAdmin && scorerRole !== 'admin') {
        document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#f87171;font-weight:bold;">管理者としてプロジェクトに入室してください。3秒後にトップページへ戻ります。</div>';
        setTimeout(() => location.href = 'index.html', 3000);
        return null;
    }
    return { projectId, secretHash, scorerName, scorerRole };
}

/**
 * 統一トースト通知
 * @param {string} msg - 表示メッセージ
 * @param {'success'|'error'|'info'} [type='info'] - 通知タイプ
 * @param {number} [duration=3000] - 表示時間(ms)
 */
function showToast(msg, type = 'info', duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
    toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${msg}</span>`;
    container.appendChild(toast);
    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        toast.addEventListener('transitionend', () => toast.remove());
    }, duration);
}

/**
 * 統一確認ダイアログ
 * @param {string} message - 確認メッセージ
 * @param {string} [confirmText='削除する'] - 確認ボタンテキスト
 * @returns {Promise<boolean>}
 */
function showConfirm(message, confirmText = '削除する') {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';

        overlay.innerHTML = `
            <div class="confirm-dialog glass-panel">
                <i class="fa-solid fa-triangle-exclamation confirm-icon"></i>
                <div class="confirm-message">${message}</div>
                <div class="confirm-actions">
                    <button class="btn secondary confirm-cancel">キャンセル</button>
                    <button class="btn danger confirm-ok">${confirmText}</button>
                </div>
            </div>
        `;

        overlay.querySelector('.confirm-cancel').onclick = () => { overlay.remove(); resolve(false); };
        overlay.querySelector('.confirm-ok').onclick = () => { overlay.remove(); resolve(true); };
        overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
        document.body.appendChild(overlay);
        overlay.querySelector('.confirm-ok').focus();
    });
}

// ============================================
//  オフライン/オンライン検知
//  ネット断を即座に検知し、復帰後に自動回復
// ============================================

const ConnectionMonitor = {
    _offlineBanner: null,
    _onlineBanner: null,
    _wasOffline: false,

    init() {
        // バナー要素を生成
        this._offlineBanner = document.createElement('div');
        this._offlineBanner.className = 'offline-banner';
        this._offlineBanner.innerHTML = '<i class="fa-solid fa-wifi"></i> インターネット接続が切断されました';
        document.body.appendChild(this._offlineBanner);

        this._onlineBanner = document.createElement('div');
        this._onlineBanner.className = 'online-banner';
        this._onlineBanner.innerHTML = '<i class="fa-solid fa-check-circle"></i> 接続が回復しました';
        document.body.appendChild(this._onlineBanner);

        window.addEventListener('offline', () => this._goOffline());
        window.addEventListener('online', () => this._goOnline());

        // 初期状態チェック
        if (!navigator.onLine) this._goOffline();
    },

    _goOffline() {
        this._wasOffline = true;
        this._offlineBanner.classList.add('visible');
        this._onlineBanner.classList.remove('visible');
    },

    _goOnline() {
        this._offlineBanner.classList.remove('visible');
        if (this._wasOffline) {
            this._onlineBanner.classList.add('visible');
            setTimeout(() => this._onlineBanner.classList.remove('visible'), 3000);
            // ポーラーを再起動してデータを即座に同期
            if (typeof IdleManager !== 'undefined' && IdleManager._pollers) {
                IdleManager._pollers.forEach(p => { if (p._active) p.restart(); });
            }
        }
    }
};

// ============================================
//  キーボードショートカット
//  ? でヘルプ表示。各ページでショートカットを追加登録可能。
// ============================================

const KeyboardShortcuts = {
    _shortcuts: [],
    _modalEl: null,

    /**
     * ショートカット登録
     * @param {string} key - キー ('?' 'g' 'Escape' など)
     * @param {string} description - 説明
     * @param {function} handler - コールバック
     * @param {object} opts - { ctrl, shift, alt }
     */
    register(key, description, handler, opts = {}) {
        this._shortcuts.push({ key, description, handler, ...opts });
    },

    init() {
        // デフォルト: ? でヘルプ表示
        this.register('?', 'ショートカット一覧を表示', () => this.toggleHelp(), { shift: true });
        this.register('Escape', 'モーダルを閉じる', () => this._closeHelp());

        document.addEventListener('keydown', (e) => {
            // 入力中は無視
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;

            for (const s of this._shortcuts) {
                const keyMatch = e.key === s.key || e.key.toLowerCase() === s.key.toLowerCase();
                const ctrlMatch = !s.ctrl || (e.ctrlKey || e.metaKey);
                const shiftMatch = !s.shift || e.shiftKey;
                const altMatch = !s.alt || e.altKey;
                if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
                    e.preventDefault();
                    s.handler();
                    return;
                }
            }
        });
    },

    toggleHelp() {
        if (this._modalEl) { this._closeHelp(); return; }
        const backdrop = document.createElement('div');
        backdrop.className = 'kbd-modal-backdrop';
        backdrop.innerHTML = `
            <div class="kbd-modal">
                <h3><i class="fa-solid fa-keyboard"></i> キーボードショートカット</h3>
                ${this._shortcuts
                    .filter(s => s.key !== 'Escape')
                    .map(s => `
                        <div class="kbd-row">
                            <span>${s.description}</span>
                            <span>${s.shift ? '<kbd>Shift</kbd> + ' : ''}${s.ctrl ? '<kbd>Ctrl</kbd> + ' : ''}<kbd>${s.key}</kbd></span>
                        </div>
                    `).join('')}
            </div>
        `;
        backdrop.addEventListener('click', e => { if (e.target === backdrop) this._closeHelp(); });
        document.body.appendChild(backdrop);
        requestAnimationFrame(() => backdrop.classList.add('visible'));
        this._modalEl = backdrop;
    },

    _closeHelp() {
        if (!this._modalEl) return;
        this._modalEl.classList.remove('visible');
        setTimeout(() => { this._modalEl?.remove(); this._modalEl = null; }, 200);
    }
};

// ============================================
//  スケルトンローダー生成ユーティリティ
// ============================================

function renderSkeleton(container, rows = 5) {
    container.innerHTML = Array.from({ length: rows }, () => `
        <div class="skeleton-row">
            <div class="skeleton skeleton-avatar"></div>
            <div style="flex:1">
                <div class="skeleton skeleton-text"></div>
                <div class="skeleton skeleton-text short"></div>
            </div>
        </div>
    `).join('');
}

function renderSkeletonCards(container, count = 6) {
    container.innerHTML = Array.from({ length: count }, () =>
        '<div class="skeleton skeleton-card"></div>'
    ).join('');
}

// ============================================
//  インタラクティブチュートリアル (TourGuide)
//  ステップバイステップでUI要素をハイライトしてガイド
// ============================================

class TourGuide {
    /**
     * @param {string} tourId - ツアー識別子（ localStorage 保存用）
     * @param {Array<{selector: string, title: string, text: string, position?: string}>} steps
     */
    constructor(tourId, steps) {
        this.tourId = tourId;
        this.steps = steps;
        this.currentStep = 0;
        this._backdrop = null;
        this._spotlight = null;
        this._tooltip = null;
    }

    /** 未完了の場合に自動開始 */
    autoStart(delay = 1000) {
        if (localStorage.getItem(`tour_${this.tourId}`)) return;
        setTimeout(() => this.start(), delay);
    }

    start() {
        this.currentStep = 0;
        this._createOverlay();
        this._showStep();
    }

    _createOverlay() {
        // 背景オーバーレイ
        this._backdrop = document.createElement('div');
        Object.assign(this._backdrop.style, {
            position: 'fixed', inset: '0', zIndex: '99980',
            background: 'rgba(0,0,0,0.65)', transition: 'opacity 0.3s',
        });
        document.body.appendChild(this._backdrop);

        // スポットライト穴
        this._spotlight = document.createElement('div');
        Object.assign(this._spotlight.style, {
            position: 'fixed', zIndex: '99981',
            border: '3px solid #3b82f6', borderRadius: '12px',
            boxShadow: '0 0 0 99999px rgba(0,0,0,0.65), 0 0 30px rgba(59,130,246,0.5)',
            transition: 'all 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
            pointerEvents: 'none',
        });
        document.body.appendChild(this._spotlight);

        // ツールチップ
        this._tooltip = document.createElement('div');
        Object.assign(this._tooltip.style, {
            position: 'fixed', zIndex: '99982',
            background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '14px', padding: '20px 24px',
            maxWidth: '340px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            color: '#f8fafc', fontFamily: "'Inter','Noto Sans JP',sans-serif",
            transition: 'all 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
            opacity: '0', transform: 'translateY(8px)',
        });
        document.body.appendChild(this._tooltip);

        // ESCで終了
        this._escHandler = (e) => { if (e.key === 'Escape') this.end(); };
        document.addEventListener('keydown', this._escHandler);
    }

    _showStep() {
        const step = this.steps[this.currentStep];
        if (!step) { this.end(); return; }

        const el = document.querySelector(step.selector);
        if (!el) { this.next(); return; }

        // 要素をスクロールして表示
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        setTimeout(() => {
            const rect = el.getBoundingClientRect();
            const pad = 8;

            // スポットライト位置
            Object.assign(this._spotlight.style, {
                top: (rect.top - pad) + 'px',
                left: (rect.left - pad) + 'px',
                width: (rect.width + pad * 2) + 'px',
                height: (rect.height + pad * 2) + 'px',
            });

            // ツールチップ構築
            const stepNum = this.currentStep + 1;
            const total = this.steps.length;
            this._tooltip.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <span style="background:rgba(59,130,246,0.15);color:#60a5fa;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;">${stepNum} / ${total}</span>
                </div>
                <div style="font-size:15px;font-weight:700;margin-bottom:6px;">${step.title}</div>
                <div style="font-size:13px;color:#94a3b8;line-height:1.6;margin-bottom:16px;">${step.text}</div>
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button class="tour-skip" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:#94a3b8;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">スキップ</button>
                    <button class="tour-next" style="padding:8px 20px;border-radius:8px;border:none;background:#3b82f6;color:white;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">${stepNum === total ? '完了' : '次へ →'}</button>
                </div>
            `;

            // ツールチップ位置（要素の下 or 上）
            const pos = step.position || 'bottom';
            if (pos === 'bottom' || rect.top < 200) {
                Object.assign(this._tooltip.style, {
                    top: (rect.bottom + pad + 12) + 'px',
                    left: Math.max(16, Math.min(rect.left, window.innerWidth - 360)) + 'px',
                });
            } else {
                Object.assign(this._tooltip.style, {
                    top: (rect.top - pad - 12 - this._tooltip.offsetHeight) + 'px',
                    left: Math.max(16, Math.min(rect.left, window.innerWidth - 360)) + 'px',
                });
            }

            this._tooltip.style.opacity = '1';
            this._tooltip.style.transform = 'translateY(0)';

            // ボタンイベント
            this._tooltip.querySelector('.tour-skip').onclick = () => this.end();
            this._tooltip.querySelector('.tour-next').onclick = () => this.next();
        }, 300);
    }

    next() {
        this.currentStep++;
        if (this.currentStep >= this.steps.length) {
            this.end();
        } else {
            this._tooltip.style.opacity = '0';
            this._tooltip.style.transform = 'translateY(8px)';
            setTimeout(() => this._showStep(), 200);
        }
    }

    end() {
        localStorage.setItem(`tour_${this.tourId}`, '1');
        document.removeEventListener('keydown', this._escHandler);
        [this._backdrop, this._spotlight, this._tooltip].forEach(el => {
            if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }
        });
    }
}

// ============================================
//  自動初期化
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    ConnectionMonitor.init();
    KeyboardShortcuts.init();

    // Service Worker 登録（HTTPS環境のみ）
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
});
