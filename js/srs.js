/*
 * 復習の間隔（間隔反復）— 要件 R-03
 *  正解：1日後 → 3日後 → 7日後 → 14日後 → 30日後、以降は30日ごと
 *  惜しい：間隔を延ばさず、同じ間隔でもう一度
 *  不正解：翌日（1日後からやり直し）
 * 日付はその端末の暦（0時区切り）で数える。ブラウザと Node の両方で使える。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SESrs = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const INTERVALS = [1, 3, 7, 14, 30];
  const LAST = INTERVALS.length - 1;

  function dayStart(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  function addDays(dayMs, n) {
    const d = new Date(dayMs);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
  }

  // 新しく復習に入れるとき：翌日に1回目
  function initial(now) {
    return { i: 0, due: addDays(dayStart(now), INTERVALS[0]), count: 0, correct: 0, lastAt: 0, lastResult: '' };
  }

  // 復習の結果から、次の状態を作る（元の状態は変えない）
  function next(srs, result, now) {
    const cur = Object.assign(initial(now), srs || {});
    let i = Math.max(0, Math.min(LAST, Number(cur.i) || 0));
    if (result === 'correct') i = Math.min(i + 1, LAST);
    else if (result === 'wrong') i = 0;
    // close（惜しい）は i をそのままにする
    const days = result === 'wrong' ? INTERVALS[0] : INTERVALS[i];
    return {
      i,
      due: addDays(dayStart(now), days),
      count: (Number(cur.count) || 0) + 1,
      correct: (Number(cur.correct) || 0) + (result === 'correct' ? 1 : 0),
      lastAt: now,
      lastResult: result,
    };
  }

  function isDue(srs, now) {
    return !!srs && Number(srs.due) <= dayStart(now);
  }

  return { INTERVALS, dayStart, addDays, initial, next, isDue };
});
