// ========================================
// テストデータ注入スクリプト（修正版）
// admin.html のブラウザコンソールで実行
// プロジェクト: ciq1 / 120人 / 100問
// ========================================

(async () => {
  const ENTRY_COUNT = 120;
  const QUESTION_COUNT = 100;
  const scorers = ['採点者A', '採点者B', '採点者C'];

  const lastNames = ['田中','鈴木','佐藤','山田','高橋','渡辺','伊藤','中村','小林','加藤','吉田','山本','松本','井上','木村','林','斎藤','清水','山口','池田','橋本','阿部','石川','前田','藤田','小川','岡田','村上','長谷川','近藤'];
  const firstNames = ['太郎','花子','翔','美咲','健太','陽菜','大輝','結衣','蓮','さくら','悠真','凛','颯太','心','優','葵','新','芽依','駿','莉子','奏','紬','陸','詩','湊','楓','朝陽','琴音','樹','彩'];
  const lastKana = ['タナカ','スズキ','サトウ','ヤマダ','タカハシ','ワタナベ','イトウ','ナカムラ','コバヤシ','カトウ','ヨシダ','ヤマモト','マツモト','イノウエ','キムラ','ハヤシ','サイトウ','シミズ','ヤマグチ','イケダ','ハシモト','アベ','イシカワ','マエダ','フジタ','オガワ','オカダ','ムラカミ','ハセガワ','コンドウ'];
  const firstKana = ['タロウ','ハナコ','ショウ','ミサキ','ケンタ','ヒナ','ダイキ','ユイ','レン','サクラ','ユウマ','リン','ソウタ','ココロ','ユウ','アオイ','アラタ','メイ','シュン','リコ','カナデ','ツムギ','リク','ウタ','ミナト','カエデ','アサヒ','コトネ','イツキ','アヤ'];
  const entryNames = ['クイズマスター','雑学王','ひらめき','電光石火','疾風迅雷','知識の泉','ブレイン','シンカー','アンサー','ナレッジ','ウィズダム','インテリ','ジーニアス','エース','ファイター','チャレンジャー','ドリーマー','スター','フェニックス','サンダー','ライトニング','ストーム','ブリッツ','フラッシュ','スパーク'];
  const schools = ['開成高','灘高','筑駒高','桜蔭高','渋幕高','麻布高','女子学院高','栄光学園高','聖光学院高','洛南高','久留米附設高','東大寺学園高','西大和学園高','ラ・サール高','早実高','慶應高','駒場東邦高','海城高','豊島岡女子高','浦和高'];
  const grades = ['１年','２年','３年'];

  console.log('=== テストデータ注入開始 ===');

  // 公開鍵を取得
  const publicKeyJwk = await dbGet(`projects/${projectId}/publicSettings/publicKey`);
  if (!publicKeyJwk) { console.error('公開鍵が見つかりません'); return; }

  console.log('1/2: エントリー作成中...');
  const entryUpdates = {};
  for (let i = 1; i <= ENTRY_COUNT; i++) {
    const uuid = crypto.randomUUID();
    const lnIdx = Math.floor(Math.random() * lastNames.length);
    const fnIdx = Math.floor(Math.random() * firstNames.length);
    const ln = lastNames[lnIdx];
    const fn = firstNames[fnIdx];
    const lk = lastKana[lnIdx];
    const fk = firstKana[fnIdx];
    const school = schools[Math.floor(Math.random() * schools.length)];
    const grade = grades[Math.floor(Math.random() * grades.length)];
    const eName = entryNames[Math.floor(Math.random() * entryNames.length)] + String(i).padStart(3,'0');
    const email = `test${i}@example.com`;
    const pw = String(i).padStart(6, '0'); // 1番→000001, 2番→000002...
    const msg = i <= 10 ? '全問正解目指します！' : '';

    // PII暗号化
    const piiData = {
      email, familyName: ln, firstName: fn,
      familyNameKana: lk, firstNameKana: fk,
      affiliation: school, grade, entryName: eName,
      useEntryName: false, message: msg, inquiry: ''
    };
    const encryptedPII = await AppCrypto.encryptRSA(JSON.stringify(piiData), publicKeyJwk);
    const emailHash = await AppCrypto.hashPassword(email);
    const pwHash = await AppCrypto.hashPassword(pw);

    entryUpdates[uuid] = {
      uuid, entryNumber: i, encryptedPII, emailHash,
      disclosurePw: pwHash,
      entryName: eName, affiliation: school, grade, message: msg,
      status: 'registered', checkedIn: false,
      timestamp: Date.now() - (ENTRY_COUNT - i) * 60000
    };

    if (i % 20 === 0) console.log(`  ... ${i}/${ENTRY_COUNT} 人作成`);
  }
  await dbUpdate(`projects/${projectId}/entries`, entryUpdates);
  await dbSet(`projects/${projectId}/publicSettings/lastEntryNumber`, ENTRY_COUNT);
  console.log(`  ✅ ${ENTRY_COUNT}件のエントリー作成完了`);

  // 答案キーを作成（admin画面のentryNumbers取得に必要）
  const answersKeys = {};
  for (let i = 1; i <= ENTRY_COUNT; i++) answersKeys[i] = { entryNumber: i };
  await dbUpdate(`projects/${projectId}/protected/${secretHash}/answers`, answersKeys);
  console.log(`  ✅ 答案キー作成完了`);

  // 2. スコアデータ作成
  console.log('2/3: スコアデータ作成中...');
  const scoreUpdates = {};
  for (let q = 1; q <= QUESTION_COUNT; q++) {
    scoreUpdates[`__completed__q${q}`] = {};
    scorers.forEach(s => { scoreUpdates[`__completed__q${q}`][s] = true; });
    scoreUpdates[`__scorers__q${q}`] = {};
    scorers.forEach(s => { scoreUpdates[`__scorers__q${q}`][s] = true; });
    scoreUpdates[`__final__q${q}`] = {};

    for (let i = 1; i <= ENTRY_COUNT; i++) {
      if (!scoreUpdates[i]) scoreUpdates[i] = {};
      const correctRate = Math.max(0.1, 1 - (q / QUESTION_COUNT) * 0.8 - Math.random() * 0.2);
      const result = Math.random() < correctRate ? 'correct' : 'wrong';
      scoreUpdates[i][`q${q}`] = {};
      scorers.forEach(s => { scoreUpdates[i][`q${q}`][s] = result; });
      scoreUpdates[`__final__q${q}`][i] = result;
    }
    if (q % 20 === 0) console.log(`  ... ${q}/${QUESTION_COUNT} 問完了`);
  }
  await dbSet(`projects/${projectId}/protected/${secretHash}/scores`, scoreUpdates);
  console.log(`  ✅ スコアデータ作成完了`);

  // 3. 成績照会データ作成
  console.log('3/3: 成績照会データ作成中...');
  const ordinal = n => { const s = ['th','st','nd','rd']; const v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); };

  // エントリー名マップ（seed時点で entryUpdates から取得）
  const nameMap = {};
  for (const e of Object.values(entryUpdates)) {
    // entryName はニックネームだが、本名はPII内。seed用に姓名を再構成
    nameMap[e.entryNumber] = e.entryName; // seed では本名の代わりにentryNameを使う
  }

  const ranked = [];
  for (let i = 1; i <= ENTRY_COUNT; i++) {
    const answers = [];
    for (let q = 1; q <= QUESTION_COUNT; q++) {
      answers.push(scoreUpdates[`__final__q${q}`][i] === 'correct' ? 1 : 0);
    }
    const score = answers.reduce((a, b) => a + b, 0);
    const streaks = []; let cur = 0;
    answers.forEach(a => { if (a === 1) { cur++; } else { streaks.push(cur); cur = 0; } });
    streaks.push(cur);
    ranked.push({ en: i, score, streaks });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const maxLen = Math.max(a.streaks.length, b.streaks.length);
    for (let j = 0; j < maxLen; j++) {
      if ((a.streaks[j]||0) !== (b.streaks[j]||0)) return (b.streaks[j]||0) - (a.streaks[j]||0);
    }
    return 0;
  });

  const disclosureData = {};
  let currentRank = 1;
  ranked.forEach((r, idx) => {
    if (idx > 0) {
      const prev = ranked[idx-1];
      if (prev.score !== r.score || JSON.stringify(prev.streaks) !== JSON.stringify(r.streaks)) currentRank = idx + 1;
    }
    disclosureData[r.en] = {
      displayName: nameMap[r.en] || `No.${String(r.en).padStart(3,'0')}`,
      score: r.score, rank: ordinal(currentRank),
      totalEntries: ENTRY_COUNT, totalQuestions: QUESTION_COUNT,
      streaks: r.streaks
    };
  });

  await dbUpdate(`projects/${projectId}/disclosure`, disclosureData);
  console.log(`  ✅ 成績照会データ作成完了`);

  console.log('=== 完了 ===');
  console.log(`エントリー: ${ENTRY_COUNT}人（PII暗号化済み）`);
  console.log(`スコア: ${scorers.length}人 × ${QUESTION_COUNT}問 × ${ENTRY_COUNT}人`);
  console.log('※ 答案データ・模範解答は手動で入れてください');
  console.log('成績照会テスト: test1@example.com / 000001');
  console.log('ページをリロードしてください。');
})();
