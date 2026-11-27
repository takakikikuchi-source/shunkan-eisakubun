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
  bindToggle($('toggle-words'), $('words'));
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
    if (name === 'review' && typeof renderReviewHome === 'function') renderReviewHome();
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

  // opts.modelTier: 'quick'（速いモデル）／省略で標準のモデル
  async function ask(prompt, statusBox, label, button, opts) {
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
      const res = await sample.json(prompt, Object.assign({ signal: ctl.signal }, opts && opts.modelTier ? { modelTier: opts.modelTier } : {}));
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

  // ②の言い換えの3段階
  const LEVELS = [
    { id: 'simple', label: '1 かんたん', name: 'すごく簡単に言う', desc: 'すごく簡単に言う言い方。中学英語で言える短い文にしています。' },
    { id: 'standard', label: '2 言いやすく', name: '言いやすくする', desc: '書いた文章の内容はそのままに、英語にしやすく言い換えた言い方です。' },
    { id: 'better', label: '3 より良く', name: 'もっと良くなる言い方', desc: 'こう言うともっと伝わる言い方。ビジネスの英文として好印象になるように整えています。' },
  ];
  const levelOf = (id) => LEVELS.find((l) => l.id === id) || LEVELS[1];

  function easyPrompt(src, scene, audience) {
    return [
      'あなたは日本人ビジネスパーソン向けの英作文コーチです。',
      '学習者が書いた日本語を、英語に訳しやすい日本語に3段階で言い換えてください（和文和訳）。学習者は選んだ1つを見ながら、自分で英文を組み立てます。',
      '',
      '3段階:',
      '- simple（すごく簡単に言う）: 中学英語で言えるように、要点だけを短い文に分ける。細かいニュアンスや敬語は削ってよいが、伝えたい要点は残す',
      '- standard（言いやすくする）: 元の文の情報と意図をすべて残したまま、英語にしやすい形に整える',
      '- better（もっと良くなる言い方）: 英語のビジネス文として、より伝わりやすく好印象になるように整える（結論を先に言う、理由や次の行動をはっきりさせる、相手への配慮の一言を加える など）。元の文にない内容を足すときは控えめにし、何を足したかを points に書く',
      '',
      '3段階に共通のルール:',
      '- 主語と目的語を補い、「誰が・何を・どうする」をはっきりさせる',
      '- 長い文は区切り、1文に1つのメッセージにする',
      '- 「よろしくお願いします」「お世話になっております」「検討します」「対応します」など英語に直訳しにくい表現は、英語で言える具体的な意味に置き換える',
      '- 敬語は簡潔にし、丁寧さは「丁寧にお願いする」のように意図として残す',
      '- 時制・数・期限・条件をはっきりさせる',
      '- easyJa には英単語や英文を入れない（英語は keyPhrases・wordHints・skeleton にだけ書く）',
      '',
      'simple の英語（skeleton・wordHints・keyPhrases）で使う単語:',
      '- 中学1〜2年で習う基本の単語だけを使う。acquisition, implement, optimize, allocate, facilitate, approximately のような難しい単語は使わず、get, use, make better, give, help, about のような簡単な単語で言い換える',
      '- 広告の仕事でそのまま使う言葉など、どうしても言い換えられない単語（例: conversion, impression）だけは使ってよい。その場合は必ず glossary に、英単語 en・日本語の意味 ja・言い換えずに使う理由 why を書く',
      '- 難しい単語を使わないなら glossary は空の配列にする',
      '',
      'ヒントの作り方:',
      '- wordHints（3段階それぞれ）: その段階の easyJa の中で、英語にするとき単語が思い浮かびにくそうな言葉を3〜6個選び、英語の候補を1〜3個ずつ挙げる。中学英語で言える簡単な候補を先に書く（例: 延期する → move, push back, postpone）',
      '- skeleton（simple だけ）: simple の easyJa を1文ずつ、英語の語順で「部品」に分けた骨組み。部品の role は「誰が」「する」「何を」「誰に」「どこで」「いつ」「なぜ」「どのように」から選び、en は短い英語のかたまりにする（例: 誰が We → する decided → 何を to start a trial → いつ next month）。部品をつなげるとそのまま正しい英文になるようにし、簡単な単語を使う。簡単でも、場面と相手に対して失礼・くだけすぎにならない言い方を選ぶ（例: 社外メールなら set up right ではなく set up correctly）。この骨組みどおりに書いた英文は添削で正解として扱うので、そのまま送っても問題ない英文にする',
      '',
      contextLines(scene, audience),
      '',
      '学習者の日本語:',
      '"""',
      src,
      '"""',
      '',
      '次の形の JSON だけを返してください（points はどこをどう言い換えたかを短く2〜4個、keyPhrases はその段階で使えそうな英語の型を2〜4個）:',
      '{"levels": {"simple": {"easyJa": "...", "points": ["..."], "keyPhrases": ["..."], "wordHints": [{"ja": "延期する", "en": ["move", "push back"]}], "skeleton": [{"ja": "この文の日本語", "parts": [{"role": "誰が", "en": "We"}, {"role": "する", "en": "decided"}]}], "glossary": [{"en": "conversion", "ja": "コンバージョン。広告を見た人が購入や申し込みをすること", "why": "広告の仕事でそのまま使う言葉のため"}]}, "standard": {"easyJa": "...", "points": ["..."], "keyPhrases": ["..."], "wordHints": [{"ja": "...", "en": ["..."]}]}, "better": {"easyJa": "...", "points": ["..."], "keyPhrases": ["..."], "wordHints": [{"ja": "...", "en": ["..."]}]}}, "scene": "想定した場面（短く）", "tone": "想定した丁寧さ（丁寧 / 普通 / カジュアル など）"}',
    ].join('\n');
  }

  function evalPrompt(ctx, mine) {
    return [
      'あなたはアメリカ英語のネイティブで、日本人ビジネスパーソンを教える英語講師です。学習者の英文を添削してください。',
      '説明はすべて日本語で、学習者が次に同じ間違いをしないように具体的に書いてください。',
      '',
      '元の日本語: ' + ctx.src,
      '学習者が見た日本語（「' + levelOf(ctx.level).name + '」版の言い換え）: ' + ctx.easyJa,
      ctx.skeletonText ? '学習者に見せた骨組みヒント（英語の語順と単語のヒント）: ' + ctx.skeletonText : null,
      ctx.skeletonText ? '骨組みヒントどおりの表現は正しい答えとして扱い、kind: error では直さず、減点もしない。もっと良い言い方があれば kind: better で紹介する' : null,
      '評価は、学習者が見た版の内容を英語で表せているかで行う。simple 版なら簡単な表現を使っていること自体は減点しない。best もその版の内容に合わせる',
      ctx.level === 'simple'
        ? 'simple 版なので、corrected と best は中学1〜2年で習う基本の単語だけで書く（acquisition や implement のような難しい単語は使わない）。広告の仕事でそのまま使う言葉など、どうしても必要な単語を corrected・best・natural で使ったときは、glossary に英単語 en・日本語の意味 ja・言い換えずに使う理由 why を書く'
        : null,
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
      '- changes: 指摘する箇所ごとに、元の表現 from・直した表現 to・種類 kind・理由 reason。直していない部分は書かない',
      '- kind は2種類: error は直すべき誤り（文法の誤り / 語法の誤り / 意味のずれ・抜け / 相手に失礼になる表現）。better は誤りではないが、もっと良くなる言い換え（より自然・より丁寧・より簡潔）。迷ったら better にする',
      '- reason には、error なら「なぜダメか」、better なら「どう良くなるか」を必ず書く',
      '- corrected には error の修正だけを反映する（better は反映しない）',
      '- 元の日本語の意味が英文から抜けている・ずれている場合は、必ず changes で指摘する',
      '- good: 良かった点を1〜2個',
      '- natural: ネイティブがこの場面で使う、より自然な言い方を2〜3個。それぞれのニュアンスや使い分けを日本語で',
      '- tone: 場面と相手に対して丁寧さが適切か。label は「適切」「丁寧すぎる」「くだけすぎ」「失礼になりうる」のどれか',
      '- score: 100点満点。breakdown は accuracy（意味と文法の正確さ 0〜40）、naturalness（自然さ 0〜30）、tone（丁寧さ・トーン 0〜30）で、合計が score。減点するのは error だけで、better では減点しない',
      '- best: 復習用のお手本を1つ（アメリカ英語で、この場面で一番おすすめの言い方）',
      '',
      '次の形の JSON だけを返してください:',
      '{"score": 0, "breakdown": {"accuracy": 0, "naturalness": 0, "tone": 0}, "summary": "ひとことの講評", "corrected": "...", "changes": [{"from": "...", "to": "...", "kind": "error", "reason": "..."}], "good": ["..."], "natural": [{"en": "...", "nuance": "..."}], "tone": {"label": "適切", "comment": "..."}, "best": "...", "glossary": []}',
    ].filter((l) => l !== null).join('\n');
  }

  function normLevel(v) {
    if (!v || typeof v !== 'object' || !str(v.easyJa).trim()) return null;
    return {
      easyJa: str(v.easyJa).trim(),
      points: arr(v.points).map(str).filter(Boolean),
      keyPhrases: arr(v.keyPhrases).map(str).filter(Boolean),
      wordHints: arr(v.wordHints)
        .map((w) => ({ ja: str(w && w.ja), en: (Array.isArray(w && w.en) ? w.en : [w && w.en]).map(str).filter(Boolean) }))
        .filter((w) => w.ja && w.en.length),
      skeleton: arr(v.skeleton)
        .map((s) => ({ ja: str(s && s.ja), parts: arr(s && s.parts).map((p) => ({ role: str(p && p.role), en: str(p && p.en) })).filter((p) => p.en) }))
        .filter((s) => s.parts.length),
      glossary: normGlossary(v.glossary),
    };
  }

  // 難しいけれど必要な単語の注釈
  function normGlossary(g) {
    return arr(g).map((x) => ({ en: str(x && x.en).trim(), ja: str(x && x.ja), why: str(x && x.why) })).filter((x) => x.en && x.ja);
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // text の中に注釈つきの単語があれば、その単語を返す
  function notedWords(text, glossary) {
    const t = str(text);
    return arr(glossary).filter((g) => new RegExp('\\b' + escapeRe(g.en) + '\\w*', 'i').test(t));
  }
  function glossaryList(glossary, title) {
    const box = el('div', 'glossary');
    box.append(el('p', 'glossary-title', title || '※ 注釈（難しいけれど必要な単語）'));
    const dl = el('dl');
    for (const g of glossary) {
      dl.append(el('dt', '', '※ ' + g.en));
      const dd = el('dd', '', g.ja);
      if (g.why) dd.append(el('span', 'why', '（' + g.why + '）'));
      dl.append(dd);
    }
    box.append(dl);
    return box;
  }

  function normEasy(r) {
    if (!r || typeof r !== 'object') throw { code: 'invalid_json' };
    const levels = {};
    for (const l of LEVELS) {
      const v = normLevel(r.levels && r.levels[l.id]);
      if (v) levels[l.id] = v;
    }
    if (!Object.keys(levels).length) throw { code: 'invalid_json' };
    return { levels, sceneGuess: str(r.scene), tone: str(r.tone) };
  }

  // 以前の形（段階なし）の言い換えを、3段階の形に直す
  function upgradeEasy(e) {
    if (!e) return null;
    if (e.levels) return e;
    const v = normLevel(e);
    return v ? { levels: { standard: v }, sceneGuess: str(e.sceneGuess), tone: str(e.tone) } : null;
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
      changes: arr(r.changes).map((c) => ({ from: str(c && c.from), to: str(c && c.to), kind: str(c && c.kind) === 'better' ? 'better' : 'error', reason: str(c && c.reason) })).filter((c) => c.reason || c.to),
      good: arr(r.good).map(str).filter(Boolean),
      natural: arr(r.natural).map((n) => ({ en: str(n && n.en), nuance: str(n && n.nuance) })).filter((n) => n.en),
      tone: { label: str(r.tone && r.tone.label) || '—', comment: str(r.tone && r.tone.comment) },
      best: str(r.best).trim() || corrected,
      glossary: normGlossary(r.glossary),
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
    if (opts && opts.glossary && notedWords(text, opts.glossary).length) p.append(el('sup', 'note-mark', '※'));
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
    sc.append(enBox(ev.corrected, { marks: d && d.answerMarks, glossary: ev.glossary }));
    root.append(sc);

    // 理由：「直すところ」（誤り。点数に影響）と「もっと良くなるところ」（誤りではない。点数に影響しない）に分ける
    const errors = ev.changes.filter((c) => c.kind !== 'better');
    const betters = ev.changes.filter((c) => c.kind === 'better');
    const changeList = (items, cls) => {
      const list = el('div', 'chg-list');
      for (const c of items) {
        const item = el('div', 'chg ' + cls);
        const line = el('div', 'chg-line');
        if (c.from) {
          const from = el('span', 'from', c.from);
          if (cls === 'is-better') from.prepend(el('span', 'ok-mark', '○ '));
          line.append(from);
        }
        if (c.from && c.to) line.append(el('span', 'arrow', '→'));
        if (c.to) line.append(el('span', 'to', c.to));
        item.append(line);
        if (c.reason) item.append(el('p', 'why', c.reason));
        list.append(item);
      }
      return list;
    };
    const se = section(errors.length ? '直すところ（' + errors.length + '）' : '直すところ');
    if (errors.length) se.append(changeList(errors, 'is-error'));
    else se.append(el('p', 'muted small', '直す必要がある誤りはありません。'));
    root.append(se);
    if (betters.length) {
      const sbt = section('正解だけど、もっと良くなる言い方（' + betters.length + '）');
      sbt.append(changeList(betters, 'is-better'));
      root.append(sbt);
    }

    // 自然な言い方
    if (ev.natural.length) {
      const s = section('より自然な言い方');
      const list = el('div', 'alt-list');
      for (const n of ev.natural) {
        const a = el('div', 'alt');
        const enSpan = el('span', 'en', n.en);
        if (notedWords(n.en, ev.glossary).length) enSpan.append(el('sup', 'note-mark', '※'));
        a.append(enSpan, speakButton(n.en));
        if (n.nuance) a.append(el('span', 'nuance', n.nuance));
        list.append(a);
      }
      s.append(list);
      root.append(s);
    }

    // お手本
    const sb = section('お手本（復習で使います）');
    sb.append(enBox(ev.best, { model: true, glossary: ev.glossary }));
    root.append(sb);

    // 難しいけれど必要な単語の注釈
    if (arr(ev.glossary).length) root.append(glossaryList(ev.glossary));

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
  // 骨組みの部品をつないだ英文（1文ずつ）
  function skeletonSentences(sk) {
    return arr(sk).map((x) => arr(x.parts).map((p) => p.en).join(' ').trim()).filter(Boolean)
      .map((t) => t.charAt(0).toUpperCase() + t.slice(1) + (/[.?!]$/.test(t) ? '' : '.'));
  }
  const entrySkeleton = (e) => (e && e.level === 'simple' && e.levels && e.levels.simple ? arr(e.levels.simple.skeleton) : []);

  function answersFor(e) {
    const list = [e.best, e.corrected];
    for (const n of arr(e.natural)) list.push(n.en);
    for (const a of arr(e.attempts)) if (a.score >= 90) list.push(a.en);
    const skText = skeletonSentences(entrySkeleton(e)).join(' ');
    if (skText) list.push(skText);
    return [...new Set(list.map(str).filter((s) => s.trim()))];
  }

  function entryFromEval(base, ev, mine, from) {
    const e = base ? clone(base) : { createdAt: Date.now() };
    delete e.id;
    if (!e.srs) e.srs = srsOf(e);
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
  draft.easy = upgradeEasy(draft.easy);
  if (!draft.level) draft.level = local.get('coach.level', 'standard');
  const saveDraft = () => local.set('coach.draft', draft);
  let editingSrc = false;

  // 選んでいる段階の言い換え（その段階がなければ、ある段階のうち最初のもの）
  function curLevelId() {
    const lv = draft.easy && draft.easy.levels;
    if (!lv) return draft.level;
    if (lv[draft.level]) return draft.level;
    return (LEVELS.find((l) => lv[l.id]) || LEVELS[1]).id;
  }
  const curEasy = () => (draft.easy ? draft.easy.levels[curLevelId()] : null);

  function buildLevelButtons() {
    const seg = $('level-seg');
    seg.textContent = '';
    for (const l of LEVELS) {
      const b = el('button', '', l.label);
      b.type = 'button';
      b.dataset.level = l.id;
      b.title = l.desc;
      b.addEventListener('click', () => {
        draft.level = l.id;
        local.set('coach.level', l.id);
        saveDraft();
        renderEasy();
        growAll();
      });
      seg.append(b);
    }
  }
  buildLevelButtons();

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
    const e = curEasy();
    $('step2').hidden = !e;
    $('step3').hidden = !e;
    $('step2').classList.toggle('done', !!draft.easy);
    if (!e) return;
    const id = curLevelId();
    for (const b of $('level-seg').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.level === id));
      b.disabled = !draft.easy.levels[b.dataset.level];
    }
    $('level-desc').textContent = levelOf(id).desc;
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

    // 単語ヒント
    const words = arr(e.wordHints);
    const dl = $('words');
    dl.textContent = '';
    // かんたんのときは、注釈つきの単語に ※ を付ける
    const glossary = id === 'simple' ? arr(e.glossary) : [];
    for (const w of words) {
      const dd = el('dd');
      w.en.forEach((t, i) => {
        if (i) dd.append(' / ');
        dd.append(t);
        if (notedWords(t, glossary).length) dd.append(el('sup', 'note-mark', '※'));
      });
      dl.append(el('dt', '', w.ja), dd);
    }
    $('words-count').textContent = words.length ? '（' + words.length + '）' : '';
    $('toggle-words').hidden = !words.length;
    if (!words.length) closeToggle($('toggle-words'), dl);

    // 骨組みヒント（かんたんのときだけ）
    const key = id + '|' + draft.src;
    if (key !== skKey) { skKey = key; skOpen.clear(); }
    const sk = id === 'simple' ? arr(e.skeleton) : [];
    $('skeleton').hidden = !sk.length;
    renderSkeleton(sk, glossary);

    // 難しいけれど必要な単語の注釈（かんたんのとき）
    const gb = $('glossary-box');
    gb.textContent = '';
    gb.hidden = !glossary.length;
    if (glossary.length) gb.append(glossaryList(glossary));
  }

  // 骨組みヒント：部品を押すと英語が見える。「次を見る」で英語の順に1つずつ、「全部見る」でまとめて
  const skOpen = new Set();
  let skKey = '';
  function renderSkeleton(sk, glossary) {
    const body = $('skeleton-body');
    body.textContent = '';
    sk.forEach((s, i) => {
      const row = el('div', 'sk-row');
      if (s.ja) row.append(el('p', 'sk-ja', s.ja));
      const parts = el('div', 'sk-parts');
      s.parts.forEach((p, j) => {
        if (j) parts.append(el('span', 'sk-arrow', '→'));
        const k = i + '-' + j;
        const open = skOpen.has(k);
        const b = el('button', 'sk-part' + (open ? ' open' : ''));
        b.type = 'button';
        const val = el('span', 'val', open ? p.en : '？');
        // 注釈つきの単語は、隠れていても ※ で「難しい単語が入る」と分かるようにする
        if (notedWords(p.en, glossary).length) val.append(el('sup', 'note-mark', '※'));
        b.append(el('span', 'role', p.role || '？'), val);
        b.setAttribute('aria-label', (p.role || '部品') + '：' + (open ? p.en : '押すと英語が見えます'));
        b.addEventListener('click', () => {
          if (skOpen.has(k)) skOpen.delete(k); else skOpen.add(k);
          renderSkeleton(sk, glossary);
        });
        parts.append(b);
      });
      row.append(parts);
      body.append(row);
    });
    const all = [];
    sk.forEach((s, i) => s.parts.forEach((p, j) => all.push(i + '-' + j)));
    const rest = all.filter((k) => !skOpen.has(k));
    $('sk-next').disabled = !rest.length;
    $('sk-all').textContent = rest.length ? '全部見る' : '隠す';
    $('sk-next').onclick = () => { if (rest.length) { skOpen.add(rest[0]); renderSkeleton(sk, glossary); } };
    $('sk-all').onclick = () => {
      if (rest.length) all.forEach((k) => skOpen.add(k)); else skOpen.clear();
      renderSkeleton(sk, glossary);
    };
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
  $('easy').addEventListener('input', () => { const e = curEasy(); if (e) { e.easyJa = $('easy').value; saveDraft(); } });
  // 例文をランダムに入れる（直前と同じ例文は避ける）
  const EXAMPLES = Array.isArray(window.COACH_EXAMPLES) ? window.COACH_EXAMPLES : [];
  let lastExample = -1;
  $('btn-example').hidden = !EXAMPLES.length;
  $('btn-example').addEventListener('click', () => {
    if (!EXAMPLES.length) return;
    let i = Math.floor(Math.random() * EXAMPLES.length);
    if (EXAMPLES.length > 1 && i === lastExample) i = (i + 1 + Math.floor(Math.random() * (EXAMPLES.length - 1))) % EXAMPLES.length;
    lastExample = i;
    const ex = EXAMPLES[i];
    Object.assign(draft, { src: ex.src, scene: ex.scene || '', audience: ex.audience || '', easy: null, mine: '', ev: null, entryId: null, entry: null });
    saveDraft();
    editingSrc = false;
    $('easy-status').hidden = true;
    renderWrite();
    $('btn-easy').focus();
  });

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
      const r = normEasy(await ask(easyPrompt(src, draft.scene, draft.audience), box, '英語にしやすい日本語を考えています', $('btn-easy'), { modelTier: 'quick' }));
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
    const cur = curEasy();
    const level = curLevelId();
    const skeletonText = level === 'simple' ? skeletonSentences(cur.skeleton).join(' ') : '';
    const ctx = { src: draft.src, easyJa: $('easy').value.trim() || cur.easyJa, level, skeletonText, scene: draft.scene, audience: draft.audience,
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
    const base = saved ? clone(saved) : (draft.entry || { createdAt: Date.now(), srs: SESrs.initial(Date.now()) });
    // 復習では、添削したときに見ていた段階の言い換えを出題する
    Object.assign(base, { src: ctx.src, scene: draft.scene, audience: draft.audience, easyJa: ctx.easyJa, level,
      levels: clone(draft.easy.levels), points: cur.points, keyPhrases: cur.keyPhrases,
      sceneGuess: draft.easy.sceneGuess, tone: draft.easy.tone });
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

  // ---- 復習の状態（間隔反復：要件 R-03） ----
  // 以前に保存した文で、まだ復習の状態がないものは「明日復習」から始める（要件 8章）。
  // 「明日」はこの仕組みを入れた日（2026-11-28）の翌日＝11/29。
  const SRS_RELEASE = new Date(2026, 10, 28).getTime();
  function srsOf(e) {
    if (e && e.srs) return e.srs;
    const r = (e && e.review) || {};
    const from = Math.max((e && e.createdAt) || Date.now(), SRS_RELEASE);
    return Object.assign(SESrs.initial(from), { count: r.count || 0, correct: r.correct || 0 });
  }
  const fmtMD = (ms) => { const d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate(); };
  function dueLabel(srs) {
    const today = SESrs.dayStart(Date.now());
    if (srs.due <= today) return '今日';
    if (srs.due === SESrs.addDays(today, 1)) return '明日';
    return fmtMD(srs.due);
  }

  // ---- 問題集（要件 4.2） ----
  const UNITS = window.SE_UNITS || [];
  const QMAP = new Map();
  for (const u of UNITS) for (const q of u.questions) QMAP.set(q.id, Object.assign({ category: u.category, unitTitle: u.title }, q));
  let drillCol = null;
  const drillState = new Map(); // 問題ID → 保存した記録 { qid, correct, wrong, lastResult, lastAt, userAlts, inReview, srs }
  const ds = Object.assign({ order: 'random', count: 10, showHint: true, unitIds: UNITS[0] ? [UNITS[0].id] : [] }, local.get('coach.drill', {}));
  ds.unitIds = arr(ds.unitIds).filter((id) => UNITS.some((u) => u.id === id));
  const saveDs = () => local.set('coach.drill', ds);
  const drillAnswers = (q) => [...new Set(q.en.concat(arr(q.alternatives), arr((drillState.get(q.id) || {}).userAlts)))];

  async function saveDrill(qid, doc) {
    drillState.set(qid, doc);
    if (!drillCol) return;
    try { await drillCol.doc(qid).set(doc); } catch (e) { /* 記録できなくても続行 */ }
  }

  function renderTokens(target, tokens, marks, cls) {
    target.textContent = '';
    if (!tokens.length) { target.append(el('span', 'muted', '（未回答）')); return; }
    tokens.forEach((t, i) => {
      if (i) target.append(' ');
      target.append(el('span', marks[i] ? cls : '', t));
    });
  }
  function renderTags(box, tags) {
    box.textContent = '';
    for (const t of arr(tags)) box.append(el('span', 'chip', t));
    box.hidden = !arr(tags).length;
  }

  function drillCategories() {
    const map = new Map();
    for (const u of UNITS) {
      const c = u.category || 'その他';
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(u);
    }
    return map;
  }
  const drillSelected = () => [...document.querySelectorAll('input[name=unit]:checked')].map((b) => UNITS.find((u) => u.id === b.value)).filter(Boolean);

  function updateDrillStart() {
    const total = drillSelected().reduce((n, u) => n + u.questions.length, 0);
    const per = Number($('count').value) || total;
    $('start').disabled = !total;
    $('start').textContent = total ? '始める（' + Math.min(per, total) + '問 / 選択中 ' + total + '問）' : 'ユニットを選んでください';
  }
  function onDrillUnitChange() {
    ds.unitIds = drillSelected().map((u) => u.id);
    saveDs();
    updateDrillStart();
  }

  function renderDrillHome() {
    const list = $('unit-list');
    list.textContent = '';
    for (const [cat, units] of drillCategories()) {
      const group = el('div', 'cat');
      const head = el('div', 'cat-head');
      const all = el('button', 'link', 'まとめて選ぶ');
      all.type = 'button';
      all.addEventListener('click', () => {
        const boxes = [...group.querySelectorAll('input[name=unit]')];
        const on = !boxes.every((b) => b.checked);
        boxes.forEach((b) => { b.checked = on; });
        onDrillUnitChange();
      });
      head.append(el('h3', '', cat), all);
      group.append(head);
      for (const u of units) {
        const label = el('label', 'unit');
        const box = el('input');
        box.type = 'checkbox';
        box.name = 'unit';
        box.value = u.id;
        box.checked = ds.unitIds.includes(u.id);
        box.addEventListener('change', onDrillUnitChange);
        label.append(box, el('span', 'unit-title', u.title), el('span', 'count', u.questions.length + '問'));
        group.append(label);
      }
      list.append(group);
    }
    for (const r of document.querySelectorAll('input[name=order]')) r.checked = r.value === ds.order;
    $('count').value = String(ds.count);
    $('show-hint').checked = ds.showHint;
    updateDrillStart();
  }
  $('count').addEventListener('change', () => { ds.count = Number($('count').value); saveDs(); updateDrillStart(); });
  $('show-hint').addEventListener('change', (e) => { ds.showHint = e.target.checked; saveDs(); });
  for (const r of document.querySelectorAll('input[name=order]')) {
    r.addEventListener('change', () => { ds.order = document.querySelector('input[name=order]:checked').value; saveDs(); });
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  let dq = null; // 問題集の1回分

  function showDrillScreen(name) {
    $('drill-home').hidden = name !== 'home';
    $('drill-quiz').hidden = name !== 'quiz';
    $('drill-result').hidden = name !== 'result';
    window.scrollTo(0, 0);
  }

  function startDrill(questions) {
    dq = { questions, i: 0, records: [], startedAt: 0, cur: null };
    showDrillScreen('quiz');
    showDrillQuestion();
  }
  $('start').addEventListener('click', () => {
    let qs = [];
    for (const u of drillSelected()) qs = qs.concat(u.questions.map((q) => QMAP.get(q.id)));
    if (!qs.length) return;
    if (ds.order === 'random') shuffle(qs);
    if (ds.count > 0) qs = qs.slice(0, ds.count);
    startDrill(qs);
  });

  function showDrillQuestion() {
    const q = dq.questions[dq.i];
    $('progress').textContent = (dq.i + 1) + ' / ' + dq.questions.length;
    $('bar-fill').style.width = (dq.i / dq.questions.length * 100) + '%';
    $('quiz-unit').textContent = [q.category, q.unitTitle].filter(Boolean).join(' ｜ ');
    $('ja').textContent = q.ja;
    $('hint').hidden = !(ds.showHint && q.hint);
    $('hint').textContent = q.hint ? 'ヒント: ' + q.hint : '';
    const input = $('answer');
    input.value = '';
    input.readOnly = false;
    $('answer-form').querySelectorAll('button').forEach((b) => { b.disabled = false; });
    $('feedback').hidden = true;
    $('drill-empty').hidden = false;
    dq.cur = null;
    input.focus();
    dq.startedAt = performance.now();
  }

  function submitDrill(giveUp) {
    if (!dq || dq.cur) return;
    const q = dq.questions[dq.i];
    const text = giveUp ? '' : $('answer').value.trim();
    if (!giveUp && !text) { $('answer').focus(); return; }
    const now = Date.now();
    const r = SEJudge.judge(text, drillAnswers(q));
    // 記録：間違えた問題と「惜しい」は復習に入れる（すでに復習中なら、そのまま）
    const prev = clone(drillState.get(q.id) || { qid: q.id, correct: 0, wrong: 0, userAlts: [], inReview: false, srs: null });
    const d = clone(prev);
    if (r.result === 'correct') d.correct = (d.correct || 0) + 1; else d.wrong = (d.wrong || 0) + 1;
    d.lastResult = r.result;
    d.lastAt = now;
    if (r.result !== 'correct' && !d.inReview) { d.inReview = true; d.srs = SESrs.initial(now); }
    saveDrill(q.id, d);
    dq.cur = { q, input: text, result: r.result, answer: r.answer, timeMs: performance.now() - dq.startedAt, prev, saved: d };
    dq.records.push(dq.cur);

    $('answer').readOnly = true;
    $('answer-form').querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const v = $('verdict');
    v.textContent = { correct: '正解', close: '惜しい', wrong: '不正解' }[r.result];
    v.className = 'verdict ' + r.result;
    const showDiff = r.result !== 'correct';
    renderTokens($('your'), r.userTokens, showDiff ? r.userMarks : [], 'bad');
    renderTokens($('correct'), r.answerTokens, showDiff ? r.answerMarks : [], 'miss');
    const slot = $('speak-slot');
    slot.textContent = '';
    slot.append(speakButton(r.answer));
    const others = drillAnswers(q).filter((a) => a !== r.answer);
    $('others').hidden = !others.length;
    $('others').textContent = others.length ? 'ほかの正解: ' + others.join(' / ') : '';
    renderTags($('tags'), q.grammarTags);
    $('note').hidden = !q.note;
    $('note').textContent = q.note || '';
    $('accept').hidden = r.result === 'correct' || !text;
    $('drill-empty').hidden = true;
    $('feedback').hidden = false;
    $('next').focus({ preventScroll: !narrow() });
    if (narrow()) $('drill-feedback-block').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('answer-form').addEventListener('submit', (e) => { e.preventDefault(); submitDrill(false); });
  $('giveup').addEventListener('click', () => submitDrill(true));

  // これも正解：自分の答えを別解として保存し、この回答で復習に入れた分は取り消す
  $('accept').addEventListener('click', () => {
    const c = dq && dq.cur;
    if (!c || !c.input || c.result === 'correct') return;
    const d = clone(c.saved);
    d.userAlts = [...new Set(arr(d.userAlts).concat(c.input))];
    d.wrong = Math.max(0, (d.wrong || 0) - 1);
    d.correct = (d.correct || 0) + 1;
    d.lastResult = 'correct';
    d.inReview = !!c.prev.inReview;
    d.srs = c.prev.inReview ? c.prev.srs : null;
    saveDrill(c.q.id, d);
    c.saved = d;
    c.result = 'correct';
    const v = $('verdict');
    v.textContent = '正解（自分で判定・別解に登録しました）';
    v.className = 'verdict correct';
    $('accept').hidden = true;
    $('next').focus();
  });

  $('next').addEventListener('click', () => {
    if (!dq || !dq.cur) return;
    dq.i++;
    if (dq.i >= dq.questions.length) showDrillResult();
    else showDrillQuestion();
  });
  $('quit').addEventListener('click', () => {
    stopSpeaking();
    if (!dq || !dq.records.length) { showDrillScreen('home'); return; }
    showDrillResult();
  });

  function showDrillResult() {
    stopSpeaking();
    const recs = dq.records;
    const ok = recs.filter((r) => r.result === 'correct').length;
    const answered = recs.filter((r) => r.input);
    const avg = answered.length ? answered.reduce((n, r) => n + r.timeMs, 0) / answered.length / 1000 : 0;
    $('r-rate').textContent = recs.length ? Math.round(ok / recs.length * 100) + '%' : '-';
    $('r-count').textContent = ok + ' / ' + recs.length;
    $('r-time').textContent = answered.length ? avg.toFixed(1) + '秒' : '-';
    const misses = recs.filter((r) => r.result !== 'correct');
    const ul = $('r-miss');
    ul.textContent = '';
    for (const m of misses) {
      const li = el('li');
      li.append(el('div', 'q', m.q.ja), el('div', 'a', 'あなた: ' + (m.input || '（未回答）')), el('div', 'c', '正解: ' + m.answer));
      ul.append(li);
    }
    $('r-miss-title').textContent = misses.length ? '間違えた問題（' + misses.length + '問）：復習に入りました' : '全問正解です';
    $('retry-miss').hidden = !misses.length;
    dq.misses = misses.map((m) => m.q);
    showDrillScreen('result');
    renderReviewHome();
  }
  $('retry-miss').addEventListener('click', () => startDrill(dq.misses.slice()));
  $('back-home').addEventListener('click', () => { showDrillScreen('home'); renderDrillHome(); });

  // ---- 復習（要件 4.3：書いた文と問題集をまとめて、その日の分だけ） ----
  let rv = null;

  function reviewItems() {
    const items = [];
    for (const e of entries) {
      if (!e.best) continue;
      items.push({ kind: 'entry', id: e.id, e, srs: srsOf(e) });
    }
    for (const [qid, d] of drillState) {
      const q = QMAP.get(qid);
      if (q && d.inReview && d.srs) items.push({ kind: 'drill', id: qid, q, d, srs: d.srs });
    }
    return items;
  }
  function dueItems(now) {
    return reviewItems().filter((x) => SESrs.isDue(x.srs, now)).sort((a, b) => a.srs.due - b.srs.due);
  }

  function renderReviewHome() {
    const now = Date.now();
    const all = reviewItems();
    const due = all.filter((x) => SESrs.isDue(x.srs, now));
    const nE = due.filter((x) => x.kind === 'entry').length;
    const nD = due.length - nE;
    const later = all.filter((x) => !SESrs.isDue(x.srs, now)).sort((a, b) => a.srs.due - b.srs.due)[0];
    let msg;
    if (due.length) msg = '今日の復習：' + due.length + '件（書いた文 ' + nE + '件・問題集 ' + nD + '件）。1回に10問ずつ出します。';
    else if (later) msg = '今日の復習はありません。次の復習は ' + fmtMD(later.srs.due) + ' です。';
    else msg = 'まだ復習する文はありません。「書く」で添削した文と、問題集で間違えた問題が、ここに入ります。';
    $('review-summary').textContent = msg;
    $('btn-review-start').disabled = !due.length;
    $('btn-review-start').textContent = due.length ? '復習を始める（' + Math.min(10, due.length) + '問）' : '復習を始める';
    const badge = $('review-badge');
    badge.hidden = !due.length;
    badge.textContent = String(due.length);
  }

  function startReview() {
    const list = dueItems(Date.now()).slice(0, 10);
    if (!list.length) return;
    rv = { list, i: 0, ok: 0, cur: null };
    $('review-home').hidden = true;
    $('review-result').hidden = true;
    $('review-quiz').hidden = false;
    showReviewQuestion();
  }
  $('btn-review-start').addEventListener('click', startReview);

  const itemAnswers = (x) => (x.kind === 'entry' ? answersFor(x.e) : drillAnswers(x.q));

  function showReviewQuestion() {
    const x = rv.list[rv.i];
    $('rv-progress').textContent = (rv.i + 1) + ' / ' + rv.list.length;
    $('rv-bar').style.width = (rv.i / rv.list.length * 100) + '%';
    if (x.kind === 'entry') {
      $('rv-kind').textContent = '書いた文' + (x.e.level ? ' ｜ ' + levelOf(x.e.level).label : '');
      $('rv-easy').textContent = x.e.easyJa || x.e.src;
      $('rv-src').textContent = x.e.src;
      $('toggle-rv-src').hidden = false;
      $('rv-hint').hidden = true;
    } else {
      $('rv-kind').textContent = '問題集 ｜ ' + [x.q.category, x.q.unitTitle].filter(Boolean).join(' ｜ ');
      $('rv-easy').textContent = x.q.ja;
      $('toggle-rv-src').hidden = true;
      $('rv-hint').hidden = !(ds.showHint && x.q.hint);
      $('rv-hint').textContent = x.q.hint ? 'ヒント: ' + x.q.hint : '';
    }
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

  async function writeReviewSrs(x, srs) {
    if (x.kind === 'entry') {
      if (!entriesCol) return;
      try { await entriesCol.doc(x.id).update({ srs }); } catch (err) { /* 記録できなくても続行 */ }
    } else {
      const d = clone(drillState.get(x.id) || x.d);
      d.srs = srs;
      d.inReview = true;
      d.lastResult = srs.lastResult;
      d.lastAt = srs.lastAt;
      await saveDrill(x.id, d);
    }
  }

  function submitReview(giveUp) {
    if (!rv || rv.cur) return;
    const x = rv.list[rv.i];
    const text = giveUp ? '' : $('rv-answer').value.trim();
    if (!giveUp && !text) { $('rv-answer').focus(); return; }
    const now = Date.now();
    const answers = itemAnswers(x);
    const r = SEJudge.judge(text, answers);
    const srs = SESrs.next(x.srs, r.result, now);
    rv.cur = { x, text, result: r.result, answer: r.answer, claudeOk: false, prevSrs: x.srs, srs };
    if (r.result === 'correct') rv.ok++;
    writeReviewSrs(x, srs);

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
    const others = answers.filter((a) => a !== r.answer);
    $('rv-others').hidden = !others.length;
    $('rv-others').textContent = others.length ? 'ほかの正解: ' + others.join(' / ') : '';
    $('rv-next-due').textContent = '次にこの文が出るのは：' + dueLabel(srs);
    renderTags($('rv-tags'), x.kind === 'drill' ? x.q.grammarTags : []);
    const note = x.kind === 'drill' ? x.q.note : '';
    $('rv-note').hidden = !note;
    $('rv-note').textContent = note || '';
    $('rv-ask').hidden = x.kind !== 'entry' || !text || !sample;
    $('rv-empty').hidden = true;
    $('rv-feedback').hidden = false;
    $('rv-next').focus({ preventScroll: !narrow() });
    if (narrow()) $('rv-feedback-block').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('rv-form').addEventListener('submit', (ev) => { ev.preventDefault(); submitReview(false); });
  $('rv-answer').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); submitReview(false); }
  });
  $('rv-giveup').addEventListener('click', () => submitReview(true));

  // 書いた文だけ：Claude に添削してもらう（90点以上なら正解扱い）
  $('rv-ask').addEventListener('click', async () => {
    const c = rv && rv.cur;
    if (!c || !c.text || c.x.kind !== 'entry') return;
    const e = c.x.e;
    const box = $('rv-status');
    let ev;
    try {
      ev = normEval(await ask(evalPrompt({ src: e.src, easyJa: e.easyJa, level: e.level || 'standard', skeletonText: skeletonSentences(entrySkeleton(e)).join(' '), scene: e.scene, audience: e.audience, sceneGuess: e.sceneGuess, tone: e.tone }, c.text),
        box, '添削しています', $('rv-ask')), c.text);
    } catch (err) {
      showError(box, err);
      return;
    }
    const view = $('rv-eval');
    view.textContent = '';
    view.append(buildEvalView(ev, c.text));
    const patch = {
      attempts: arr(e.attempts).concat([{ en: c.text, score: ev.score, at: Date.now(), from: 'review' }]).slice(-20),
      bestScore: Math.max(Number(e.bestScore) || 0, ev.score),
      lastEval: ev,
      lastMine: c.text,
      updatedAt: Date.now(),
    };
    if (ev.score >= 90 && c.result !== 'correct' && !c.claudeOk) {
      c.claudeOk = true;
      rv.ok++;
      c.srs = SESrs.next(c.prevSrs, 'correct', Date.now());
      patch.srs = c.srs;
      const v = $('rv-verdict');
      v.textContent = '正解（Claude の判定 ' + ev.score + '点）';
      v.className = 'verdict correct';
      $('rv-next-due').textContent = '次にこの文が出るのは：' + dueLabel(c.srs);
    }
    if (entriesCol) {
      try { await entriesCol.doc(c.x.id).update(patch); } catch (err) { /* 記録できなくても続行 */ }
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
      renderReviewHome();
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
    renderReviewHome();
  });
  $('rv-back').addEventListener('click', () => {
    $('review-result').hidden = true;
    $('review-home').hidden = false;
    renderReviewHome();
  });

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
      const sr = srsOf(e);
      const meta = [fmtDate(e.createdAt), e.scene || e.sceneGuess, '次の復習 ' + dueLabel(sr), sr.count ? '復習 ' + sr.correct + '/' + sr.count : ''].filter(Boolean).join(' ・ ');
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
    const sr = srsOf(e);
    const meta = [fmtDate(e.createdAt), e.scene || e.sceneGuess, e.audience, '最高 ' + (e.bestScore || 0) + '点',
      '次の復習 ' + dueLabel(sr), sr.count ? '復習 ' + sr.correct + '/' + sr.count + ' 正解' : '未復習'].filter(Boolean).join(' ・ ');
    head.append(el('h3', '', meta), el('p', 'src', e.src));
    d.append(head);

    const se = section('英語にしやすい日本語（' + levelOf(e.level).label + '）');
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
        easy: e.levels
          ? { levels: clone(e.levels), sceneGuess: str(e.sceneGuess), tone: str(e.tone) }
          : upgradeEasy({ easyJa: e.easyJa, points: arr(e.points), keyPhrases: arr(e.keyPhrases), sceneGuess: str(e.sceneGuess), tone: str(e.tone) }),
        level: e.level || 'standard',
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
  renderDrillHome();
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
        drillCol = db.doc('data/users/' + uid + '/notebook').collection('drill');
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
    // 問題集の記録（別解・復習の状態）
    drillCol.limit(1000).onSnapshot((snap) => {
      drillState.clear();
      for (const d of snap.docs) drillState.set(d.id, d.data());
      renderReviewHome();
    }, () => { /* 読めなくても問題集は解ける */ });
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
