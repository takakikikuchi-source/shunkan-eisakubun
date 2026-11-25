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

test('表記ゆれ：%・数字・時刻・OK・e-mail', () => {
  assert.equal(judge('a 10% discount', ['a 10 percent discount']).result, 'correct');
  assert.equal(judge('take 5 minutes', ['take five minutes']).result, 'correct');
  assert.equal(judge('a thirty-minute call', ['a 30-minute call']).result, 'correct');
  assert.equal(judge('starts at 3pm', ['starts at 3 p.m.']).result, 'correct');
  assert.equal(judge('starts at 3 PM', ['starts at 3 p.m.']).result, 'correct');
  assert.equal(judge('is it OK if', ['is it okay if']).result, 'correct');
  assert.equal(judge('the e-mail I sent', ['the email I sent']).result, 'correct');
  assert.equal(judge('about 1000 people', ['about 1,000 people']).result, 'correct');
});

test('please はあってもなくても正解', () => {
  assert.equal(judge('Could you send it?', ['Could you please send it?']).result, 'correct');
  assert.equal(judge('Could you please send it?', ['Could you send it?']).result, 'correct');
});

test('長い文で数語違いは惜しい', () => {
  const ans = 'I would appreciate it if you could review the attached contract and get back to me by this Friday.';
  assert.equal(judge('I would appreciate if you could review the attached contract and get back to me by this Friday', [ans]).result, 'close');
  assert.equal(judge('I would appreciate it if you can check the attached contract and reply to me by Friday', [ans]).result, 'wrong');
});

// ---- 問題データの検査 ----
const fs = require('node:fs');
const path = require('node:path');
global.window = {};
const dataDir = path.join(__dirname, '..', 'data');
for (const f of fs.readdirSync(dataDir).filter((f) => f.endsWith('.js')).sort()) require(path.join(dataDir, f));
const UNITS = global.window.SE_UNITS;

test('問題データ：必須項目がそろっていて ID が重複しない', () => {
  const ids = new Set();
  for (const unit of UNITS) {
    assert.ok(unit.id && unit.title && unit.category, `unit ${unit.id}`);
    assert.ok(unit.questions.length > 0, `unit ${unit.id} has questions`);
    for (const q of unit.questions) {
      assert.ok(q.id && q.ja && q.en.length, `question ${q.id}`);
      assert.ok(!ids.has(q.id), `duplicate id ${q.id}`);
      ids.add(q.id);
    }
  }
});

test('問題データ：正解・別解は自分自身と一致する', () => {
  for (const unit of UNITS) {
    for (const q of unit.questions) {
      for (const ans of [...q.en, ...(q.alternatives || [])]) {
        assert.equal(judge(ans, q.en.concat(q.alternatives || [])).result, 'correct', `${q.id}: ${ans}`);
      }
    }
  }
});

test('問題データ：ビジネス3場面が各80問', () => {
  const count = {};
  for (const u of UNITS) count[u.category] = (count[u.category] || 0) + u.questions.length;
  assert.equal(count['メール・チャット'], 80);
  assert.equal(count['会議'], 80);
  assert.equal(count['交渉・提案・プレゼン'], 80);
});
