// V7: 当日受付QRの署名付きトークンを、実装を直接 import して検証する。
//
// qr_token.ts は署名鍵を Deno.env から取るため、Node(vitest)では Deno グローバルをスタブして実行する。
// HMAC は WebCrypto(crypto.subtle)で、Node 18+ でもそのまま動作する。

import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SECRET = 'test-signing-secret-0123456789abcdef';   // 32文字以上（V1 の下限を満たす）
const ENTRY_ID = '080410bf-8742-4a6b-80db-139a680e3e53';

let issueQrToken, verifyQrToken;

beforeAll(async () => {
  globalThis.Deno = { env: { get: (k) => (k === 'CIQ_EMAIL_SIGNING_SECRET' ? SECRET : undefined) } };
  ({ issueQrToken, verifyQrToken } = await import('../supabase/functions/_shared/qr_token.ts'));
});

describe('signed check-in QR tokens (V7)', () => {
  it('issues a token that is not the bare entry UUID', async () => {
    const token = await issueQrToken(ENTRY_ID);
    expect(token).not.toBe(ENTRY_ID);
    expect(token.split('.')).toHaveLength(3);
    expect(token.startsWith(`${ENTRY_ID}.`)).toBe(true);
  });

  it('round-trips: a freshly issued token verifies back to the entry id', async () => {
    const token = await issueQrToken(ENTRY_ID);
    await expect(verifyQrToken(token)).resolves.toBe(ENTRY_ID);
  });

  it('rejects a legacy bare UUID (old QR format)', async () => {
    await expect(verifyQrToken(ENTRY_ID)).resolves.toBeNull();
  });

  it('rejects a token whose entry id was swapped (forgery)', async () => {
    const token = await issueQrToken(ENTRY_ID);
    const [, exp, sig] = token.split('.');
    const otherId = '0909e458-681c-4b4f-9d8e-f8ec6806c9d0';
    await expect(verifyQrToken(`${otherId}.${exp}.${sig}`)).resolves.toBeNull();
  });

  it('rejects a tampered signature and a tampered expiry', async () => {
    const token = await issueQrToken(ENTRY_ID);
    const [id, exp, sig] = token.split('.');
    await expect(verifyQrToken(`${id}.${exp}.${'0'.repeat(sig.length)}`)).resolves.toBeNull();
    await expect(verifyQrToken(`${id}.${Number(exp) + 1}.${sig}`)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const expired = await issueQrToken(ENTRY_ID, -1000);   // 過去に失効
    await expect(verifyQrToken(expired)).resolves.toBeNull();
  });

  it('defaults to a bounded TTL (30 days), not an effectively unlimited one', async () => {
    const token = await issueQrToken(ENTRY_ID);
    const exp = Number(token.split('.')[1]);
    const days = (exp - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('honours CIQ_QR_TTL_DAYS and clamps it to a sane range', async () => {
    const withEnv = async (days) => {
      globalThis.Deno = { env: { get: (k) => (k === 'CIQ_QR_TTL_DAYS' ? days : (k === 'CIQ_EMAIL_SIGNING_SECRET' ? SECRET : undefined)) } };
      const token = await issueQrToken(ENTRY_ID);
      return (Number(token.split('.')[1]) - Date.now()) / 86400000;
    };
    expect(await withEnv('2')).toBeLessThanOrEqual(2);
    expect(await withEnv('99999')).toBeLessThanOrEqual(400);   // 上限クランプ
    expect(await withEnv('0')).toBeGreaterThan(29);            // 不正値は既定へ
    // 後続テストのため既定 env に戻す
    globalThis.Deno = { env: { get: (k) => (k === 'CIQ_EMAIL_SIGNING_SECRET' ? SECRET : undefined) } };
  });

  it('binds a purpose+version tag so signatures cannot cross protocols', async () => {
    const src = readFileSync(resolve(ROOT, 'supabase/functions/_shared/qr_token.ts'), 'utf8');
    expect(src).toMatch(/const TOKEN_VERSION = 'qr1'/);
    expect(src).toMatch(/\$\{TOKEN_VERSION\}:\$\{entryId\}:\$\{expMs\}/);
  });

  it('rejects malformed input', async () => {
    for (const bad of ['', 'a.b', 'a.b.c.d', null, undefined, 42, `${ENTRY_ID}.notanumber.abc`]) {
      await expect(verifyQrToken(bad)).resolves.toBeNull();
    }
  });
});

describe('QR generation paths embed the signed token, never the raw UUID (V7)', () => {
  const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

  for (const [fn, call] of Object.entries({
    'my-entry': /makeQrSvg\(await issueQrToken\(entryId\)\)/,
    'admin-entry-qr': /makeQrSvg\(await issueQrToken\(entry\.id\)\)/,
    'checkin-qr': /makeQrSvg\(await issueQrToken\(data\)\)/,
  })) {
    it(`${fn}: encodes a signed token`, () => {
      const src = read(`supabase/functions/${fn}/index.ts`);
      expect(src).toMatch(call);
      expect(src).toMatch(/issueQrToken/);
    });
  }

  it('check-in verifies the token and refuses a bare UUID', () => {
    const src = read('supabase/functions/check-in/index.ts');
    expect(src).toMatch(/const verifiedId = await verifyQrToken\(scanned\)/);
    expect(src).toMatch(/findEntry\(supabase, req, projectId, \{ id: verifiedId \}\)/);
    // 未検証の値で直接引かない
    expect(src).not.toMatch(/\.eq\('id', entryId\)/);
  });

  // 受付番号フォールバックは残すが、参加者に向いた受付画面(checkin.html)からは外し、
  // 運営専用ページ + owner/admin 限定 + 照会を挟む2段階に移した。
  // entry_number は public_entry_list で anon に公開されており、認証材料にならないため。
  it('check-in keeps a receipt-number fallback, but only on the staff-only path', () => {
    const src = read('supabase/functions/check-in/index.ts');
    expect(src).toMatch(/entryNumber: number/);
    expect(src).toMatch(/query\.eq\('entry_number', by\.entryNumber\)/);

    // QR 経路(check)では番号を一切見ない
    const checkBranch = src.slice(
      src.indexOf("if (action === 'check')"),
      src.indexOf("if (action === 'lookup')"),
    );
    expect(checkBranch).not.toMatch(/entryNumber/);

    // 番号起点の経路は運営限定で、照会で得た id との一致を要求する
    expect(src).toMatch(/const STAFF_ONLY_ROLES: Role\[\] = \['owner', 'admin'\]/);
    expect(src).toMatch(/String\(entry\.id\) !== String\(confirmedEntryId\)/);
  });
});

describe('the public entry list no longer exposes entry UUIDs (V7)', () => {
  it('migration revokes blanket SELECT and re-grants without entry_id', () => {
    const mig = readFileSync(resolve(ROOT, 'supabase/migrations/202607260002_hide_public_entry_uuid.sql'), 'utf8');
    expect(mig).toMatch(/revoke select on public\.public_entry_list from anon, authenticated/);
    const grant = mig.match(/grant select \(([\s\S]*?)\) on public\.public_entry_list/);
    expect(grant).toBeTruthy();
    expect(grant[1]).not.toMatch(/entry_id/);
  });

  it('the public-list query no longer selects or exposes entry_id', () => {
    const src = readFileSync(resolve(ROOT, 'js/supabase_api.js'), 'utf8');
    expect(src).not.toMatch(/uuid: row\.entry_id/);
    // 公開リストの取得クエリだけを見る(answer_pages 等の管理者専用テーブルは entry_id を使ってよい)
    const publicQuery = src.slice(src.indexOf('async getPublicEntries'), src.indexOf('subscribePublicEntries'));
    expect(publicQuery).toMatch(/from\('public_entry_list'\)/);
    expect(publicQuery).not.toMatch(/entry_id/);
  });
});
