// 中部枠(エントリー優先順位)の回帰テスト。
//
// 順位は「誰が大会に出られるか」を決める規則なので、実装そのものを取り出して動かす。
// 同じ規則がサーバ(recompute_entry_statuses)とクライアント(entry_list.js)の2箇所に
// あるため、両者がずれていないことも突き合わせる。ずれると保存された状態と
// エントリーリストの表示順が食い違う。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const listSrc = read('js/entry_list.js');
const sqlSrc = read('supabase/migrations/202609030001_chubu_priority_24h.sql');

// js/entry_list.js から calcPriority を実体のまま取り出す(再実装しない)。
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  let depth = 0;
  let i = src.indexOf('{', start);
  const open = i;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces from ${open}`);
}

const calcPriority = new Function(`return (${extractFunction(listSrc, 'calcPriority')})`)();

const WINDOW_MS = Number(listSrc.match(/const CHUBU_PRIORITY_WINDOW_MS = ([\d *]+);/)[1]
  .split('*').map(Number).reduce((a, b) => a * b, 1));

const OPEN = Date.UTC(2026, 8, 1, 0, 0, 0);
const hours = (h) => OPEN + h * 60 * 60 * 1000;

function entry(entryNumber, timestamp, isChubu, status = 'registered') {
  return { entryNumber, timestamp, isChubu, status };
}

function order(entries, opts = {}) {
  const result = calcPriority(entries, {
    entryOpenTime: OPEN,
    maxEntries: 0,
    windowMs: WINDOW_MS,
    ...opts,
  });
  return { ...result, numbers: result.ordered.map((e) => e.entryNumber) };
}

describe('優先枠は開始から24時間', () => {
  it('クライアントの窓は24時間', () => {
    expect(WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('サーバも同じ24時間で、中部/中部以外/経過後の3区分', () => {
    expect(sqlSrc).toMatch(/interval '24 hours'/);
    expect(sqlSrc).toMatch(/then case when e\.is_chubu then 0 else 1 end/);
    // 旧ルール(30分の完全先着 -> その後 中部優先)が残っていないこと
    expect(sqlSrc).not.toMatch(/interval '30 minutes'/);
    expect(listSrc).not.toMatch(/GRACE_PERIOD_MS/);
  });

  it('区分内はエントリー順(created_at, entry_number)', () => {
    expect(sqlSrc).toMatch(/e\.created_at asc,\s*\n\s*e\.entry_number asc/);
  });
});

describe('24時間以内は中部が先', () => {
  it('後からエントリーした中部が、先にエントリーした中部以外より上に来る', () => {
    const { numbers } = order([
      entry(1, hours(1), false),
      entry(2, hours(5), true),
    ]);
    expect(numbers).toEqual([2, 1]);
  });

  it('3区分がこの順に並ぶ', () => {
    const { numbers, earlyChubuCount, earlyOtherCount, lateCount } = order([
      entry(1, hours(2), false),   // 24h以内・中部以外
      entry(2, hours(30), true),   // 24h経過後・中部
      entry(3, hours(3), true),    // 24h以内・中部
      entry(4, hours(26), false),  // 24h経過後・中部以外
    ]);
    // 経過後の区分は中部かどうかを問わず時刻順なので、26h の 4 が 30h の 2 より先。
    expect(numbers).toEqual([3, 1, 4, 2]);
    expect({ earlyChubuCount, earlyOtherCount, lateCount }).toEqual({
      earlyChubuCount: 1, earlyOtherCount: 1, lateCount: 2,
    });
  });

  it('24時間を過ぎた中部は優先されない', () => {
    const { numbers } = order([
      entry(1, hours(25), true),
      entry(2, hours(26), false),
    ]);
    expect(numbers).toEqual([1, 2]);
  });

  it('ちょうど24時間はまだ枠の内側', () => {
    const { numbers } = order([
      entry(1, hours(23), false),
      entry(2, OPEN + WINDOW_MS, true),
    ]);
    expect(numbers).toEqual([2, 1]);
  });

  it('1ミリ秒でも過ぎたら枠の外', () => {
    const { numbers } = order([
      entry(1, hours(23), false),
      entry(2, OPEN + WINDOW_MS + 1, true),
    ]);
    expect(numbers).toEqual([1, 2]);
  });
});

describe('区分の内部はエントリー順', () => {
  it('中部どうしは先着', () => {
    const { numbers } = order([
      entry(1, hours(5), true),
      entry(2, hours(2), true),
    ]);
    expect(numbers).toEqual([2, 1]);
  });

  it('同時刻は受付番号順で決まる', () => {
    const { numbers } = order([
      entry(7, hours(2), true),
      entry(3, hours(2), true),
    ]);
    expect(numbers).toEqual([3, 7]);
  });
});

describe('その他の不変条件', () => {
  it('キャンセルは除外される', () => {
    const { numbers } = order([
      entry(1, hours(1), true, 'canceled'),
      entry(2, hours(2), false),
    ]);
    expect(numbers).toEqual([2]);
  });

  it('エントリー開始時刻が未設定なら優先枠は働かない', () => {
    const { numbers, hasPriorityWindow } = order([
      entry(1, hours(1), false),
      entry(2, hours(2), true),
    ], { entryOpenTime: 0 });
    expect(numbers).toEqual([1, 2]);
    expect(hasPriorityWindow).toBe(false);
  });

  it('定員を超えた分がキャンセル待ちになる', () => {
    const { ordered } = order([
      entry(1, hours(1), false),
      entry(2, hours(2), true),
      entry(3, hours(3), true),
    ], { maxEntries: 2 });
    expect(ordered.map((e) => [e.entryNumber, e._isWaitlist]))
      .toEqual([[2, false], [3, false], [1, true]]);
  });

  it('中部が定員を埋めると中部以外が押し出される', () => {
    const { ordered } = order([
      entry(1, hours(1), false),
      entry(2, hours(10), true),
      entry(3, hours(11), true),
    ], { maxEntries: 2 });
    const waitlisted = ordered.filter((e) => e._isWaitlist).map((e) => e.entryNumber);
    expect(waitlisted).toEqual([1]);
  });
});
