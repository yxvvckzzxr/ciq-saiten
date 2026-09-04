// 要確認ページ(conflict.html)の回帰テスト。
//
// 採点ページ(question.html)と挙動を揃えるための不変条件を固定する。
// 元の不具合: 背景プリロードが cellUrlCache を埋めるだけで DOM を更新せず、
// あとから交差監視が発火しても queueConflictImage が「取得済み」として弾くため、
// カードが「画像を読み込み中」のまま永久に残っていた。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const conflictSrc = read('js/conflict.js');
const questionSrc = read('js/question.js');
const css = read('css/pages.css');

function sliceFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${name}`);
}

describe('画像のプレースホルダは必ず終着点に到達する', () => {
  it('背景プリロードは取得後に DOM へ反映する', () => {
    const fn = sliceFn(conflictSrc, 'scheduleBackgroundConflictImages');
    expect(fn).toMatch(/ensureConflictCellUrls\(batch\)/);
    expect(fn).toMatch(/updateVisibleConflictImages\(batch\)/);
  });

  it('取得済みのキーはキューで握り潰さず、その場で反映する', () => {
    const fn = sliceFn(conflictSrc, 'queueConflictImage');
    expect(fn).toMatch(/typeof cached === 'string'/);
    expect(fn).toMatch(/updateVisibleConflictImages\(\[\{ key \}\]\)/);
    // 「undefined 以外なら何もしない」という元の早期 return は復活させない
    expect(fn).not.toMatch(/cellUrlCache\[key\] !== undefined\) return;/);
  });

  it('取得中(null)を「画像がありません」と確定させない', () => {
    const fn = sliceFn(conflictSrc, 'updateVisibleConflictImages');
    expect(fn).toMatch(/typeof cellUrl !== 'string'\) return;/);
  });

  it('取得中と取得済みをカード生成時に区別する', () => {
    const fn = sliceFn(conflictSrc, 'createConflictCard');
    expect(fn).toMatch(/typeof cellUrl === 'string'/);
    expect(fn).toMatch(/isResolved \? ' 画像がありません' : ' 画像を読み込み中'/);
    // hasOwnProperty 版は null(取得中)を取得済みと誤判定するので戻さない
    expect(fn).not.toMatch(/hasOwnProperty/);
  });

  it('描画の最後に取りこぼしを掃く', () => {
    const fn = sliceFn(conflictSrc, 'render');
    expect(fn).toMatch(/updateVisibleConflictImages\(\);/);
  });
});

describe('確定してもカードは動かない', () => {
  it('確定済みカードを末尾へ送る order を持たない', () => {
    const rule = css.match(/\.conflict-card\.resolved \{[^}]*\}/)[0];
    expect(rule).not.toMatch(/order:/);
    expect(rule).toMatch(/opacity:/);
  });
});

describe('開いたときは未確定の先頭が選ばれる', () => {
  it('先頭固定ではなく未確定を探す', () => {
    const fn = sliceFn(conflictSrc, 'render');
    expect(fn).toMatch(/const firstUnresolved = currentConflicts\.findIndex\(conflict => !conflict\.finalResult\)/);
    expect(fn).toMatch(/selectedIndex = firstUnresolved >= 0 \? firstUnresolved : 0/);
  });

  it('採点ページも同じ考え方で初期選択している', () => {
    const fn = sliceFn(questionSrc, 'setInitialSelectionToFirstUnscored');
    expect(fn).toMatch(/findIndex\(card => myScores\[card\.entryId\] === null\)/);
    expect(fn).toMatch(/firstUnscoredIndex >= 0 \? firstUnscoredIndex : 0/);
  });

  it('判定後の送りは両ページとも単純に次のカードへ', () => {
    expect(sliceFn(conflictSrc, 'advanceConflictSelection')).toMatch(/selectedIndex \+ 1/);
    expect(sliceFn(questionSrc, 'advanceSelection')).toMatch(/selectedIndex \+ 1/);
  });
});

describe('判定の挙動が採点ページと揃っている', () => {
  it('書き込みを待たずに手元の状態を反映する', () => {
    const fn = sliceFn(conflictSrc, 'setFinal');
    expect(fn).toMatch(/applyLocalFinalResult\(q, entryId, result\)/);
    expect(fn).toMatch(/await render\(\);/);
    // 失敗したら元に戻す
    expect(fn).toMatch(/rollback\(\)/);
  });

  it('選択を進めてから書き込む(render の選択復元と競合させない)', () => {
    const fn = sliceFn(conflictSrc, 'scoreSelectedConflict');
    const advanceAt = fn.indexOf('advanceConflictSelection()');
    const writeAt = fn.indexOf('setFinal(');
    expect(advanceAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(advanceAt);
    // 書き込み完了後に進める形には戻さない
    expect(fn).not.toMatch(/\.then\(advanceConflictSelection\)/);
  });

  it('採点ページと同じ押下フィードバックを出す', () => {
    expect(sliceFn(conflictSrc, 'scoreSelectedConflict')).toMatch(/score-pop/);
    expect(sliceFn(questionSrc, 'scoreSelected')).toMatch(/score-pop/);
  });

  it('キーボードもボタンと同じ入口を通る', () => {
    expect(conflictSrc).toMatch(/if \(key === 'm' \|\| key === 'M'\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*scoreSelectedConflict\('correct'\);/);
    expect(conflictSrc).toMatch(/scoreSelectedConflict\('wrong'\);/);
    expect(conflictSrc).not.toMatch(/setFinal\([^)]*\)\.then\(/);
  });
});
