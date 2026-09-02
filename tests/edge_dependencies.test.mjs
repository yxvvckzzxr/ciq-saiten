// V11 / V13: 除名メンバー判定の統一と、Edge 依存のバージョン固定を回帰化する。

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const FN_DIR = resolve(ROOT, 'supabase/functions');

describe('removed members are rejected consistently (V11)', () => {
  it('check-in requires an active member with an expected role', () => {
    const src = read('supabase/functions/check-in/index.ts');
    // 否定形(status <> 'removed')ではなく、active を明示する
    expect(src).toMatch(/member\.status !== 'active'/);
    expect(src).not.toMatch(/member\.status === 'removed'/);
    // ロール判定は allowlist(呼び出し側が許可ロールを渡す)。想定外ロールが素通りしないこと。
    expect(src).toMatch(/if \(!allowedRoles\.includes\(member\.role as Role\)\) throw new Error\('Forbidden'\)/);
    expect(src).toMatch(/const DESK_ROLES: Role\[\] = \['owner', 'admin', 'scorer'\]/);
  });

  it('staff-facing functions all gate on an explicit active status', () => {
    for (const fn of ['check-in', 'admin-create-entry', 'admin-entry-qr', 'project-key']) {
      const src = read(`supabase/functions/${fn}/index.ts`);
      expect(src, `${fn} must require active`).toMatch(/status !== 'active'|\.eq\('status', 'active'\)/);
    }
  });
});

describe('Edge dependencies are pinned to an exact version (V13)', () => {
  function edgeSources() {
    const out = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, name.name);
        if (name.isDirectory()) walk(p);
        else if (name.name.endsWith('.ts')) out.push(p);
      }
    };
    walk(FN_DIR);
    return out;
  }

  it('has Edge sources to check', () => {
    expect(edgeSources().length).toBeGreaterThan(0);
  });

  it('no remote/npm import uses a floating version', () => {
    const floating = [];
    for (const file of edgeSources()) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/from '((?:npm:|jsr:|https:\/\/)[^']+)'/g)) {
        const spec = m[1];
        // パッチ版まで固定されていること (例: @2.110.1 / qrcode@1.5.4)
        if (!/@\d+\.\d+\.\d+/.test(spec)) floating.push(`${file.replace(ROOT + '/', '')}: ${spec}`);
      }
    }
    expect(floating).toEqual([]);
  });

  it('the Edge client tracks the same supabase-js version as the browser bundle', () => {
    const edge = read('supabase/functions/_shared/supabase.ts');
    const edgeVersion = edge.match(/supabase-js@(\d+\.\d+\.\d+)/)?.[1];
    const browserVersion = read('my.html').match(/supabase-js@(\d+\.\d+\.\d+)/)?.[1];
    expect(edgeVersion).toBeTruthy();
    expect(edgeVersion).toBe(browserVersion);
  });
});
