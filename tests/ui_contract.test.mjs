import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PRODUCTION_PAGES = [
  '404.html',
  'admin.html',
  'checkin.html',
  'conflict.html',
  'entry.html',
  'entry_list.html',
  'help.html',
  'index.html',
  'judge.html',
  'my.html',
  'question.html',
  'terms.html',
];
function read(path) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function pageSources() {
  return PRODUCTION_PAGES.map((path) => ({ path, source: read(path) }));
}

describe('production UI contracts', () => {
  it('keeps centered layouts stable when the page scrollbar appears', () => {
    const css = read('css/design_system.css');
    expect(css).toMatch(/html\s*\{[\s\S]*?scrollbar-gutter:\s*stable both-edges;/);
  });

  it('uses synchronized shared asset versions on all production pages', () => {
    const pages = pageSources();
    const designVersions = pages.map(({ source }) => source.match(/css\/design_system\.css\?v=([^"']+)/)?.[1]);
    const pageVersions = pages.map(({ source }) => source.match(/css\/pages\.css\?v=([^"']+)/)?.[1]);
    expect(designVersions.every(Boolean)).toBe(true);
    expect(pageVersions.every(Boolean)).toBe(true);
    expect(new Set(designVersions).size).toBe(1);
    expect(new Set(pageVersions).size).toBe(1);

    const uiVersions = pages
      .map(({ source }) => source.match(/js\/ui\.js\?v=([^"']+)/)?.[1])
      .filter(Boolean);
    expect(new Set(uiVersions).size).toBe(1);

    const sharedVersions = pages
      .map(({ source }) => source.match(/js\/shared\.js\?v=([^"']+)/)?.[1])
      .filter(Boolean);
    expect(sharedVersions.length).toBeGreaterThan(0);
    expect(new Set(sharedVersions).size).toBe(1);
  });

  it('keeps participant email client fresh and failure-visible', () => {
    const entry = read('entry.html');
    const my = read('my.html');
    const entryEmailVersion = entry.match(/js\/email\.js\?v=([^"']+)/)?.[1];
    const myEmailVersion = my.match(/js\/email\.js\?v=([^"']+)/)?.[1];
    expect(entryEmailVersion).toBeTruthy();
    expect(myEmailVersion).toBe(entryEmailVersion);

    const email = read('js/email.js');
    const myJs = read('js/my.js');
    expect(email).toContain('function requireSendSuccess');
    expect(email).toContain("return requireSendSuccess(result, 'entry_cancelled')");
    expect(email).toContain("return requireSendSuccess(result, 'entry_edited')");
    expect(email).toContain("return requireSendSuccess(result, 'late_notice')");
    expect(myJs).toContain('async function sendParticipantActionEmail');
    expect(myJs).toContain('確認メールを送信できませんでした。');
  });

  it('shares one Google auth control between the login and invite screens', () => {
    const login = read('index.html');
    const invite = read('join.html');
    // 両画面が同じ認証シェルと同じボタン実装を使う。似たものを2つ作らない。
    for (const [path, source] of [['index.html', login], ['join.html', invite]]) {
      expect(source, `${path}: auth shell`).toContain('<body class="page-auth">');
      expect(source, `${path}: google button`).toMatch(/class="btn-google(?: [\w-]+)*"/);
      expect(source, `${path}: google mark`).toContain('assets/vendor/google/g_mark.svg');
      expect(source, `${path}: consistent label`).toContain('<span>Googleで続行</span>');
      expect(source, `${path}: no powered-by footer`).not.toContain('Powered by CIQ');
    }
    const markup = /<button[^>]*class="btn-google[^"]*"[\s\S]*?<\/button>/;
    const normalize = (html) => html.match(markup)[0]
      .replace(/\s+id="[^"]*"/, '')
      .replace(/class="btn-google[^"]*"/, 'class="btn-google"')
      .replace(/\s+/g, ' ');
    expect(normalize(login)).toBe(normalize(invite));

    // 見た目の一致は共有CSS 1箇所でのみ定義する。
    const designCss = read('css/design_system.css');
    expect(designCss).toContain('.btn-google {');
    expect(designCss).toContain('.btn-google:focus-visible {');
    expect(designCss).toContain('.btn-google[aria-busy="true"] {');
    expect(read('css/pages.css')).not.toContain('.btn-google');
  });

  it('preserves strict CSP-compatible markup', () => {
    for (const { path, source } of pageSources()) {
      const csp = source.match(/http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/i)?.[1];
      expect(csp, `${path}: CSP meta`).toBeTruthy();
      expect(csp, `${path}: unsafe-inline`).not.toContain("'unsafe-inline'");
      expect(source, `${path}: inline style`).not.toMatch(/\sstyle\s*=/i);
      expect(source, `${path}: inline event handler`).not.toMatch(/\son[a-z]+\s*=/i);
      expect(source, `${path}: inline script`).not.toMatch(/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i);
    }
  });

  it('keeps the required route and interaction hooks', () => {
    const required = {
      'admin.html': ['id="project-id-display"', 'id="menu-panel"', 'id="dt-picker"', 'data-tab-target=', 'data-action='],
      'index.html': ['class="page-auth"', 'id="index-mode-title"', 'class="btn-google"'],
      'entry.html': ['id="entry-form"', 'id="form-card"', 'id="send-code-btn"', 'id="reentry-note"'],
      'my.html': ['id="auth-card"', 'id="hub"', 'id="my-number"', 'id="reentry-section"', 'id="reentry-link"'],
      'entry_list.html': ['id="list-body"', 'id="page-title"'],
      'judge.html': ['id="q-grid"', 'id="admin-menu-section"', 'class="u-hidden"'],
      'question.html': ['class="page-question"', 'id="answer-grid"', 'id="mobile-action-bar"'],
      'conflict.html': ['id="conflict-grid"', 'id="conflict-action-bar"'],
      'checkin.html': ['id="camera-container"', 'id="result"'],
    };
    for (const [path, fragments] of Object.entries(required)) {
      const source = read(path);
      for (const fragment of fragments) expect(source, `${path}: ${fragment}`).toContain(fragment);
    }
  });

  it('keeps real selects enhanced by the shared accessible custom control', () => {
    const ui = read('js/ui.js');
    expect(ui).toContain('function initCustomSelects');
    expect(ui).toContain("button.setAttribute('aria-haspopup', 'listbox')");
    expect(ui).toContain("select.dispatchEvent(new Event('change', { bubbles: true }))");

    const help = read('help.html');
    expect(help.match(/<button[^>]+class="qa-question"/g)).toHaveLength(22);
    expect(help.match(/aria-expanded="false"/g)?.length).toBeGreaterThanOrEqual(22);
    expect(help.match(/role="region"/g)).toHaveLength(22);
  });

  it('keeps dynamic UI rendering safe and keyboard operable', () => {
    const ui = read('js/ui.js');
    expect(ui).toContain("dialog.setAttribute('role', 'alertdialog')");
    expect(ui).toContain("dialog.setAttribute('aria-modal', 'true')");
    expect(ui).toContain("text.textContent = String(msg || '')");
    expect(ui).not.toContain('dataset.originalHtml');

    const adminSettings = read('js/admin_settings.js');
    expect(adminSettings).not.toMatch(/picker\.style\.(?:left|top)/);
    expect(adminSettings).toContain("picker.classList.add('place-above')");

    for (const path of ['js/judge.js', 'js/question.js', 'js/conflict.js']) {
      const source = read(path);
      expect(source, `${path}: grid cell role`).toContain("setAttribute('role', 'gridcell')");
      expect(source, `${path}: roving tabindex`).toMatch(/tabIndex\s*=/);
      expect(source, `${path}: keyboard activation`).toMatch(/event\.key === 'Enter'|event\.key !== 'Enter'/);
    }
  });

  it('lets the entry verification code submit with Enter', () => {
    const entry = read('js/entry.js');
    expect(entry).toContain("event.key === 'Enter'");
    expect(entry).toContain('syncVerifyCodeFromBoxes();');
    expect(entry).toContain('verifyEmailCode();');
  });

  it('keeps conflict cards in question and entry order after resolution', () => {
    const conflict = read('js/conflict.js');
    expect(conflict).toContain('function compareConflictsByQuestionAndEntry');
    expect(conflict).toContain('currentConflicts = buildConflicts().sort(compareConflictsByQuestionAndEntry)');
    expect(conflict).not.toContain('aResolved');
    expect(conflict).not.toContain('bResolved');
  });

  it('keeps participant terms markdown extensions safe and styled', () => {
    const terms = read('js/terms.js');
    expect(terms).toContain('function stripFrontMatter');
    expect(terms).toContain('function parseCodeMeta');
    expect(terms).toContain('function appendSafeHtmlInline');
    expect(terms).toContain("block.type === 'definitionList'");
    expect(terms).not.toMatch(/innerHTML\s*=/);

    const css = read('css/pages.css');
    expect(css).toContain('.terms-task-checkbox:checked::after');
    expect(css).toContain('.terms-body pre[data-title]');
    expect(css).toContain('.terms-body small');
  });

  it('keeps canceled entries eligible for a new entry flow', () => {
    const my = read('js/my.js');
    expect(my).toContain("myEntryData.status !== 'canceled'");
    expect(my).toContain("entryUrl.searchParams.set('reentry', '1')");
    expect(my).toContain('新しい受付番号・パスワード・二次元コードが発行されます。');

    const entry = read('js/entry.js');
    expect(entry).toContain("const isReentry = params.get('reentry') === '1'");
    expect(entry).toContain("document.getElementById('reentry-note')");

    const migration = read('supabase/migrations/202607140004_create_entry_atomic_v2_only_writes.sql');
    expect(migration).toContain('entries_active_email_unique_v2_idx');
    expect(migration).toMatch(/where\s+status\s+<>\s+'canceled'/);
  });

  it('maps all product icon names to bundled Lucide icons', () => {
    const icons = read('js/icons.js');
    expect(icons).toContain('Lucide adapter');
    expect(icons).toContain('data-lucide');

    const aliasObjectSource = icons.match(/const ICON_ALIASES = (\{[\s\S]*?\n\});/)?.[1];
    expect(aliasObjectSource).toBeTruthy();
    const aliases = Function(`return (${aliasObjectSource})`)();
    const used = new Set();
    for (const { source } of pageSources()) {
      for (const match of source.matchAll(/data-icon="([^"]+)"/g)) used.add(match[1]);
    }
    for (const sourcePath of [
      'js/admin.js',
      'js/admin_scan.js',
      'js/admin_settings.js',
      'js/admin_stats.js',
      'js/checkin.js',
      'js/conflict.js',
      'js/entry.js',
      'js/entry_list.js',
      'js/index.js',
      'js/judge.js',
      'js/question.js',
      'js/ui.js',
    ]) {
      const source = read(sourcePath);
      for (const match of source.matchAll(/createIcon\('([^']+)'/g)) used.add(match[1]);
      for (const match of source.matchAll(/'([a-z0-9-]+)'/g)) {
        if (aliases[match[1]]) used.add(match[1]);
      }
    }

    const missing = Array.from(used).filter((name) => !aliases[name]).sort();
    expect(missing).toEqual([]);
  });

  it('does not keep the legacy path-registry icon contract in app or review pages', () => {
    const icons = read('js/icons.js');
    expect(icons).not.toContain('window.ICON_PATHS');
    expect(icons).toContain('window.LUCIDE_ICON_NODES');

    for (const path of [...PRODUCTION_PAGES, 'js/ui.js']) {
      const source = read(path);
      expect(source, `${path}: legacy icon path registry`).not.toContain('ICON_PATHS');
      expect(source, `${path}: legacy symbol style marker`).not.toContain('data-ciq-symbol-style');
      expect(source, `${path}: temporary percent ring icon`).not.toContain('percent-ring');
    }
  });

  it('uses the provided PNG favicon and removes the legacy OG image asset', () => {
    expect(existsSync(resolve(ROOT, 'favicon.png'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'favicon.svg'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'og-image.png'))).toBe(false);
    expect(read('sw.js')).toContain("'favicon.png'");
    expect(read('sw.js')).not.toContain('favicon.svg');

    for (const { path, source } of pageSources()) {
      expect(source, `${path}: png favicon`).toContain('rel="icon" type="image/png" href="favicon.png?v=4"');
      expect(source, `${path}: svg favicon`).not.toContain('favicon.svg');
      expect(source, `${path}: og-image`).not.toMatch(/og:image|og-image\.png/);
    }
  });
});

describe('design-system contracts', () => {
  const designCss = read('css/design_system.css');
  const pagesCss = read('css/pages.css');
  const css = `${designCss}\n${pagesCss}`;

  it('defines every referenced CSS custom property', () => {
    const definitions = new Set(Array.from(css.matchAll(/--([a-z0-9-]+)\s*:/gi), (match) => match[1]));
    const references = new Set(Array.from(css.matchAll(/var\(\s*--([a-z0-9-]+)/gi), (match) => match[1]));
    const missing = Array.from(references).filter((name) => !definitions.has(name)).sort();
    expect(missing).toEqual([]);
  });

  it('uses the approved Apple interaction and accessibility tokens', () => {
    for (const token of ['--accent', '--accent-soft', '--on-ok', '--on-warn', '--on-bad', '--fs-22', '--fs-24',
      '--ease-out', '--ease-in-out', '--ease-drawer', '--t-press', '--t-popover', '--t-panel',
      '--material-toolbar', '--material-popover', '--material-modal', '--material-notification', '--material-blur']) {
      expect(designCss).toContain(`${token}:`);
    }
    expect(designCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(designCss).toContain('@media (prefers-contrast: more)');
    expect(designCss).toContain('@media (forced-colors: active)');
  });

  it('keeps every production HTML class covered by the shared UI styles', () => {
    const htmlClasses = new Set();
    for (const { source } of pageSources()) {
      for (const match of source.matchAll(/class="([^"]+)"/g)) {
        for (const className of match[1].split(/\s+/).filter(Boolean)) htmlClasses.add(className);
      }
    }
    const missing = Array.from(htmlClasses)
      .filter((className) => !css.includes(`.${className}`))
      .sort();
    expect(missing).toEqual([]);
  });

  it('keeps Apple-style motion bounded and component-specific', () => {
    expect(css).not.toMatch(/transition\s*:\s*all\b/i);
    expect(css).not.toMatch(/\bease-in(?!-out)\b/i);
    expect(designCss).toContain('@media (prefers-reduced-motion: reduce)');

    const transitionBlocks = css.match(/transition(?:-[a-z-]+)?\s*:[^;]+;/gi) || [];
    const longTransitions = transitionBlocks.filter((block) => {
      const durations = Array.from(block.matchAll(/(\d*\.?\d+)(ms|s)\b/gi), (match) => {
        const value = Number(match[1]);
        return match[2].toLowerCase() === 's' ? value * 1000 : value;
      });
      return durations.some((duration) => duration > 300);
    });
    expect(longTransitions).toEqual([]);
  });

  it('only uses translucent material on approved floating UI surfaces', () => {
    const approvedSelectors = [
      '.toast',
      '.offline-banner',
      '.online-banner',
      '.menu-panel',
      '.confirm-dialog',
      '.kbd-modal',
      '.ciq-select-menu',
      '.dt-picker',
      '.modal-backdrop',
      '.fixed-header',
      '.header-bar',
      '.ops-standard-bar',
      '.ops-focus-bar',
      '.ops-live-bar',
      '.action-bar',
      '.workbench-action-bar',
    ];
    const blocks = css.match(/[^{}]+{[^{}]*backdrop-filter\s*:[^{}]*}/g) || [];
    const unapproved = blocks.filter((block) => {
      const selector = block.split('{')[0].trim();
      return !approvedSelectors.some((approved) => selector.includes(approved));
    });
    expect(unapproved).toEqual([]);
    expect(css).not.toMatch(/(?:linear|radial|conic)-gradient\s*\(/);
    expect(css).not.toMatch(/\bglow\b/i);
  });

  it('keeps toast notifications text-first and readable', () => {
    expect(designCss).toMatch(/\.toast\s*{[^}]*display:\s*block;[^}]*max-width:\s*min\(420px,\s*calc\(100vw - 24px\)\);/s);
    expect(designCss).toMatch(/\.toast-message\s*{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
    expect(designCss).not.toMatch(/\.toast\s*{[^}]*grid-template-columns:\s*34px/s);
  });

  it('never renders status as a one-sided accent bar', () => {
    // 通知・警告・エラーを「片側だけ太い色付き罫線の箱」で表す表現を全面的に禁止する。
    // 状態は 面の有無 / アイコン / 文言 で伝える。
    // 例外は擬似要素で組む字形(チェック・シェブロン)と kbd のキートップだけ。
    const rules = css.match(/[^{}]+\{[^{}]*\}/g) || [];
    const accentBars = [];
    for (const rule of rules) {
      const [selector, body] = [rule.split('{')[0].trim(), rule.split('{')[1]];
      const isGlyph = /::(?:after|before)/.test(selector) || /\bkbd\b/.test(selector);
      for (const [decl, value] of body.matchAll(
        /(border-(?:left|right|top|bottom|inline-start|inline-end)(?:-width)?\s*:\s*([^;]+));/gi,
      )) {
        const width = Number(value.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 0);
        const isSideBar = /left|right|inline/i.test(decl);
        if (width >= 3 || (width >= 2 && isSideBar && !isGlyph)) {
          accentBars.push(`${selector} { ${decl} }`);
        }
      }
    }
    expect(accentBars).toEqual([]);
  });

  it('keeps page messages inline and reserves a surface for errors only', () => {
    // info / success / warning は本文として読ませる(面を持たない)。
    expect(designCss).toMatch(/\.page-msg,[\s\S]{0,600}?\.csv-status\s*{[\s\S]*?border:\s*0;[\s\S]*?background:\s*none;/);
    // error だけがティント面を持ち、ユーザーの操作を止める状態だと分かるようにする。
    expect(designCss).toMatch(/\.page-msg\.error,\s*\.status-msg-box\.error\s*{[\s\S]*?background:\s*var\(--tint-bad\);/);
    expect(read('js/my.js')).not.toContain('ログアウトしました。');
    for (const path of ['js/entry.js', 'js/my.js', 'js/admin_settings.js']) {
      expect(read(path), path).not.toContain('必須項目を入力してください。');
    }
    expect(read('entry.html')).toContain('class="entry-mail-notice"');
  });

  it('keeps email templates readable in dark mode', () => {
    const email = read('supabase/functions/send-email/index.ts');
    for (const className of ['ciq-mail-copy', 'ciq-mail-note', 'ciq-mail-code', 'ciq-mail-code-box', 'ciq-mail-label', 'ciq-mail-value']) {
      expect(email).toContain(className);
    }
    expect(email).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*\.ciq-mail-copy,[\s\S]*color:\s*#f5f5f7 !important;/);
    expect(email).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*\.ciq-mail-copy,[\s\S]*-webkit-text-fill-color:\s*#f5f5f7 !important;/);
    expect(email).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*\.ciq-mail-note,[\s\S]*color:\s*#aeaeb2 !important;/);
    expect(email).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*\.ciq-mail-note,[\s\S]*-webkit-text-fill-color:\s*#aeaeb2 !important;/);
    expect(email).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*\.ciq-mail-code-box\s*{[^}]*background:\s*#2c2c2e !important;[^}]*border-color:\s*#5a5a5f !important;/);
  });

  it('does not reintroduce legacy dropdown implementations', () => {
    expect(designCss).not.toContain('.custom-dropdown');
    expect(designCss).not.toContain('select.custom-select');
  });

  it('styles all JS-generated state classes', () => {
    expect(designCss).toMatch(/\.checklist-item\.is-done/);
    expect(designCss).toMatch(/\.checklist-item\.is-pending/);
    expect(designCss).toMatch(/\.q-card\.mine-active/);
    expect(designCss).toMatch(/\.q-card\.inprogress/);
    expect(designCss).toContain('.u-hidden');
  });

  it('keeps the check-in guide transparent over the live camera preview', () => {
    expect(pagesCss).toMatch(
      /body\.page-checkin\s+\.checkin-guide\s*{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s,
    );
  });
});
