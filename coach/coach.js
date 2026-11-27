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
  const narrow = () => window.matchMedia('(max-width: 959px)').matches;
  const scoreClass = (s) => (s >= 80 ? 'hi' : s >= 60 ? 'mid' : 'lo');

  // ---- 実行環境 ----
  let sample = null;
  let entriesCol = null;
  let entries = [];

  function warn(msg) {
    const w = $('env-warning');
    w.textContent = msg;
    w.hidden = false;
  }

  // ---- 入力欄を中身に合わせて伸ばす ----
  function autoGrow(t) {
    t.style.height = 'auto';
    t.style.height = (t.scrollHeight + 2) + 'px';
  }
  for (const t of document.querySelectorAll('textarea.grow')) t.addEventListener('input', () => autoGrow(t));
  const growAll = () => { for (const t of document.querySelectorAll('textarea.grow')) if (t.offsetParent) autoGrow(t); };
  window.addEventListener('resize', growAll);

  // ---- 開閉ボタン ----
  function bindToggle(btn, target) {
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      target.hidden = !open;
    });
  }
  function closeToggle(btn, target) {
    btn.setAttribute('aria-expanded', 'false');
    target.hidden = true;
  }
  bindToggle($('toggle-points'), $('easy-points'));
  bindToggle($('toggle-phrases'), $('phrases'));
  bindToggle($('toggle-rv-src'), $('rv-src'));

  // ---- タブ ----
  function showTab(name) {
    for (const t of document.querySelectorAll('.tab')) {
      if (t.dataset.tab === name) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    }
    for (const s of document.querySelectorAll('main > .screen')) s.hidden = s.id !== 'tab-' + name;
    window.scrollTo(0, 0);
    growAll();
  }
  for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => showTab(t.dataset.tab));

  // ---- 読み上げ ----
  // Claude の声（tts）が使える画面ではそれを使い、使えない画面（Safari・Claude アプリなど）はブラウザの声を使う。
  const CLAUDE_VOICES = [['buttery', 'Claude の声 1（標準）'], ['airy', 'Claude の声 2'], ['glassy', 'Claude の声 3'], ['rounded', 'Claude の声 4']];
  const browserTts = 'speechSynthesis' in window;
  let ttsCap = null;          // Claude の声
  let claudeVoiceOff = false; // 権限メニューで読み上げが切られた
  const voiceSettings = Object.assign({ voice: 'buttery', rate: 1 }, local.get('coach.voice', {}));
  let browserVoice = null;
  let playingBtn = null;

  function pickBrowserVoice() {
    if (!browserTts) return;
    const vs = speechSynthesis.getVoices().filter((v) => /^en[-_]US/i.test(v.lang));
    browserVoice = vs.find((v) => /natural|online/i.test(v.name)) || vs.find((v) => /google/i.test(v.name)) || vs[0] || null;
  }
  if (browserTts) { pickBrowserVoice(); speechSynthesis.addEventListener('voiceschanged', pickBrowserVoice); }

  const useClaudeVoice = () => !!ttsCap && !claudeVoiceOff && voiceSettings.voice !== 'browser';

  function setPlaying(btn) {
    if (playingBtn) {
      playingBtn.classList.remove('playing');
      playingBtn.setAttribute('aria-label', '読み上げ');
    }
    playingBtn = btn || null;
    if (playingBtn) {
      playingBtn.classList.add('playing');
      playingBtn.setAttribute('aria-label', '読み上げを止める');
    }
  }

  function voiceNote(msg) { $('voice-note').textContent = msg || ''; }

  function browserSpeak(text, btn) {
    if (!browserTts) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    if (browserVoice) u.voice = browserVoice;
    u.rate = voiceSettings.rate;
    u.onend = u.onerror = () => { if (playingBtn === btn) setPlaying(null); };
    setPlaying(btn);
    speechSynthesis.speak(u);
  }

  function stopSpeaking() {
    if (ttsCap) ttsCap.stop().catch(() => {});
    if (browserTts) speechSynthesis.cancel();
    setPlaying(null);
  }

  function speak(text, btn) {
    if (!text) return;
    if (btn && btn === playingBtn) { stopSpeaking(); return; } // 読み上げ中にもう一度押すと止める
    if (!useClaudeVoice()) { browserSpeak(text, btn); return; }
    if (browserTts) speechSynthesis.cancel();
    setPlaying(btn);
    ttsCap.speak(text, { voice: voiceSettings.voice, rate: voiceSettings.rate, language: 'en' })
      .then(() => { if (playingBtn === btn) setPlaying(null); })
      .catch((e) => {
        if (playingBtn === btn) setPlaying(null);
        const code = e && e.code;
        if (code === 'stopped' || code === 'no_gesture' || code === 'busy') return;
        if (code === 'not_granted') {
          // 本人が読み上げを切ったので、別の声でも読まない
          claudeVoiceOff = true;
          buildVoiceSelect();
          voiceNote('Claude の声はオフになっています。ページの「権限」メニューで戻せます。ブラウザの声を選ぶこともできます。');
          return;
        }
        // 上限・一時的な不調のときはブラウザの声で読む
        voiceNote(code === 'rate_limited' ? 'Claude の声の上限に達したため、今回はブラウザの声で読みました。少し時間をおくと戻ります。' : 'Claude の声が使えなかったため、ブラウザの声で読みました。');
        browserSpeak(text, btn);
      });
  }

  function buildVoiceSelect() {
    const sel = $('voice-select');
    sel.textContent = '';
    if (ttsCap && !claudeVoiceOff) {
      for (const [id, label] of CLAUDE_VOICES) {
        const o = el('option', '', label);
        o.value = id;
        sel.append(o);
      }
    }
    if (browserTts) {
      const o = el('option', '', 'ブラウザの声');
      o.value = 'browser';
      sel.append(o);
    }
    const ids = [...sel.options].map((o) => o.value);
    sel.value = ids.includes(voiceSettings.voice) ? voiceSettings.voice : (ids[0] || '');
    if (!ttsCap) voiceNote('この画面では Claude の声は使えません（Safari・Firefox・Claude のスマホアプリなど）。ブラウザの声で読みます。');
  }
  $('voice-select').addEventListener('change', (e) => {
    voiceSettings.voice = e.target.value;
    local.set('coach.voice', voiceSettings);
  });
  $('voice-rate').value = String(voiceSettings.rate);
  $('voice-rate-out').textContent = Number(voiceSettings.rate).toFixed(1);
  $('voice-rate').addEventListener('input', (e) => {
    voiceSettings.rate = Number(e.target.value);
    $('voice-rate-out').textContent = voiceSettings.rate.toFixed(1);
    local.set('coach.voice', voiceSettings);
  });
  $('voice-test').addEventListener('click', () => speak('Could you please send us the revised quote by the end of this week?', $('voice-test')));
  $('voice-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = $('voice-panel').hidden;
    $('voice-panel').hidden = !open;
    $('voice-toggle').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!$('voice-panel').hidden && !e.target.closest('.voice-menu')) {
      $('voice-panel').hidden = true;
      $('voice-toggle').setAttribute('aria-expanded', 'false');
    }
  });
  buildVoiceSelect();

  function speakButton(text) {
    const b = el('button', 'icon-btn');
    b.type = 'button';
    b.title = '読み上げ（もう一度押すと止まります）';
    b.setAttribute('aria-label', '読み上げ');
    b.hidden = !browserTts && !ttsCap;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const d of ['M11 5 6 9H2v6h4l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14']) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    b.append(svg);
    b.addEventListener('click', () => speak(text, b));
    return b;
  }

  // ---- Claude への質問 ----
  const ERR = {
    not_granted: 'Claude の利用が許可されていません。ページのメニューから許可してください。',
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
  function enBox(text, opts) {
    const box = el('div', 'en-box' + (opts && opts.model ? ' model' : ''));
    const p = el('p');
    if (opts && opts.marks) {
      text.trim().split(/\s+/).forEach((t, i) => {
        if (i) p.append(' ');
        p.append(el('span', opts.marks[i] ? 'ins' : '', t));
      });
    } else {
      p.textContent = text;
    }
    box.append(p, speakButton(text));
    return box;
  }

  function section(title) {
    const s = el('div', 'ev-sec');
    s.append(el('h3', '', title));
    return s;
  }

  function buildEvalView(ev, mine) {
    const root = el('div', 'ev');

    // 見出し：点数・講評・内訳・トーン
    const head = el('div', 'ev-head');
    head.append(el('div', 'ring ' + scoreClass(ev.score), String(ev.score)));
    const meta = el('div', 'ev-meta');
    if (ev.summary) meta.append(el('p', 'ev-summary', ev.summary));
    const meters = el('div', 'meters');
    for (const [k, label, max] of [['accuracy', '正確さ', 40], ['naturalness', '自然さ', 30], ['tone', '丁寧さ', 30]]) {
      const m = el('div', 'meter');
      const top = el('div', 'meter-top');
      top.append(el('span', '', label), el('b', '', ev.breakdown[k] + '/' + max));
      const track = el('div', 'track');
      const fill = el('div', 'fill');
      fill.style.width = Math.round(ev.breakdown[k] / max * 100) + '%';
      track.append(fill);
      m.append(top, track);
      meters.append(m);
    }
    meta.append(meters);
    head.append(meta);
    const tone = el('p', 'tone-line');
    const cls = /適切/.test(ev.tone.label) ? 'ok' : /失礼/.test(ev.tone.label) ? 'ng' : 'warn';
    tone.append(el('span', 'pill ' + cls, 'トーン：' + ev.tone.label), ev.tone.comment);
    head.append(tone);
    root.append(head);

    // 直した英文
    const d = window.SEJudge ? SEJudge.diff(mine, ev.corrected) : null;
    const same = d && !d.answerMarks.some(Boolean) && !d.userMarks.some(Boolean);
    const sc = section(same ? '直した英文（直すところはありませんでした）' : '直した英文（印が直したところ）');
    sc.append(enBox(ev.corrected, { marks: d && d.answerMarks }));
    root.append(sc);

    // 理由
    if (ev.changes.length) {
      const s = section('直したところと理由（' + ev.changes.length + '）');
      const list = el('div', 'chg-list');
      for (const c of ev.changes) {
        const item = el('div', 'chg');
        const line = el('div', 'chg-line');
        if (c.from) line.append(el('span', 'from', c.from));
        if (c.from && c.to) line.append(el('span', 'arrow', '→'));
        if (c.to) line.append(el('span', 'to', c.to));
        item.append(line);
        if (c.reason) item.append(el('p', 'why', c.reason));
        list.append(item);
      }
      s.append(list);
      root.append(s);
    }

    // 自然な言い方
    if (ev.natural.length) {
      const s = section('より自然な言い方');
      const list = el('div', 'alt-list');
      for (const n of ev.natural) {
        const a = el('div', 'alt');
        a.append(el('span', 'en', n.en), speakButton(n.en));
        if (n.nuance) a.append(el('span', 'nuance', n.nuance));
        list.append(a);
      }
      s.append(list);
      root.append(s);
    }

    // お手本
    const sb = section('お手本（復習で使います）');
    sb.append(enBox(ev.best, { model: true }));
    root.append(sb);

    // 良かったところ
    if (ev.good.length) {
      const s = section('良かったところ');
      const ul = el('ul', 'good');
      for (const g of ev.good) ul.append(el('li', '', g));
      s.append(ul);
      root.append(s);
    }
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
    delete e.id;
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

  // ---- 書く ----
  const draft = Object.assign({ src: '', scene: '', audience: '', easy: null, mine: '', ev: null, entryId: null, entry: null },
    local.get('coach.draft', {}));
  const saveDraft = () => local.set('coach.draft', draft);
  let editingSrc = false;

  function renderStep1() {
    const collapsed = !!draft.easy && !editingSrc;
    $('src-editor').hidden = collapsed;
    $('src-summary').hidden = !collapsed;
    $('edit-src').hidden = !collapsed;
    $('step1').classList.toggle('done', !!draft.easy);
    if (collapsed) {
      $('src-summary-text').textContent = draft.src;
      const tags = $('src-summary-tags');
      tags.textContent = '';
      for (const t of [draft.scene, draft.audience]) if (t) tags.append(el('span', 'chip', t));
    }
  }

  function renderEasy() {
    const e = draft.easy;
    $('step2').hidden = !e;
    $('step3').hidden = !e;
    $('step2').classList.toggle('done', !!e);
    if (!e) return;
    $('easy').value = e.easyJa;
    const pts = $('easy-points');
    pts.textContent = '';
    for (const p of e.points) pts.append(el('li', '', p));
    $('points-count').textContent = e.points.length ? '（' + e.points.length + '）' : '';
    $('toggle-points').hidden = !e.points.length;
    const ph = $('phrases');
    ph.textContent = '';
    for (const p of e.keyPhrases) ph.append(el('li', '', p));
    $('toggle-phrases').hidden = !e.keyPhrases.length;
  }

  function renderEval() {
    const has = !!draft.ev;
    $('eval-empty').hidden = has;
    $('eval-actions').hidden = !has;
    $('step3').classList.toggle('done', has);
    const view = $('eval-view');
    view.textContent = '';
    if (has) view.append(buildEvalView(draft.ev, draft.mine));
  }

  function renderWrite() {
    $('src').value = draft.src;
    $('scene').value = draft.scene;
    $('audience').value = draft.audience;
    $('mine').value = draft.mine;
    renderStep1();
    renderEasy();
    renderEval();
    $('saved-status').textContent = draft.entryId ? '保存済み' : '';
    growAll();
  }

  $('src').addEventListener('input', () => { draft.src = $('src').value; saveDraft(); });
  $('scene').addEventListener('change', () => { draft.scene = $('scene').value; saveDraft(); });
  $('audience').addEventListener('change', () => { draft.audience = $('audience').value; saveDraft(); });
  $('mine').addEventListener('input', () => { draft.mine = $('mine').value; saveDraft(); });
  $('easy').addEventListener('input', () => { if (draft.easy) { draft.easy.easyJa = $('easy').value; saveDraft(); } });
  $('edit-src').addEventListener('click', () => {
    editingSrc = true;
    renderStep1();
    growAll();
    $('src').focus();
  });

  $('btn-easy').addEventListener('click', async () => {
    const src = $('src').value.trim();
    if (!src) { $('src').focus(); return; }
    const box = $('easy-status');
    try {
      const r = normEasy(await ask(easyPrompt(src, draft.scene, draft.audience), box, '英語にしやすい日本語を考えています', $('btn-easy')));
      Object.assign(draft, { src, easy: r, mine: '', ev: null, entryId: null, entry: null });
      saveDraft();
      editingSrc = false;
      closeToggle($('toggle-points'), $('easy-points'));
      closeToggle($('toggle-phrases'), $('phrases'));
      renderWrite();
      $('mine').focus();
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
    if (narrow()) $('step4').scrollIntoView({ behavior: 'smooth', block: 'start' });

    // 保存
    const status = $('saved-status');
    if (!entriesCol) { status.textContent = '保存されていません'; return; }
    // 保存済みなら最新の保存内容（復習の記録を含む）を土台にする
    const saved = draft.entryId && entries.find((x) => x.id === draft.entryId);
    const base = saved ? clone(saved) : (draft.entry || { createdAt: Date.now(), review: { count: 0, correct: 0, lastAt: 0 } });
    Object.assign(base, { src: ctx.src, scene: draft.scene, audience: draft.audience, easyJa: ctx.easyJa,
      points: draft.easy.points, keyPhrases: draft.easy.keyPhrases, sceneGuess: draft.easy.sceneGuess, tone: draft.easy.tone });
    const entry = entryFromEval(base, ev, mine, 'write');
    status.textContent = '保存しています…';
    try {
      draft.entryId = await saveEntry(draft.entryId, entry);
      draft.entry = entry;
      saveDraft();
      status.textContent = '保存しました';
    } catch (e) {
      status.textContent = e && e.code === 'quota_exceeded' ? '保存の上限です（履歴から削除してください）' : '保存できませんでした';
    }
  }
  $('btn-eval').addEventListener('click', evaluateWrite);
  $('mine').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); evaluateWrite(); }
  });

  $('btn-retry').addEventListener('click', () => {
    if (narrow()) $('step3').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('mine').focus({ preventScroll: !narrow() });
    $('mine').select();
  });
  $('btn-new').addEventListener('click', () => {
    Object.assign(draft, { src: '', easy: null, mine: '', ev: null, entryId: null, entry: null });
    saveDraft();
    editingSrc = false;
    renderWrite();
    window.scrollTo(0, 0);
    $('src').focus();
  });

  // ---- 復習 ----
  let rv = null;

  function renderReviewHome() {
    const usable = entries.filter((e) => e.best);
    const never = usable.filter((e) => !(e.review && e.review.count)).length;
    $('review-summary').textContent = usable.length
      ? '保存した文章 ' + usable.length + '件（まだ復習していない文章 ' + never + '件）。「英語にしやすい日本語」を見て、英文をタイピングで答えます。'
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
    closeToggle($('toggle-rv-src'), $('rv-src'));
    const a = $('rv-answer');
    a.value = '';
    a.readOnly = false;
    autoGrow(a);
    $('rv-form').querySelectorAll('button').forEach((b) => { b.disabled = false; });
    $('rv-feedback').hidden = true;
    $('rv-empty').hidden = false;
    $('rv-eval').textContent = '';
    $('rv-status').hidden = true;
    rv.cur = null;
    a.focus();
  }

  function renderTokens(target, tokens, marks, cls) {
    target.textContent = '';
    if (!tokens.length) { target.append(el('span', 'muted', '（未回答）')); return; }
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
    const slot = $('rv-speak-slot');
    slot.textContent = '';
    slot.append(speakButton(r.answer));
    const others = answersFor(e).filter((a) => a !== r.answer);
    $('rv-others').hidden = !others.length;
    $('rv-others').textContent = others.length ? 'ほかの正解: ' + others.join(' / ') : '';
    $('rv-ask').hidden = !text || !sample;
    $('rv-empty').hidden = true;
    $('rv-feedback').hidden = false;
    $('rv-next').focus({ preventScroll: !narrow() });
    if (narrow()) $('rv-feedback-block').scrollIntoView({ behavior: 'smooth', block: 'start' });

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
      stopSpeaking();
    } else {
      showReviewQuestion();
      window.scrollTo(0, 0);
    }
  });
  $('rv-quit').addEventListener('click', () => {
    stopSpeaking();
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

  // ---- 履歴（一覧と詳細） ----
  let selectedId = null;
  let armedDelete = false;
  const fmtDate = (ms) => {
    const d = new Date(ms);
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  };

  function renderHistoryList() {
    const list = $('history-list');
    list.textContent = '';
    $('history-empty').hidden = entries.length > 0;
    $('history-count').textContent = entries.length ? entries.length + '件' : '';
    for (const e of entries) {
      const li = el('li');
      const b = el('button', 'h-item');
      b.type = 'button';
      if (e.id === selectedId) b.setAttribute('aria-current', 'true');
      b.append(el('span', 'h-src', str(e.src).split('\n')[0]), el('span', 'h-score ' + scoreClass(e.bestScore || 0), (e.bestScore || 0) + '点'));
      const meta = [fmtDate(e.createdAt), e.scene || e.sceneGuess, e.review && e.review.count ? '復習 ' + e.review.correct + '/' + e.review.count : '未復習'].filter(Boolean).join(' ・ ');
      b.append(el('span', 'h-meta', meta));
      b.addEventListener('click', () => {
        selectedId = e.id;
        armedDelete = false;
        $('tab-history').classList.add('show-detail');
        renderHistory();
        if (narrow()) window.scrollTo(0, 0);
      });
      li.append(b);
      list.append(li);
    }
  }

  function renderHistoryDetail() {
    const box = $('history-detail');
    box.textContent = '';
    const e = entries.find((x) => x.id === selectedId);
    if (!e) {
      const empty = el('div', 'empty-state');
      empty.append(el('p', '', entries.length ? '左の一覧から文章を選ぶと、ここに詳細が出ます。' : 'まだ保存された文章はありません。'));
      box.append(empty);
      $('tab-history').classList.remove('show-detail');
      return;
    }
    const d = el('div', 'detail');
    const head = el('div', 'ev-sec');
    const meta = [fmtDate(e.createdAt), e.scene || e.sceneGuess, e.audience, '最高 ' + (e.bestScore || 0) + '点',
      e.review && e.review.count ? '復習 ' + e.review.correct + '/' + e.review.count + ' 正解' : '未復習'].filter(Boolean).join(' ・ ');
    head.append(el('h3', '', meta), el('p', 'src', e.src));
    d.append(head);

    const se = section('英語にしやすい日本語');
    const easy = el('div', 'en-box');
    easy.append(el('p', '', e.easyJa));
    se.append(easy);
    d.append(se);

    const sb = section('お手本');
    sb.append(enBox(e.best, { model: true }));
    d.append(sb);

    if (arr(e.natural).length) {
      const s = section('より自然な言い方');
      const list = el('div', 'alt-list');
      for (const n of e.natural) {
        const a = el('div', 'alt');
        a.append(el('span', 'en', n.en), speakButton(n.en));
        if (n.nuance) a.append(el('span', 'nuance', n.nuance));
        list.append(a);
      }
      s.append(list);
      d.append(s);
    }

    if (e.lastEval && e.lastMine) {
      const s = section('最新の添削（あなたの英文：' + e.lastMine + '）');
      const btn = el('button', 'chip-btn', '添削結果を見る');
      btn.type = 'button';
      btn.setAttribute('aria-expanded', 'false');
      const holder = el('div');
      holder.hidden = true;
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
        holder.hidden = !open;
        if (open && !holder.firstChild) holder.append(buildEvalView(e.lastEval, e.lastMine));
      });
      s.append(btn, holder);
      d.append(s);
    }

    const actions = el('div', 'detail-actions');
    const again = el('button', 'primary', 'この文章でもう一度書く');
    again.type = 'button';
    again.addEventListener('click', () => {
      Object.assign(draft, {
        src: e.src, scene: e.scene || '', audience: e.audience || '',
        easy: { easyJa: e.easyJa, points: arr(e.points), keyPhrases: arr(e.keyPhrases), sceneGuess: str(e.sceneGuess), tone: str(e.tone) },
        mine: '', ev: null, entryId: e.id, entry: null,
      });
      saveDraft();
      editingSrc = false;
      showTab('write');
      renderWrite();
      $('mine').focus();
    });
    const del = el('button', 'secondary danger', armedDelete ? 'もう一度押すと削除します' : '削除');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!armedDelete) { armedDelete = true; del.textContent = 'もう一度押すと削除します'; return; }
      del.disabled = true;
      try {
        await entriesCol.doc(e.id).delete();
        if (draft.entryId === e.id) { draft.entryId = null; draft.entry = null; saveDraft(); }
        selectedId = null;
        armedDelete = false;
      } catch (err) {
        del.disabled = false;
        armedDelete = false;
        del.textContent = '削除できませんでした';
      }
    });
    actions.append(again, del);
    d.append(actions);
    box.append(d);
  }

  function renderHistory() {
    if (!narrow() && !selectedId && entries.length) selectedId = entries[0].id;
    renderHistoryList();
    renderHistoryDetail();
  }
  $('history-back').addEventListener('click', () => {
    $('tab-history').classList.remove('show-detail');
    selectedId = null;
    renderHistory();
  });

  // ---- 起動 ----
  renderWrite();
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
    // Claude の声は待たずに準備する（使えない画面では null のまま）
    C.use('tts').then((t) => {
      if (!t) return;
      ttsCap = t;
      try { t.onState(({ state }) => { if (state === 'idle' && playingBtn && !(browserTts && speechSynthesis.speaking)) setPlaying(null); }); } catch (e) { /* なくても動く */ }
      buildVoiceSelect();
      voiceNote('');
      renderEval();
    }).catch(() => {});
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
