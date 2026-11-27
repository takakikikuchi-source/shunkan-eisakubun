const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

global.window = global.window || {};
require(path.join(__dirname, '..', 'coach', 'examples.js'));
const EX = global.window.COACH_EXAMPLES;

const SCENES = ['', '社外メール', '社内メール・チャット', '会議での発言', 'プレゼン', '商談・交渉', '電話', '雑談・あいさつ'];
const AUDIENCES = ['', '取引先・顧客', '上司・役員', '同僚', '部下・後輩', '初対面の相手'];

test('例文：50個、10場面×5個', () => {
  assert.equal(EX.length, 50);
  const byTopic = {};
  for (const e of EX) byTopic[e.topic] = (byTopic[e.topic] || 0) + 1;
  assert.equal(Object.keys(byTopic).length, 10);
  for (const [topic, n] of Object.entries(byTopic)) assert.equal(n, 5, topic);
});

test('例文：文章が重複せず、場面・相手は画面の選択肢にあるもの', () => {
  assert.equal(new Set(EX.map((e) => e.src)).size, EX.length);
  for (const e of EX) {
    assert.ok(e.src.trim().length > 0);
    assert.ok(SCENES.includes(e.scene), e.scene);
    assert.ok(AUDIENCES.includes(e.audience), e.audience);
  }
});
