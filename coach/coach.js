/*
 * 英作文コーチ
 *  1. 書きたい日本語を入力
 *  2. Claude が英語にしやすい日本語に言い換える
 *  3. 自分で英文を書く
 *  4. Claude が添削（直した理由・自然な言い方・丁寧さ・点数）→ 保存して復習に使う
 * Claude への質問と保存は claude.ai の非公開ページ（sample / db / user）でだけ動く。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const local = {
    get(k, f) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch (e) { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても続行 */ } },
  };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => (v == null ? '' : String(v));
  const clone = (v) => JSON.parse(JSON.stringify(v));

  // ---- 実行環境 ----
  let sample = null;
  let entriesCol = null;
  let entries = [];

  function warn(msg) {
    const w = $('env-warning');
    w.textContent = msg;
    w.hidden = false;
  }

  // ---- タブ ----
  function showTab(name) {
    for (const t of document.querySelectorAll('.tab')) {
      if (t.dataset.tab === name) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    }
    for (const s of document.querySelectorAll('main > .screen')) s.hidden = s.id !== 'tab-' + name;
    window.scrollTo(0, 0);
  }
  for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => showTab(t.dataset.tab));

  // ---- 読み上げ（ブラウザの機能） ----
  const tts = 'speechSynthesis' in window;
  let voice = null;
  function pickVoice() {
    if (!tts) return;
    const vs = speechSynthesis.getVoices().filter((v) => /^en[-_]US/i.test(v.lang));
    voice = vs.find((v) => /natural|online/i.test(v.name)) || vs.find((v) => /google/i.test(v.name)) || vs[0] || null;
  }
  if (tts) { pickVoice(); speechSynthesis.addEventListener('voiceschanged', pickVoice); }
  function speak(text) {
    if (!tts || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  }
  function sayButton(text) {
    const b = el('button', 'secondary say', '読み上げ');
    b.type = 'button';
    b.hidden = !tts;
    b.addEventListener('click', () => speak(text));
    return b;
  }

  // ---- Claude への質問 ----
  const ERR = {
    not_granted: 'Claude の利用が許可されていません。ページ上部のメニューから許可してください。',
    sampling_disabled: 'このアカウントでは Claude を使えません。',
    rate_limited: '利用回数の上限に達しました。少し時間をおいてからもう一度押してください。',
    session_expired: 'claude.ai へのログインが切れています。ログインし直してください。',
    refused: 'この内容には回答できませんでした。文章を変えてもう一度試してください。',
    invalid_json: 'Claude の回答をうまく読み取れませんでした。もう一度押してください。',
    empty_completion: 'Claude から回答がありませんでした。もう一度押してください。',
    prompt_too_large: '文章が長すぎます。短く分けてください。',
    unavailable: 'このページでは Claude を使えません（claude.ai の非公開ページで開いてください）。',
  };
  const errText = (e) => ERR[e && e.code] || '通信に失敗しました。もう一度押してください。';

  async function ask(prompt, statusBox, label, button) {
    if (!sample) throw { code: 'unavailable' };
    const ctl = new AbortController();
    const text = statusBox.querySelector('.status-text');
    const stop = statusBox.querySelector('.stop');
    statusBox.hidden = false;
    statusBox.classList.remove('error');
    stop.hidden = false;
    stop.onclick = () => ctl.abort();
    if (button) button.disabled = true;
    const t0 = Date.now();
    const tick = () => { text.textContent = label + '（' + Math.round((Date.now() - t0) / 1000) + '秒）'; };
    tick();
    const timer = setInterval(tick, 1000);
    try {
      const res = await sample.json(prompt, { signal: ctl.signal });
      statusBox.hidden = true;
      return res;
    } finally {
      clearInterval(timer);
      if (button) button.disabled = false;
    }
  }
  function showError(statusBox, e) {
    if (e && e.code === 'cancelled') { statusBox.hidden = true; return; }
    statusBox.hidden = false;
    statusBox.classList.add('error');
    statusBox.querySelector('.status-text').textContent = errText(e);
    statusBox.querySelector('.stop').hidden = true;
  }

  function contextLines(scene, audience) {
    return '場面: ' + (scene || '指定なし（文面から判断してください）') + '\n相手: ' + (audience || '指定なし（文面から判断してください）');
  }

  function easyPrompt(src, scene, audience) {
    return [
      'あなたは日本人ビジネスパーソン向けの英作文コーチです。',
      '学習者が書いた日本語を、英語に訳しやすい日本語に言い換えてください（和文和訳）。学習者はあなたの言い換えを見ながら、自分で英文を組み立てます。',
      '',
      'ルール:',
      '- 主語と目的語を補い、「誰が・何を・どうする」をはっきりさせる',
      '- 長い文は区切り、1文に1つのメッセージにする',
      '- 「よろしくお願いします」「お世話になっております」「検討します」「対応します」など英語に直訳しにくい表現は、英語で言える具体的な意味に置き換える',
      '- 敬語は簡潔にし、丁寧さは「丁寧にお願いする」のように意図として残す',
      '- 時制・数・期限・条件をはっきりさせる',
      '- 元の文の意図や情報は変えない。足しすぎない',
      '- easyJa には英単語や英文を入れない（英語は keyPhrases にだけ書く）',
      '',
      contextLines(scene, audience),
      '',
      '学習者の日本語:',
      '"""',
      src,
      '"""',
      '',
      '次の形の JSON だけを返してください:',
      '{"easyJa": "言い換えた日本語", "points": ["どこをどう言い換えたか（短く、2〜5個）"], "keyPhrases": ["使えそうな英語の型（例: Could you 〜?）を2〜5個"], "scene": "想定した場面（短く）", "tone": "想定した丁寧さ（丁寧 / 普通 / カジュアル など）"}',
    ].join('\n');
  }

  function evalPrompt(ctx, mine) {
    return [
      'あなたはアメリカ英語のネイティブで、日本人ビジネスパーソンを教える英語講師です。学習者の英文を添削してください。',
      '説明はすべて日本語で、学習者が次に同じ間違いをしないように具体的に書いてください。',
      '',
      '元の日本語: ' + ctx.src,
      '英語にしやすく言い換えた日本語: ' + ctx.easyJa,
      contextLines(ctx.scene, ctx.audience),
      ctx.sceneGuess ? '想定した場面: ' + ctx.sceneGuess : null,
      ctx.tone ? '想定した丁寧さ: ' + ctx.tone : null,
      '',
      '学習者の英文:',
      '"""',
      mine,
      '"""',
      '',
      '添削のしかた:',
      '- corrected: 学習者の英文をできるだけ活かし、必要な所だけ直した版。直す所がなければ学習者の英文そのまま',
      '- changes: 直した箇所ごとに、元の表現 from・直した表現 to・理由 reason。reason には「なぜダメだったか」（文法の誤り / 語法・コロケーション / 不自然 / 意味のずれ・抜け / 丁寧さ）を必ず含める。直していない部分は書かない',
      '- 元の日本語の意味が英文から抜けている・ずれている場合は、必ず changes で指摘する',
      '- good: 良かった点を1〜2個',
      '- natural: ネイティブがこの場面で使う、より自然な言い方を2〜3個。それぞれのニュアンスや使い分けを日本語で',
      '- tone: 場面と相手に対して丁寧さが適切か。label は「適切」「丁寧すぎる」「くだけすぎ」「失礼になりうる」のどれか',
      '- score: 100点満点。breakdown は accuracy（意味と文法の正確さ 0〜40）、naturalness（自然さ 0〜30）、tone（丁寧さ・トーン 0〜30）で、合計が score',
      '- best: 復習用のお手本を1つ（アメリカ英語で、この場面で一番おすすめの言い方）',
      '',
      '次の形の JSON だけを返してください:',
      '{"score": 0, "breakdown": {"accuracy": 0, "naturalness": 0, "tone": 0}, "summary": "ひとことの講評", "corrected": "...", "changes": [{"from": "...", "to": "...", "reason": "..."}], "good": ["..."], "natural": [{"en": "...", "nuance": "..."}], "tone": {"label": "適切", "comment": "..."}, "best": "..."}',
    ].filter((l) => l !== null).join('\n');
  }

  function normEasy(r) {
    if (!r || typeof r !== 'object' || !str(r.easyJa).trim()) throw { code: 'invalid_json' };
    return {
      easyJa: str(r.easyJa).trim(),
      points: arr(r.points).map(str).filter(Boolean),
      keyPhrases: arr(r.keyPhrases).map(str).filter(Boolean),
      sceneGuess: str(r.scene),
      tone: str(r.tone),
    };
  }

  function normEval(r, mine) {
    if (!r || typeof r !== 'object') throw { code: 'invalid_json' };
    const num = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    const b = r.breakdown || {};
    const breakdown = { accuracy: num(b.accuracy, 40), naturalness: num(b.naturalness, 30), tone: num(b.tone, 30) };
    let score = num(r.score, 100);
    if (!score && (breakdown.accuracy || breakdown.naturalness || breakdown.tone)) score = breakdown.accuracy + breakdown.naturalness + breakdown.tone;
    const corrected = str(r.corrected).trim() || mine;
    return {
      score,
      breakdown,
      summary: str(r.summary),
      corrected,
      changes: arr(r.changes).map((c) => ({ from: str(c && c.from), to: str(c && c.to), reason: str(c && c.reason) })).filter((c) => c.reason || c.to),
      good: arr(r.good).map(str).filter(Boolean),
      natural: arr(r.natural).map((n) => ({ en: str(n && n.en), nuance: str(n && n.nuance) })).filter((n) => n.en),
      tone: { label: str(r.tone && r.tone.label) || '—', comment: str(r.tone && r.tone.comment) },
      best: str(r.best).trim() || corrected,
    };
  }

  // ---- 添削結果の表示 ----
  function enWithMarks(text, marks) {
    const p = el('p', 'en-block');
    const tokens = text.trim().split(/\s+/);
    tokens.forEach((t, i) => {
      if (i) p.append(' ');
      p.append(el('span', marks && marks[i] ? 'ins' : '', t));
    });
    return p;
  }

  function buildEvalView(ev, mine) {
    const root = el('div', 'ev');

    const row = el('div', 'score-row');
    const score = el('div', 'score ' + (ev.score >= 80 ? 'hi' : ev.score >= 60 ? 'mid' : 'lo'), String(ev.score));
    score.append(el('small', '', '/100'));
    const dl = el('dl', 'breakdown');
    for (const [k, label, max] of [['accuracy', '正確さ', 40], ['naturalness', '自然さ', 30], ['tone', '丁寧さ・トーン', 30]]) {
      const d = el('div');
      d.append(el('dt', '', label), el('dd', '', ev.breakdown[k] + '/' + max));
      dl.append(d);
    }
    row.append(score, dl);
    root.append(row);
    if (ev.summary) root.append(el('p', 'summary', ev.summary));

    root.append(el('h3', '', '直した英文'));
    const d = window.SEJudge ? SEJudge.diff(mine, ev.corrected) : null;
    const same = d && !d.answerMarks.some(Boolean) && !d.userMarks.some(Boolean);
    const cRow = el('div', 'best-row');
    cRow.append(enWithMarks(ev.corrected, d && d.answerMarks), sayButton(ev.corrected));
    root.append(cRow);
    if (same) root.append(el('p', 'muted small', '直すところはありませんでした。'));

    root.append(el('h3', '', '直したところと理由'));
    if (ev.changes.length) {
      const ul = el('ul', 'ev-list');
      for (const c of ev.changes) {
        const li = el('li', 'change');
        if (c.from) li.append(el('span', 'from', c.from));
        if (c.to) li.append(el('span', 'to', '→ ' + c.to));
        if (c.reason) li.append(el('span', 'why', c.reason));
        ul.append(li);
      }
      root.append(ul);
    } else {
      root.append(el('p', 'muted small', 'ありません。'));
    }

    if (ev.good.length) {
      root.append(el('h3', '', '良かったところ'));
      const ul = el('ul', 'ev-list');
      for (const g of ev.good) ul.append(el('li', '', g));
      root.append(ul);
    }

    if (ev.natural.length) {
      root.append(el('h3', '', 'より自然な言い方'));
      const ul = el('ul', 'ev-list');
      for (const n of ev.natural) {
        const li = el('li', 'nat');
        const line = el('div', 'best-row');
        line.append(el('span', 'en-line', n.en), sayButton(n.en));
        li.append(line);
        if (n.nuance) li.append(el('span', 'nuance', n.nuance));
        ul.append(li);
      }
      root.append(ul);
    }

    root.append(el('h3', '', '丁寧さ・トーン'));
    const tone = el('p');
    const cls = /適切/.test(ev.tone.label) ? 'ok' : /失礼/.test(ev.tone.label) ? 'ng' : 'warn';
    tone.append(el('span', 'pill ' + cls, ev.tone.label), ev.tone.comment);
    root.append(tone);

    root.append(el('h3', '', 'お手本（復習で使います）'));
    const bRow = el('div', 'best-row');
    bRow.append(el('p', 'en-block', ev.best), sayButton(ev.best));
    root.append(bRow);
    return root;
  }

  // ---- 保存 ----
  function answersFor(e) {
    const list = [e.best, e.corrected];
    for (const n of arr(e.natural)) list.push(n.en);
    for (const a of arr(e.attempts)) if (a.score >= 90) list.push(a.en);
    return [...new Set(list.map(str).filter((s) => s.trim()))];
  }

  function entryFromEval(base, ev, mine, from) {
    const e = base ? clone(base) : { createdAt: Date.now(), review: { count: 0, correct: 0, lastAt: 0 } };
    e.updatedAt = Date.now();
    e.best = ev.best;
    e.corrected = ev.corrected;
    e.natural = ev.natural;
    e.lastEval = ev;
    e.lastMine = mine;
    e.bestScore = Math.max(Number(e.bestScore) || 0, ev.score);
    e.attempts = arr(e.attempts).concat([{ en: mine, score: ev.score, at: Date.now(), from }]).slice(-20);
    return e;
  }

  async function saveEntry(id, data) {
    if (!entriesCol) throw new Error('no db');
    const ref = id ? entriesCol.doc(id) : entriesCol.doc();
    await ref.set(data);
    return ref.id;
  }

  // ---- 1〜4: 書く ----
  const draft = Object.assign({ src: '', scene: '', audience: '', easy: null, mine: '', ev: null, entryId: null, entry: null },
    local.get('coach.draft', {}));
  const saveDraft = () => local.set('coach.draft', draft);

  function renderEasy() {
    const e = draft.easy;
    $('step2').hidden = !e;
    $('step3').hidden = !e;
    if (!e) return;
    $('easy').value = e.easyJa;
    const pts = $('easy-points');
    pts.textContent = '';
    for (const p of e.points) pts.append(el('li', '', p));
    const ph = $('phrases');
    ph.textContent = '';
    for (const p of e.keyPhrases) ph.append(el('li', '', p));
    $('phrases-box').hidden = !e.keyPhrases.length;
  }

  function renderEval() {
    $('step4').hidden = !draft.ev;
    const view = $('eval-view');
    view.textContent = '';
    if (draft.ev) view.append(buildEvalView(draft.ev, draft.mine));
  }

  function restoreDraft() {
    $('src').value = draft.src;
    $('scene').value = draft.scene;
    $('audience').value = draft.audience;
    $('mine').value = draft.mine;
    renderEasy();
    renderEval();
    $('saved-status').textContent = draft.entryId ? '保存済み（履歴・復習に追加されています）' : '';
  }

  $('src').addEventListener('input', () => { draft.src = $('src').value; saveDraft(); });
  $('scene').addEventListener('change', () => { draft.scene = $('scene').value; saveDraft(); });
  $('audience').addEventListener('change', () => { draft.audience = $('audience').value; saveDraft(); });
  $('mine').addEventListener('input', () => { draft.mine = $('mine').value; saveDraft(); });
  $('easy').addEventListener('input', () => { if (draft.easy) { draft.easy.easyJa = $('easy').value; saveDraft(); } });

  $('btn-easy').addEventListener('click', async () => {
    const src = $('src').value.trim();
    if (!src) { $('src').focus(); return; }
    const box = $('easy-status');
    try {
      const r = normEasy(await ask(easyPrompt(src, draft.scene, draft.audience), box, '英語にしやすい日本語を考えています', $('btn-easy')));
      Object.assign(draft, { src, easy: r, mine: '', ev: null, entryId: null, entry: null });
      saveDraft();
      $('mine').value = '';
      $('saved-status').textContent = '';
      renderEasy();
      renderEval();
      $('step2').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('mine').focus({ preventScroll: true });
    } catch (e) {
      showError(box, e);
    }
  });

  async function evaluateWrite() {
    const mine = $('mine').value.trim();
    if (!mine || !draft.easy) { $('mine').focus(); return; }
    const box = $('eval-status');
    const ctx = { src: draft.src, easyJa: $('easy').value.trim() || draft.easy.easyJa, scene: draft.scene, audience: draft.audience,
      sceneGuess: draft.easy.sceneGuess, tone: draft.easy.tone };
    let ev;
    try {
      ev = normEval(await ask(evalPrompt(ctx, mine), box, '添削しています', $('btn-eval')), mine);
    } catch (e) {
      showError(box, e);
      return;
    }
    draft.mine = mine;
    draft.ev = ev;
    saveDraft();
    renderEval();
    $('step4').scrollIntoView({ behavior: 'smooth', block: 'start' });

    // 保存
    const status = $('saved-status');
    if (!entriesCol) { status.textContent = '保存機能が使えないため、この添削は保存されていません。'; return; }
    // 保存済みなら最新の保存内容（復習の記録を含む）を土台にする
    const saved = draft.entryId && entries.find((x) => x.id === draft.entryId);
    const base = saved ? clone(saved) : (draft.entry || { createdAt: Date.now(), review: { count: 0, correct: 0, lastAt: 0 } });
    delete base.id;
    Object.assign(base, { src: ctx.src, scene: draft.scene, audience: draft.audience, easyJa: ctx.easyJa,
      points: draft.easy.points, keyPhrases: draft.easy.keyPhrases, sceneGuess: draft.easy.sceneGuess, tone: draft.easy.tone });
    const entry = entryFromEval(base, ev, mine, 'write');
    status.textContent = '保存しています…';
    try {
      draft.entryId = await saveEntry(draft.entryId, entry);
      draft.entry = entry;
      saveDraft();
      status.textContent = '保存しました（履歴・復習に追加されています）';
    } catch (e) {
      status.textContent = '保存できませんでした：' + (e && e.code === 'quota_exceeded' ? '保存できる件数の上限です。履歴から古いものを削除してください。' : '通信を確認して、もう一度「添削する」を押してください。');
    }
  }
  $('btn-eval').addEventListener('click', evaluateWrite);
  $('mine').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); evaluateWrite(); }
  });

  $('btn-retry').addEventListener('click', () => {
    $('step3').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('mine').focus({ preventScroll: true });
  });
  $('btn-new').addEventListener('click', () => {
    Object.assign(draft, { src: '', easy: null, mine: '', ev: null, entryId: null, entry: null });
    saveDraft();
    restoreDraft();
    window.scrollTo(0, 0);
    $('src').focus();
  });

  // ---- 復習 ----
  let rv = null;

  function renderReviewHome() {
    const usable = entries.filter((e) => e.best);
    const never = usable.filter((e) => !(e.review && e.review.count)).length;
    $('review-summary').textContent = usable.length
      ? '保存した文章 ' + usable.length + '件（まだ復習していない文章 ' + never + '件）'
      : 'まだ保存された文章はありません。「書く」で添削すると、ここで復習できるようになります。';
    $('btn-review-old').disabled = !usable.length;
    $('btn-review-random').disabled = !usable.length;
    const badge = $('review-badge');
    badge.hidden = !never;
    badge.textContent = String(never);
  }

  function startReview(mode) {
    let list = entries.filter((e) => e.best);
    if (!list.length) return;
    if (mode === 'random') {
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    } else {
      list = list.slice().sort((a, b) => ((a.review && a.review.lastAt) || 0) - ((b.review && b.review.lastAt) || 0) || a.createdAt - b.createdAt);
    }
    rv = { list: list.slice(0, 10), i: 0, ok: 0, cur: null };
    $('review-home').hidden = true;
    $('review-result').hidden = true;
    $('review-quiz').hidden = false;
    showReviewQuestion();
  }

  function showReviewQuestion() {
    const e = rv.list[rv.i];
    $('rv-progress').textContent = (rv.i + 1) + ' / ' + rv.list.length;
    $('rv-bar').style.width = (rv.i / rv.list.length * 100) + '%';
    $('rv-easy').textContent = e.easyJa || e.src;
    $('rv-src').textContent = e.src;
    $('rv-answer').value = '';
    $('rv-answer').readOnly = false;
    $('rv-form').querySelectorAll('button').forEach((b) => { b.disabled = false; });
    $('rv-feedback').hidden = true;
    $('rv-eval').textContent = '';
    $('rv-status').hidden = true;
    rv.cur = null;
    $('rv-answer').focus();
  }

  function renderTokens(target, tokens, marks, cls) {
    target.textContent = '';
    if (!tokens.length) { target.append(el('span', 'empty', '（未回答）')); return; }
    tokens.forEach((t, i) => {
      if (i) target.append(' ');
      target.append(el('span', marks[i] ? cls : '', t));
    });
  }

  async function submitReview(giveUp) {
    if (!rv || rv.cur) return;
    const e = rv.list[rv.i];
    const text = giveUp ? '' : $('rv-answer').value.trim();
    if (!giveUp && !text) { $('rv-answer').focus(); return; }
    const r = SEJudge.judge(text, answersFor(e));
    rv.cur = { entry: e, text, result: r.result, answer: r.answer, claudeOk: false };
    if (r.result === 'correct') rv.ok++;
    $('rv-answer').readOnly = true;
    $('rv-form').querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const v = $('rv-verdict');
    v.textContent = { correct: '正解', close: '惜しい', wrong: '不正解' }[r.result];
    v.className = 'verdict ' + r.result;
    const showDiff = r.result !== 'correct';
    renderTokens($('rv-your'), r.userTokens, showDiff ? r.userMarks : [], 'bad');
    renderTokens($('rv-correct'), r.answerTokens, showDiff ? r.answerMarks : [], 'miss');
    const others = answersFor(e).filter((a) => a !== r.answer);
    $('rv-others').hidden = !others.length;
    $('rv-others').textContent = others.length ? 'ほかの正解: ' + others.join(' / ') : '';
    $('rv-ask').hidden = !text || !sample;
    $('rv-speak').hidden = !tts;
    $('rv-feedback').hidden = false;
    $('rv-next').focus();

    if (entriesCol) {
      const rev = Object.assign({ count: 0, correct: 0, lastAt: 0 }, e.review || {});
      rev.count += 1;
      if (r.result === 'correct') rev.correct += 1;
      rev.lastAt = Date.now();
      rev.lastResult = r.result;
      rv.cur.rev = rev;
      try { await entriesCol.doc(e.id).update({ review: rev }); } catch (err) { /* 記録できなくても続行 */ }
    }
  }

  $('rv-form').addEventListener('submit', (ev) => { ev.preventDefault(); submitReview(false); });
  $('rv-answer').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); submitReview(false); }
  });
  $('rv-giveup').addEventListener('click', () => submitReview(true));
  $('rv-speak').addEventListener('click', () => rv && rv.cur && speak(rv.cur.answer));

  $('rv-ask').addEventListener('click', async () => {
    const c = rv && rv.cur;
    if (!c || !c.text) return;
    const e = c.entry;
    const box = $('rv-status');
    let ev;
    try {
      ev = normEval(await ask(evalPrompt({ src: e.src, easyJa: e.easyJa, scene: e.scene, audience: e.audience, sceneGuess: e.sceneGuess, tone: e.tone }, c.text),
        box, '添削しています', $('rv-ask')), c.text);
    } catch (err) {
      showError(box, err);
      return;
    }
    const view = $('rv-eval');
    view.textContent = '';
    view.append(buildEvalView(ev, c.text));
    if (ev.score >= 90 && c.result !== 'correct' && !c.claudeOk) {
      c.claudeOk = true;
      rv.ok++;
      const v = $('rv-verdict');
      v.textContent = '正解（Claude の判定 ' + ev.score + '点）';
      v.className = 'verdict correct';
    }
    if (entriesCol) {
      // お手本（best）は最初の添削のものを使い続け、挑戦の記録と点数だけ更新する
      const patch = {
        attempts: arr(e.attempts).concat([{ en: c.text, score: ev.score, at: Date.now(), from: 'review' }]).slice(-20),
        bestScore: Math.max(Number(e.bestScore) || 0, ev.score),
        lastEval: ev,
        lastMine: c.text,
        updatedAt: Date.now(),
      };
      if (c.claudeOk && c.rev) { c.rev.correct += 1; patch.review = c.rev; }
      try { await entriesCol.doc(e.id).update(patch); } catch (err) { /* 記録できなくても続行 */ }
    }
  });

  $('rv-next').addEventListener('click', () => {
    if (!rv || !rv.cur) return;
    rv.i++;
    if (rv.i >= rv.list.length) {
      $('review-quiz').hidden = true;
      $('review-result').hidden = false;
      $('rv-result-text').textContent = rv.list.length + '問中 ' + rv.ok + '問正解';
      if (tts) speechSynthesis.cancel();
    } else {
      showReviewQuestion();
    }
  });
  $('rv-quit').addEventListener('click', () => {
    if (tts) speechSynthesis.cancel();
    rv = null;
    $('review-quiz').hidden = true;
    $('review-home').hidden = false;
  });
  $('rv-back').addEventListener('click', () => {
    $('review-result').hidden = true;
    $('review-home').hidden = false;
  });
  $('btn-review-old').addEventListener('click', () => startReview('old'));
  $('btn-review-random').addEventListener('click', () => startReview('random'));

  // ---- 履歴 ----
  const openIds = new Set();
  const fmtDate = (ms) => {
    const d = new Date(ms);
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  };

  function renderHistory() {
    const list = $('history-list');
    list.textContent = '';
    $('history-empty').hidden = entries.length > 0;
    $('history-count').textContent = entries.length ? '（' + entries.length + '件）' : '';
    for (const e of entries) {
      const li = el('li');
      const det = el('details');
      det.open = openIds.has(e.id);
      det.addEventListener('toggle', () => { if (det.open) openIds.add(e.id); else openIds.delete(e.id); });
      const sum = el('summary');
      sum.append(el('span', 'h-src', str(e.src).split('\n')[0]), el('span', 'h-score', (e.bestScore || 0) + '点'));
      const meta = [fmtDate(e.createdAt), e.scene || e.sceneGuess, e.review && e.review.count ? '復習 ' + e.review.correct + '/' + e.review.count : '未復習'].filter(Boolean).join(' ・ ');
      sum.append(el('span', 'h-meta', meta));
      det.append(sum);

      const body = el('div', 'h-body');
      body.append(el('h4', '', '元の文章'), el('p', '', e.src));
      body.append(el('h4', '', '英語にしやすい日本語'), el('p', '', e.easyJa));
      body.append(el('h4', '', 'お手本'));
      const b = el('div', 'best-row');
      b.append(el('p', 'en-block', e.best), sayButton(e.best));
      body.append(b);
      if (arr(e.natural).length) {
        body.append(el('h4', '', 'より自然な言い方'));
        const ul = el('ul', 'ev-list');
        for (const n of e.natural) {
          const it = el('li', 'nat');
          it.append(el('span', 'en-line', n.en));
          if (n.nuance) it.append(el('span', 'nuance', n.nuance));
          ul.append(it);
        }
        body.append(ul);
      }
      const last = arr(e.attempts).slice(-1)[0];
      if (last) {
        body.append(el('h4', '', 'あなたの英文（最新・' + last.score + '点）'), el('p', 'en-block', last.en));
      }
      const del = el('button', 'secondary danger', 'この文章を削除');
      del.type = 'button';
      let armed = false;
      del.addEventListener('click', async () => {
        if (!armed) { armed = true; del.textContent = 'もう一度押すと削除します'; return; }
        del.disabled = true;
        try {
          await entriesCol.doc(e.id).delete();
          if (draft.entryId === e.id) { draft.entryId = null; draft.entry = null; saveDraft(); }
        } catch (err) {
          del.disabled = false;
          del.textContent = '削除できませんでした。もう一度押してください';
          armed = false;
        }
      });
      const row = el('div', 'row');
      row.append(del);
      body.append(row);
      det.append(body);
      li.append(det);
      list.append(li);
    }
  }

  // ---- 起動 ----
  restoreDraft();
  renderReviewHome();
  renderHistory();

  async function init() {
    const C = window.claude;
    if (!C || typeof C.use !== 'function') {
      warn('このページは claude.ai の非公開ページで開いたときだけ、Claude への質問と保存が使えます。');
      $('btn-easy').disabled = true;
      $('btn-eval').disabled = true;
      return;
    }
    const [s, db, user] = await Promise.all([C.use('sample'), C.use('db'), C.use('user')]);
    sample = s;
    if (!sample) {
      warn('このページでは Claude を使えません。claude.ai にログインして、非公開ページとして開いてください。');
      $('btn-easy').disabled = true;
      $('btn-eval').disabled = true;
    }
    let uid = null;
    try { uid = user ? await user.id() : null; } catch (e) { uid = null; }
    if (db && uid) {
      try {
        entriesCol = db.doc('data/users/' + uid + '/notebook').collection('entries');
      } catch (e) {
        entriesCol = null;
      }
    }
    if (!entriesCol) {
      warn((sample ? '' : 'Claude と ') + '保存機能が使えません。添削はできますが、履歴と復習には残りません。');
      return;
    }
    const empty = $('history-empty');
    const loadingTimer = setTimeout(() => {
      empty.hidden = false;
      empty.textContent = '保存した文章を読み込めていません。通信状況を確認してください。';
    }, 10000);
    entriesCol.orderBy('createdAt', 'desc').limit(1000).onSnapshot((snap) => {
      if (!snap.metadata.fromCache) clearTimeout(loadingTimer);
      entries = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      renderReviewHome();
      renderHistory();
    }, () => {
      clearTimeout(loadingTimer);
      empty.hidden = false;
      empty.textContent = '保存した文章を読み込めませんでした。ページを開き直してください。';
    });
  }
  init();
})();
