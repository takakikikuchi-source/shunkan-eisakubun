(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const UNITS = window.SE_UNITS || [];

  // ---- 保存（ブラウザ内。使えない環境でも動くように） ----
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できなくても続行 */ }
    },
  };

  const settings = Object.assign({ order: 'seq', rate: 1, autoSpeak: true, unitId: UNITS[0] && UNITS[0].id },
    store.get('se.settings', {}));
  const saveSettings = () => store.set('se.settings', settings);

  // 「これも正解」で登録した別解 { 問題ID: [英文, ...] }
  const userAlts = store.get('se.userAlternatives', {});

  function answersOf(q) {
    return q.en.concat(q.alternatives || [], userAlts[q.id] || []);
  }

  // ---- 読み上げ ----
  const tts = 'speechSynthesis' in window;
  let voice = null;
  function pickVoice() {
    if (!tts) return;
    const voices = speechSynthesis.getVoices().filter((v) => /^en[-_]US/i.test(v.lang));
    voice = voices.find((v) => /natural|online/i.test(v.name))
      || voices.find((v) => /google/i.test(v.name))
      || voices[0] || null;
  }
  if (tts) {
    pickVoice();
    speechSynthesis.addEventListener('voiceschanged', pickVoice);
  }
  function speak(text) {
    if (!tts || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    if (voice) u.voice = voice;
    u.rate = settings.rate;
    speechSynthesis.speak(u);
  }

  // ---- 画面切り替え ----
  function show(name) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + name;
    window.scrollTo(0, 0);
  }

  // ---- ホーム ----
  function renderHome() {
    const list = $('unit-list');
    list.textContent = '';
    for (const u of UNITS) {
      const label = document.createElement('label');
      label.className = 'unit';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'unit';
      radio.value = u.id;
      radio.checked = u.id === settings.unitId;
      const body = document.createElement('span');
      const stage = document.createElement('span');
      stage.className = 'stage';
      stage.textContent = 'ステージ' + u.stage;
      const title = document.createElement('div');
      title.textContent = u.title;
      body.append(stage, title);
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = u.questions.length + '問';
      label.append(radio, body, count);
      list.append(label);
    }
    for (const r of document.querySelectorAll('input[name=order]')) r.checked = r.value === settings.order;
    $('auto-speak').checked = settings.autoSpeak;
    $('rate').value = settings.rate;
    $('rate-out').textContent = Number(settings.rate).toFixed(1);
    $('tts-warning').hidden = tts;
    show('home');
  }

  $('rate').addEventListener('input', (e) => {
    settings.rate = Number(e.target.value);
    $('rate-out').textContent = settings.rate.toFixed(1);
    saveSettings();
  });
  $('auto-speak').addEventListener('change', (e) => {
    settings.autoSpeak = e.target.checked;
    saveSettings();
  });
  $('speak-test').addEventListener('click', () => speak('Could you please check the attached document?'));

  $('start').addEventListener('click', () => {
    const checked = document.querySelector('input[name=unit]:checked');
    const unit = UNITS.find((u) => checked && u.id === checked.value) || UNITS[0];
    settings.unitId = unit.id;
    settings.order = document.querySelector('input[name=order]:checked').value;
    saveSettings();
    const qs = unit.questions.slice();
    if (settings.order === 'random') shuffle(qs);
    startSession(qs);
  });

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---- 出題 ----
  let session = null;

  function startSession(questions) {
    session = { questions, index: 0, records: [], startedAt: 0, current: null };
    show('quiz');
    showQuestion();
  }

  function showQuestion() {
    const q = session.questions[session.index];
    const total = session.questions.length;
    $('progress').textContent = (session.index + 1) + ' / ' + total;
    $('bar-fill').style.width = (session.index / total * 100) + '%';
    $('ja').textContent = q.ja;
    const input = $('answer');
    input.value = '';
    input.readOnly = false;
    $('answer-form').querySelectorAll('button').forEach((b) => { b.disabled = false; });
    $('feedback').hidden = true;
    session.current = null;
    input.focus();
    session.startedAt = performance.now();
  }

  function submit(giveUp) {
    if (session.current) return;
    const q = session.questions[session.index];
    const input = $('answer');
    const text = giveUp ? '' : input.value.trim();
    if (!giveUp && !text) { input.focus(); return; }
    const timeMs = performance.now() - session.startedAt;
    const r = SEJudge.judge(text, answersOf(q));
    const rec = { q, input: text, result: r.result, timeMs, overridden: false, answer: r.answer };
    session.records.push(rec);
    session.current = rec;
    input.readOnly = true;
    $('answer-form').querySelectorAll('button').forEach((b) => { b.disabled = true; });
    renderFeedback(q, r, rec);
    if (settings.autoSpeak) speak(r.answer);
    $('next').focus();
  }

  const VERDICT = { correct: '正解', close: '惜しい', wrong: '不正解' };

  function renderTokens(el, tokens, marks, cls) {
    el.textContent = '';
    if (!tokens.length) {
      const s = document.createElement('span');
      s.className = 'empty';
      s.textContent = '（未回答）';
      el.append(s);
      return;
    }
    tokens.forEach((t, i) => {
      if (i) el.append(' ');
      const s = document.createElement('span');
      s.textContent = t;
      if (marks[i]) s.className = cls;
      el.append(s);
    });
  }

  function renderFeedback(q, r, rec) {
    const v = $('verdict');
    v.textContent = VERDICT[r.result];
    v.className = 'verdict ' + r.result;
    const showDiff = r.result !== 'correct';
    renderTokens($('your'), r.userTokens, showDiff ? r.userMarks : [], 'bad');
    renderTokens($('correct'), r.answerTokens, showDiff ? r.answerMarks : [], 'miss');

    const others = answersOf(q).filter((a) => a !== r.answer);
    $('others').hidden = !others.length;
    $('others').textContent = others.length ? 'ほかの正解: ' + others.join(' / ') : '';
    $('note').hidden = !q.note;
    $('note').textContent = q.note || '';
    $('accept').hidden = r.result === 'correct' || !rec.input;
    $('speak').hidden = !tts;
    $('feedback').hidden = false;
  }

  $('answer-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submit(false);
  });
  $('giveup').addEventListener('click', () => submit(true));
  $('speak').addEventListener('click', () => session.current && speak(session.current.answer));

  $('accept').addEventListener('click', () => {
    const rec = session.current;
    if (!rec || !rec.input) return;
    const list = userAlts[rec.q.id] || (userAlts[rec.q.id] = []);
    if (!list.includes(rec.input)) list.push(rec.input);
    store.set('se.userAlternatives', userAlts);
    rec.result = 'correct';
    rec.overridden = true;
    const v = $('verdict');
    v.textContent = '正解（自分で判定・別解に登録しました）';
    v.className = 'verdict correct';
    $('accept').hidden = true;
    $('next').focus();
  });

  function next() {
    if (!session.current) return;
    session.index++;
    if (session.index >= session.questions.length) showResult();
    else showQuestion();
  }
  $('next').addEventListener('click', next);

  $('quit').addEventListener('click', () => {
    if (tts) speechSynthesis.cancel();
    if (!session.records.length) renderHome();
    else showResult();
  });

  // ---- 結果 ----
  function showResult() {
    if (tts) speechSynthesis.cancel();
    const recs = session.records;
    const ok = recs.filter((r) => r.result === 'correct').length;
    const answered = recs.filter((r) => r.input);
    const avg = answered.length ? answered.reduce((s, r) => s + r.timeMs, 0) / answered.length / 1000 : 0;
    $('r-rate').textContent = recs.length ? Math.round(ok / recs.length * 100) + '%' : '-';
    $('r-count').textContent = ok + ' / ' + recs.length;
    $('r-time').textContent = answered.length ? avg.toFixed(1) + '秒' : '-';

    const misses = recs.filter((r) => r.result !== 'correct');
    const ul = $('r-miss');
    ul.textContent = '';
    for (const m of misses) {
      const li = document.createElement('li');
      const q = document.createElement('div');
      q.className = 'q';
      q.textContent = m.q.ja;
      const a = document.createElement('div');
      a.className = 'a';
      a.textContent = 'あなた: ' + (m.input || '（未回答）');
      const c = document.createElement('div');
      c.className = 'c';
      c.textContent = '正解: ' + m.answer;
      li.append(q, a, c);
      ul.append(li);
    }
    $('r-miss-title').textContent = misses.length ? '間違えた問題（' + misses.length + '問）' : '全問正解です';
    $('retry-miss').hidden = !misses.length;
    session.misses = misses.map((m) => m.q);
    show('result');
  }

  $('retry-miss').addEventListener('click', () => startSession(session.misses.slice()));
  $('back-home').addEventListener('click', renderHome);

  renderHome();
})();
