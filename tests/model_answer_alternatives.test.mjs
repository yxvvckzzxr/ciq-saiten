// 模範解答の別解(3列目)の回帰テスト。
//
// 入力は「/」区切りの1つの文字列で受け、先頭が主答え・以降が別解。
// CSV の3列目と管理画面のインライン編集で同じ区切りを使う。
// 保存は text[] の別列(answer に区切り文字を詰め込まない)。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const apiSrc = read('js/supabase_api.js');
const scanSrc = read('js/admin_scan.js');
const questionSrc = read('js/question.js');
const migration = read('supabase/migrations/202609040001_model_answer_alternatives.sql');

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
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

const load = (src, name) => new Function(
  `const ALT_ANSWER_SEPARATOR = '/'; const MODEL_ALT_SEPARATOR = '/'; return (${extractFunction(src, name)})`,
)();

const normalizeAltAnswers = load(apiSrc, 'normalizeAltAnswers');
const textToModelAnswer = load(scanSrc, 'textToModelAnswer');
const modelAnswerToText = load(scanSrc, 'modelAnswerToText');

describe('入力のパース', () => {
  it('先頭が主答え、以降が別解', () => {
    expect(textToModelAnswer('アイザック・アシモフ / アシモフ / Isaac Asimov')).toEqual({
      answer: 'アイザック・アシモフ',
      altAnswers: ['アシモフ', 'Isaac Asimov'],
    });
  });

  it('別解が無ければ空配列', () => {
    expect(textToModelAnswer('アシモフ')).toEqual({ answer: 'アシモフ', altAnswers: [] });
  });

  it('前後の空白と空の区切りを落とす', () => {
    expect(textToModelAnswer('  A  //  B /   ')).toEqual({ answer: 'A', altAnswers: ['B'] });
  });

  it('空入力は主答えも空', () => {
    expect(textToModelAnswer('   ')).toEqual({ answer: '', altAnswers: [] });
  });

  it('区切りだけなら何も残らない', () => {
    expect(textToModelAnswer('///')).toEqual({ answer: '', altAnswers: [] });
  });
});

describe('表示用の文字列化', () => {
  it('パースと往復する', () => {
    const text = 'アイザック・アシモフ / アシモフ / Isaac Asimov';
    expect(modelAnswerToText(textToModelAnswer(text))).toBe(text);
  });

  it('別解が無ければ主答えだけ', () => {
    expect(modelAnswerToText({ answer: 'アシモフ', altAnswers: [] })).toBe('アシモフ');
  });

  it('未設定でも壊れない', () => {
    expect(modelAnswerToText(null)).toBe('');
    expect(modelAnswerToText({})).toBe('');
  });
});

describe('保存値の正規化', () => {
  it('配列でも文字列でも同じ結果になる', () => {
    expect(normalizeAltAnswers(['A', ' B ', ''])).toEqual(['A', 'B']);
    expect(normalizeAltAnswers('A / B')).toEqual(['A', 'B']);
  });

  it('未設定は空配列', () => {
    expect(normalizeAltAnswers(null)).toEqual([]);
    expect(normalizeAltAnswers(undefined)).toEqual([]);
    expect(normalizeAltAnswers('')).toEqual([]);
  });
});

describe('保存の形', () => {
  it('answer に区切り文字を詰め込まず、別列で持つ', () => {
    expect(migration).toMatch(/add column if not exists alt_answers text\[\] not null default '\{\}'/);
    expect(apiSrc).toMatch(/alt_answers: normalizeAltAnswers\(source\.altAnswers\)/);
  });

  it('主答えが空の問題は行ごと保存しない', () => {
    expect(apiSrc).toMatch(/\.filter\(row => row\.answer\)/);
  });

  it('要確認ページ用の RPC も別解を返す', () => {
    expect(migration).toMatch(/model_alt_answers text\[\]/);
    expect(migration).toMatch(/coalesce\(ma\.alt_answers, '\{\}'\) as model_alt_answers/);
  });
});

describe('採点ヘッダーの表示', () => {
  const fn = extractFunction(questionSrc, 'renderModelAnswer');

  it('「別解」というラベルを画面に出さない', () => {
    // コメントには説明として書いてあるので、コードだけを見る
    const code = fn.replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/別解/);
  });

  it('hover や click で隠さない(常時表示)', () => {
    expect(fn).not.toMatch(/mouseenter|mouseover|addEventListener\('click'/);
  });

  it('区切りは項目と同じ要素に入れる(折り返しで行末に残さない)', () => {
    expect(fn).toMatch(/index === 0 \? alt : `\/ \$\{alt\}`/);
  });

  it('別解が無いときは器ごと隠す', () => {
    expect(fn).toMatch(/altsEl\.hidden = true;/);
  });
});
