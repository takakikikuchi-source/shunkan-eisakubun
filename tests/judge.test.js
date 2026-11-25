const test = require('node:test');
const assert = require('node:assert/strict');
const { judge } = require('../js/judge.js');

test('完全一致は正解', () => {
  assert.equal(judge('I am a student.', ['I am a student.']).result, 'correct');
});

test('大文字小文字・句読点・余分なスペースは無視', () => {
  assert.equal(judge('  i am   a STUDENT ', ['I am a student.']).result, 'correct');
  assert.equal(judge('Are you an engineer', ['Are you an engineer?']).result, 'correct');
  assert.equal(judge('Yesterday she was late', ['Yesterday, she was late.']).result, 'correct');
});

test('短縮形と展開形は同じとみなす', () => {
  assert.equal(judge("I'm a student", ['I am a student.']).result, 'correct');
  assert.equal(judge('I am not busy', ["I'm not busy."]).result, 'correct');
  assert.equal(judge("I'm not busy", ['I am not busy.']).result, 'correct');
  assert.equal(judge("The meeting isn't long", ['The meeting is not long.']).result, 'correct');
  assert.equal(judge("I can't go", ['I cannot go.']).result, 'correct');
  assert.equal(judge('I can not go', ["I can't go."]).result, 'correct');
});

test('スマホの曲がった引用符でも短縮形を認識', () => {
  assert.equal(judge('I’m a student', ['I am a student.']).result, 'correct');
});

test("あいまいな 's は is / has の両方を試す", () => {
  assert.equal(judge("He's been busy", ['He has been busy.']).result, 'correct');
  assert.equal(judge("He's busy", ['He is busy.']).result, 'correct');
});

test('別解のどれかと一致すれば正解', () => {
  const r = judge('This is your seat', ['Your seat is here.', 'This is your seat.']);
  assert.equal(r.result, 'correct');
  assert.equal(r.answer, 'This is your seat.');
});

test('1語のミス（冠詞抜け・スペルミス）は惜しい', () => {
  assert.equal(judge('I am student', ['I am a student.']).result, 'close');
  assert.equal(judge('I am a studnet', ['I am a student.']).result, 'close');
});

test('大きく違えば不正解', () => {
  assert.equal(judge('You are teacher', ['I am a student.']).result, 'wrong');
});

test('空の回答は不正解', () => {
  assert.equal(judge('', ['I am a student.']).result, 'wrong');
  assert.equal(judge('   ', ['I am a student.']).result, 'wrong');
});

test('差分：違う単語と抜けた単語に印が付く', () => {
  const r = judge('I is student', ['I am a student.']);
  assert.deepEqual(r.userTokens, ['I', 'is', 'student']);
  assert.deepEqual(r.userMarks, [false, true, false]);
  assert.deepEqual(r.answerTokens, ['I', 'am', 'a', 'student.']);
  assert.deepEqual(r.answerMarks, [false, true, true, false]);
});

test('差分は一番近い別解に対して取る', () => {
  const r = judge('This is you seat', ['Your seat is here.', 'This is your seat.']);
  assert.equal(r.answer, 'This is your seat.');
  assert.equal(r.result, 'close');
});

test('問題データの正解・別解は自分自身と一致する', () => {
  global.window = {};
  require('../data/stage1-be.js');
  for (const unit of global.window.SE_UNITS) {
    for (const q of unit.questions) {
      for (const ans of [...q.en, ...(q.alternatives || [])]) {
        assert.equal(judge(ans, q.en.concat(q.alternatives || [])).result, 'correct', `${q.id}: ${ans}`);
      }
    }
  }
});
