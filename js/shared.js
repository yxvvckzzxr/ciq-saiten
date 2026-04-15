/**
 * QuizOpus 共通ユーティリティ (shared.js)
 * 
 * 全ページで使い回す関数・定数を集約。
 * config.js, crypto.js の後に読み込むこと。
 *
 * === Realtime Architecture ===
 * Firebase JS SDK の WebSocket リアルタイム通信を使用。
 * 変更があった時だけデータを受信し、帯域を最小限に抑える。
 */

/** 受付番号を3桁ゼロ埋めする共通ヘルパー */
function padNum(n) { return String(n).padStart(3, '0'); }

// ============================================
//  Firebase Database リファレンス
// ============================================

const db = firebase.database();
const dbRef = (path) => db.ref(path);

// firebase.database.ServerValue.TIMESTAMP
const SERVER_TIMESTAMP = firebase.database.ServerValue.TIMESTAMP;

/**
 * Auth 認証完了を待つ。
 * セキュリティルール (auth != null) を通すため、
 * 各ページの初期化時に最初に呼ぶ。
 */
function waitForAuth() {
    return new Promise(resolve => {
        if (firebase.auth().currentUser) return resolve(firebase.auth().currentUser);
        const unsub = firebase.auth().onAuthStateChanged(user => {
            if (user) { unsub(); resolve(user); }
        });
    });
}

// ============================================
//  Database ヘルパー (SDK版 — インターフェース互換)
// ============================================

/**
 * データ取得 (一回だけ読み取り)
 * @param {string} path - 例: 'projects/xxx/publicSettings'
 * @returns {Promise<any>} data or null
 */
async function dbGet(path) {
    try {
        const snap = await dbRef(path).get();
        return snap.val();
    } catch (e) {
        if (e.code === 'PERMISSION_DENIED') { showDbAuthError(); }
        throw e;
    }
}

/**
 * データセット (PUT) — パス全体を上書き
 */
async function dbSet(path, data) {
    try {
        await dbRef(path).set(data);
        return data;
    } catch (e) {
        if (e.code === 'PERMISSION_DENIED') { showDbAuthError(); }
        throw e;
    }
}

/**
 * データ更新 (PATCH) — 既存データにマージ
 */
async function dbUpdate(path, data) {
    try {
        await dbRef(path).update(data);
        return data;
    } catch (e) {
        if (e.code === 'PERMISSION_DENIED') { showDbAuthError(); }
        throw e;
    }
}

/**
 * データ削除 (DELETE)
 */
async function dbRemove(path) {
    try {
        await dbRef(path).remove();
    } catch (e) {
        if (e.code === 'PERMISSION_DENIED') { showDbAuthError(); }
        throw e;
    }
}

/**
 * シャロー読み取り互換 (SDK版)
 * SDKにはshallow readがないため、全データを取得してキーだけのオブジェクトに変換。
 */
async function dbShallow(path) {
    const data = await dbGet(path);
    if (!data || typeof data !== 'object') return data;
    const result = {};
    for (const key of Object.keys(data)) result[key] = true;
    return result;
}

/**
 * クエリ (orderByChild + equalTo)
 */
async function dbQuery(path, orderBy, equalTo) {
    const snap = await dbRef(path).orderByChild(orderBy).equalTo(equalTo).get();
    return snap.val();
}

/**
 * SDK トランザクション（排他制御付き読み書き）
 * 4人目の滑り込み防止や受付番号の連番管理に使用。
 *
 * @param {string} path
 * @param {function} updateFn - 現在の値を受け取り新しい値を返す。undefined で中止。
 * @returns {Promise<{committed: boolean, value: any}>}
 */
async function dbTransaction(path, updateFn) {
    const result = await dbRef(path).transaction(updateFn);
    return { committed: result.committed, value: result.snapshot.val() };
}

// ============================================
//  リアルタイムリスナー（Poller 互換インターフェース）
//  WebSocket で変更を即座に受信。
//  Poller と同じ start()/stop()/restart() を持つ。
// ============================================

class Poller {
    /**
     * @param {string} path - Firebase パス
     * @param {function} callback - データ受信時のコールバック
     * @param {number} intervalMs - 互換性のため残すが使用しない
     */
    constructor(path, callback, intervalMs = 3000) {
        this.path = path;
        this._ref = dbRef(path);
        this.callback = callback;
        this.intervalMs = intervalMs; // 互換性のため
        this._active = false;
    }

    start() {
        if (this._active) return this;
        this._active = true;
        this._ref.on('value', (snap) => {
            if (this._active) this.callback(snap.val());
        }, (error) => {
            console.error(`Listener(${this.path}) error:`, error);
            if (error.code === 'PERMISSION_DENIED') showDbAuthError();
        });
        return this;
    }

    stop() {
        this._active = false;
        this._ref.off();
        return this;
    }

    restart() {
        this.stop();
        this.start();
        return this;
    }
}

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
 * 答案画像プレビューオーバーレイ
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
        <div id="preview-content" class="preview-overlay-content">
            <div class="text-muted-loader"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中...</div>
        </div>`;

    overlay.style.display = 'block';

    const answerData = await dbGet(`projects/${projectId}/protected/${secretHash}/answers/${entryNum}`);
    const pc = document.getElementById('preview-content');
    // Storage URL 優先、旧 Base64 フォールバック
    const imageUrl = answerData?.pageImageUrl || answerData?.pageImage;
    if (imageUrl) {
        pc.innerHTML = `<img src="${imageUrl}" alt="${name}" class="preview-image">`;
    } else {
        pc.innerHTML = '<div class="text-muted-center">ページ画像が保存されていません。管理画面から答案を再読み込みしてください。</div>';
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
        document.body.innerHTML = '<div class="auth-redirect">管理者としてプロジェクトに入室してください。3秒後にトップページへ戻ります。</div>';
        setTimeout(() => location.href = 'index.html', 3000);
        return null;
    }
    // プロジェクト削除を監視（全ページ自動対応）
    watchProjectDeletion(projectId);
    return { projectId, secretHash, scorerName, scorerRole };
}
// プロジェクト削除検知 — publicSettingsが消えたらログイン画面へ
function watchProjectDeletion(projectId) {
    if (!projectId) return;
    let initialized = false;
    dbRef(`projects/${projectId}/publicSettings`).on('value', snap => {
        if (!initialized) { initialized = true; return; } // 初回スキップ
        if (snap.val() === null) {
            showToast('このプロジェクトは削除されました。ログイン画面に戻ります。', 'error', 5000);
            session.clear();
            setTimeout(() => { location.href = 'index.html'; }, 2000);
        }
    });
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
            // WebSocket auto-reconnects and listeners resume automatically
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
            <div class="confirm-body">
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
        // 背景オーバーレイ (マスクはspotlightのboxShadowで行うため透明)
        this._backdrop = document.createElement('div');
        Object.assign(this._backdrop.style, {
            position: 'fixed', inset: '0', zIndex: '99980',
            background: 'transparent', transition: 'opacity 0.3s',
        });
        document.body.appendChild(this._backdrop);

        // スポットライト穴
        this._spotlight = document.createElement('div');
        Object.assign(this._spotlight.style, {
            position: 'fixed', zIndex: '99981',
            border: '2px solid rgba(59,130,246,0.6)', borderRadius: '12px',
            boxShadow: '0 0 0 99999px rgba(15, 23, 42, 0.5), 0 0 40px rgba(59,130,246,0.2)',
            transition: 'all 0.5s cubic-bezier(0.25, 1, 0.5, 1)',
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
                <div class="tour-step-header">
                    <span class="tour-step-badge">${stepNum} / ${total}</span>
                </div>
                <div class="tour-step-title">${step.title}</div>
                <div class="tour-step-text">${step.text}</div>
                <div class="tour-step-actions">
                    <button class="tour-skip">スキップ</button>
                    <button class="tour-next">${stepNum === total ? '完了' : '次へ →'}</button>
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

// ============================================
//  カスタムセレクト (CustomSelect)
//  ネイティブ <select class="custom-select"> を自動変換
// ============================================

class CustomSelect {
    static initAll() {
        document.querySelectorAll('select.custom-select').forEach(sel => {
            if (sel.dataset.csInit) return;
            new CustomSelect(sel);
        });
    }

    constructor(selectEl) {
        this.select = selectEl;
        this.select.dataset.csInit = '1';
        this.select.style.display = 'none';
        this.options = Array.from(this.select.options);
        this.searchable = this.options.length > 10;

        this._build();
        this._bindEvents();
    }

    _build() {
        // Wrapper
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'custom-dropdown';

        // Trigger button
        this.trigger = document.createElement('div');
        this.trigger.className = 'cd-trigger';
        this.trigger.setAttribute('tabindex', '0');
        this.trigger.setAttribute('role', 'combobox');
        this.trigger.innerHTML = `
            <span class="cd-label cd-placeholder">${this.options[0]?.text || '選択'}</span>
            <svg class="cd-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        `;
        this.labelSpan = this.trigger.querySelector('.cd-label');

        // Dropdown menu
        this.menu = document.createElement('div');
        this.menu.className = 'cd-menu';

        // Search (if many options)
        if (this.searchable) {
            const searchWrap = document.createElement('div');
            searchWrap.className = 'cd-search';
            searchWrap.innerHTML = '<input type="text" placeholder="検索..." class="cd-search-input">';
            this.menu.appendChild(searchWrap);
            this.searchInput = searchWrap.querySelector('input');
        }

        // Options
        this.optionEls = [];
        this.options.forEach((opt, i) => {
            if (i === 0 && !opt.value) return; // skip empty placeholder
            const div = document.createElement('div');
            div.className = 'cd-option';
            div.dataset.value = opt.value;
            div.textContent = opt.text;
            div.addEventListener('click', () => this._selectOption(div));
            this.menu.appendChild(div);
            this.optionEls.push(div);
        });

        // No match message
        this.noMatch = document.createElement('div');
        this.noMatch.className = 'cd-no-match';
        this.noMatch.textContent = '一致する項目がありません';
        this.noMatch.style.display = 'none';
        this.menu.appendChild(this.noMatch);

        // Assemble
        this.wrapper.appendChild(this.trigger);
        this.wrapper.appendChild(this.menu);
        this.select.parentNode.insertBefore(this.wrapper, this.select);
        this.wrapper.appendChild(this.select); // move hidden select inside

        // If select has a pre-selected value
        if (this.select.value) {
            const pre = this.optionEls.find(o => o.dataset.value === this.select.value);
            if (pre) this._selectOption(pre, true);
        }
    }

    _bindEvents() {
        // Toggle
        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggle();
        });

        // Keyboard
        this.trigger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggle(); }
            if (e.key === 'Escape') this._close();
            if (e.key === 'ArrowDown') { e.preventDefault(); this._open(); this._focusOption(0); }
        });

        // Search filter
        if (this.searchInput) {
            this.searchInput.addEventListener('input', () => this._filter());
            this.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') this._close();
                if (e.key === 'ArrowDown') { e.preventDefault(); this._focusOption(0); }
            });
        }

        // Click outside to close
        document.addEventListener('click', (e) => {
            if (!this.wrapper.contains(e.target)) this._close();
        });
    }

    _toggle() {
        if (this.wrapper.classList.contains('open')) {
            this._close();
        } else {
            this._open();
        }
    }

    _open() {
        // Close other dropdowns first
        document.querySelectorAll('.custom-dropdown.open').forEach(d => {
            if (d !== this.wrapper) d.classList.remove('open');
        });
        this.wrapper.classList.add('open');
        if (this.searchInput) {
            this.searchInput.value = '';
            this._filter();
            setTimeout(() => this.searchInput.focus(), 50);
        }
    }

    _close() {
        this.wrapper.classList.remove('open');
        this.trigger.focus();
    }

    _selectOption(optEl, silent = false) {
        // Deselect previous
        this.optionEls.forEach(o => o.classList.remove('selected'));
        optEl.classList.add('selected');

        // Update display
        this.labelSpan.textContent = optEl.textContent;
        this.labelSpan.classList.remove('cd-placeholder');

        // Sync native select
        this.select.value = optEl.dataset.value;
        this.select.dispatchEvent(new Event('change', { bubbles: true }));

        if (!silent) this._close();
    }

    _filter() {
        const q = this.searchInput.value.toLowerCase();
        let visible = 0;
        this.optionEls.forEach(o => {
            const match = o.textContent.toLowerCase().includes(q);
            o.classList.toggle('hidden', !match);
            if (match) visible++;
        });
        this.noMatch.style.display = visible === 0 ? 'block' : 'none';
    }

    _focusOption(index) {
        const visible = this.optionEls.filter(o => !o.classList.contains('hidden'));
        if (visible[index]) visible[index].focus();
    }

    /** 外部からvalueをセットする */
    setValue(value) {
        const opt = this.optionEls.find(o => o.dataset.value === value);
        if (opt) this._selectOption(opt, true);
    }

    /** 外部からリセットする */
    reset() {
        this.optionEls.forEach(o => o.classList.remove('selected'));
        this.labelSpan.textContent = this.options[0]?.text || '選択';
        this.labelSpan.classList.add('cd-placeholder');
        this.select.value = '';
    }
}


// ============================================
//  自動初期化
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    ConnectionMonitor.init();
    KeyboardShortcuts.init();
    CustomSelect.initAll();

    // Service Worker 登録（HTTPS環境のみ）
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
});
