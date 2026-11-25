/*
 * 判定ロジック（ブラウザと Node の両方で使える）
 *  - 大文字小文字・句読点・余分なスペースを無視
 *  - 短縮形（I'm = I am など）を同じとみなす
 *  - 正解・別解のどれかと一致すれば正解
 *  - 一致しなくても単語の違いが少なければ「惜しい」
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SEJudge = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 短縮形 → 展開形（あいまいなものは候補を複数持つ）
  const CONTRACTIONS = {
    "i'm": ['i am'],
    "you're": ['you are'],
    "we're": ['we are'],
    "they're": ['they are'],
    "he's": ['he is', 'he has'],
    "she's": ['she is', 'she has'],
    "it's": ['it is', 'it has'],
    "that's": ['that is', 'that has'],
    "there's": ['there is', 'there has'],
    "what's": ['what is', 'what has'],
    "who's": ['who is', 'who has'],
    "where's": ['where is'],
    "here's": ['here is'],
    "how's": ['how is'],
    "isn't": ['is not'],
    "aren't": ['are not'],
    "wasn't": ['was not'],
    "weren't": ['were not'],
    "don't": ['do not'],
    "doesn't": ['does not'],
    "didn't": ['did not'],
    "haven't": ['have not'],
    "hasn't": ['has not'],
    "hadn't": ['had not'],
    "can't": ['cannot'],
    "couldn't": ['could not'],
    "won't": ['will not'],
    "wouldn't": ['would not'],
    "shouldn't": ['should not'],
    "mustn't": ['must not'],
    "i'll": ['i will'],
    "you'll": ['you will'],
    "he'll": ['he will'],
    "she'll": ['she will'],
    "it'll": ['it will'],
    "we'll": ['we will'],
    "they'll": ['they will'],
    "that'll": ['that will'],
    "i've": ['i have'],
    "you've": ['you have'],
    "we've": ['we have'],
    "they've": ['they have'],
    "i'd": ['i would', 'i had'],
    "you'd": ['you would', 'you had'],
    "he'd": ['he would', 'he had'],
    "she'd": ['she would', 'she had'],
    "we'd": ['we would', 'we had'],
    "they'd": ['they would', 'they had'],
  };

  // 数を表す単語 → 数字（five と 5 を同じとみなす）
  const NUMBERS = {
    zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
    ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
    seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50',
    sixty: '60', seventy: '70', eighty: '80', ninety: '90',
  };
  // 表記ゆれの統一
  const SPELLING = { ok: 'okay' };
  // 正誤判定では無視する語（あってもなくても正解）
  const OPTIONAL = new Set(['please']);

  const MAX_VARIANTS = 64;

  function normalizeQuotes(text) {
    return String(text).replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"');
  }

  // 表示用の単語（空白で区切った元の文字列）
  function displayTokens(text) {
    const t = String(text).trim();
    return t ? t.split(/\s+/) : [];
  }

  // 元の単語1つ → 比較用の「枠」の配列。各枠は候補（単語の配列）の配列
  function slotsOf(rawToken) {
    const cleaned = normalizeQuotes(rawToken)
      .toLowerCase()
      .replace(/%/g, ' percent')
      .replace(/\be-mail/g, 'email')
      .replace(/-/g, ' ')
      .replace(/[^a-z0-9' ]/g, '')
      .replace(/^(\d+)(am|pm)$/, '$1 $2');
    const slots = [];
    for (let piece of cleaned.split(' ')) {
      piece = piece.replace(/^'+|'+$/g, '');
      if (!piece) continue;
      const exp = CONTRACTIONS[piece];
      if (exp) slots.push(exp.map((e) => e.split(' ')));
      else slots.push([[NUMBERS[piece] || SPELLING[piece] || piece]]);
    }
    return slots;
  }

  function analyze(text) {
    return displayTokens(text).map((tok, src) => ({ src, slots: slotsOf(tok) }));
  }

  function mergeCannot(words) {
    const out = [];
    for (let i = 0; i < words.length; i++) {
      if (words[i] === 'can' && words[i + 1] === 'not') {
        out.push('cannot');
        i++;
      } else out.push(words[i]);
    }
    return out;
  }

  // 比較用の文字列の候補をすべて作る（あいまいな短縮形の分だけ増える）
  function canonicalVariants(text) {
    let variants = [[]];
    for (const unit of analyze(text)) {
      for (const slot of unit.slots) {
        if (slot.length === 1 || variants.length * slot.length > MAX_VARIANTS) {
          variants = variants.map((v) => v.concat(slot[0]));
        } else {
          const next = [];
          for (const v of variants) for (const opt of slot) next.push(v.concat(opt));
          variants = next;
        }
      }
    }
    return new Set(variants.map((v) => mergeCannot(v).filter((w) => !OPTIONAL.has(w)).join(' ')));
  }

  // 差分表示用：代表の展開形を、元の単語の位置つきで並べる
  function primaryWords(text) {
    const out = [];
    for (const unit of analyze(text)) {
      for (const slot of unit.slots) {
        for (const w of slot[0]) out.push({ word: w, src: unit.src });
      }
    }
    return out;
  }

  function editDistance(a, b) {
    const m = a.length;
    const n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  // 最長共通部分列で、一致しなかった単語に印を付ける
  function diff(userText, answerText) {
    const u = primaryWords(userText);
    const a = primaryWords(answerText);
    const m = u.length;
    const n = a.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = u[i].word === a[j].word ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const uMatched = new Array(m).fill(false);
    const aMatched = new Array(n).fill(false);
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (u[i].word === a[j].word) {
        uMatched[i] = aMatched[j] = true;
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    const userTokens = displayTokens(userText);
    const answerTokens = displayTokens(answerText);
    const userMarks = new Array(userTokens.length).fill(false);
    const answerMarks = new Array(answerTokens.length).fill(false);
    u.forEach((x, k) => { if (!uMatched[k]) userMarks[x.src] = true; });
    a.forEach((x, k) => { if (!aMatched[k]) answerMarks[x.src] = true; });
    return { userTokens, userMarks, answerTokens, answerMarks };
  }

  function closeThreshold(answerWordCount) {
    return Math.max(1, Math.floor(answerWordCount / 5));
  }

  /**
   * @param {string} input 入力した英文
   * @param {string[]} answers 正解と別解
   * @returns {{result: 'correct'|'close'|'wrong', answer: string, distance: number,
   *            userTokens: string[], userMarks: boolean[], answerTokens: string[], answerMarks: boolean[]}}
   */
  function judge(input, answers) {
    const list = answers.filter((x) => String(x).trim());
    if (!list.length) throw new Error('answers is empty');
    const inputWords = primaryWords(input).map((x) => x.word);

    if (inputWords.length) {
      const inputVars = canonicalVariants(input);
      for (const ans of list) {
        for (const v of canonicalVariants(ans)) {
          if (inputVars.has(v)) {
            return Object.assign({ result: 'correct', answer: ans, distance: 0 }, diff(input, ans));
          }
        }
      }
    }

    let best = list[0];
    let bestDist = Infinity;
    let bestLen = 1;
    for (const ans of list) {
      const words = mergeCannot(primaryWords(ans).map((x) => x.word));
      const d = editDistance(mergeCannot(inputWords), words);
      if (d < bestDist) {
        bestDist = d;
        best = ans;
        bestLen = words.length;
      }
    }
    const result = inputWords.length && bestDist <= closeThreshold(bestLen) ? 'close' : 'wrong';
    return Object.assign({ result, answer: best, distance: bestDist }, diff(input, best));
  }

  return { judge, canonicalVariants, editDistance, diff };
});
