const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/srs.js');

const day = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const ymd = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}`; };

test('新しく入れた文は翌日に出る', () => {
  const s = S.initial(day(2026, 11, 28, 23));
  assert.equal(ymd(s.due), '11/29');
  assert.equal(s.i, 0);
});

test('正解を続けると 1→3→7→14→30日、以降は30日ごと', () => {
  let now = day(2026, 11, 28);
  let s = S.initial(now); // 11/29
  const seen = [];
  for (let k = 0; k < 6; k++) {
    now = s.due + 9 * 3600e3; // 出題日の9時に正解
    s = S.next(s, 'correct', now);
    seen.push(ymd(s.due));
  }
  // 11/29正解→+3=12/2、12/2→+7=12/9、12/9→+14=12/23、12/23→+30=1/22、1/22→+30=2/21、2/21→+30=3/23
  assert.deepEqual(seen, ['12/2', '12/9', '12/23', '1/22', '2/21', '3/23']);
  assert.equal(s.i, 4);
  assert.equal(s.count, 6);
  assert.equal(s.correct, 6);
});

test('不正解は翌日に戻り、間隔も1日からやり直し', () => {
  let s = { i: 3, due: day(2026, 12, 1, 0), count: 3, correct: 3 };
  s = S.next(s, 'wrong', day(2026, 12, 1, 10));
  assert.equal(ymd(s.due), '12/2');
  assert.equal(s.i, 0);
  s = S.next(s, 'correct', day(2026, 12, 2, 10));
  assert.equal(ymd(s.due), '12/5');
});

test('惜しいは同じ間隔でもう一度', () => {
  const s = S.next({ i: 2, due: 0, count: 2, correct: 2 }, 'close', day(2026, 12, 1, 10));
  assert.equal(s.i, 2);
  assert.equal(ymd(s.due), '12/8');
  assert.equal(s.correct, 2);
  assert.equal(s.count, 3);
});

test('その日になったら出題対象（0時区切り）', () => {
  const s = S.initial(day(2026, 11, 28, 15)); // 11/29
  assert.equal(S.isDue(s, day(2026, 11, 28, 23)), false);
  assert.equal(S.isDue(s, day(2026, 11, 29, 0)), true);
  assert.equal(S.isDue(s, day(2026, 12, 5)), true);
  assert.equal(S.isDue(null, day(2026, 12, 5)), false);
});

test('月末・年末をまたいでも日付がずれない', () => {
  const s = S.next({ i: 3 }, 'correct', day(2026, 12, 20)); // i=4 → +30
  assert.equal(ymd(s.due), '1/19');
});
