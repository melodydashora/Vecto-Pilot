// Calc Coach — single-page app. No build step, no framework.
// All adaptive/mastery logic lives in engine.js (pure, tested); this file is
// data loading, routing, rendering, and persistence.

import * as E from '/engine.js';

// ---------------------------------------------------------------- data & state
const CONTENT = { manifest: null, units: new Map(), byNumber: new Map(), failed: [] };
let S = null;                // progress state (engine shape + app extras)
let saveTimer = null;
let tickTimer = null;        // optional elapsed-time display

const $ = (sel, root = document) => root.querySelector(sel);
const viewEl = () => $('#view');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderMath(container) {
  const go = () => {
    try {
      window.renderMathInElement(container, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
      });
    } catch (e) { console.warn('KaTeX render failed:', e); }
  };
  if (window.renderMathInElement) go();
  else window.addEventListener('katex-ready', go, { once: true });
}

function announce(text) { $('#live-region').textContent = text; }

// ---------------------------------------------------------------- persistence
function ensureAppFields(state) {
  state.lessons = state.lessons || {};          // lessonId -> completedAt
  state.lastLocation = state.lastLocation || '';
  state.savedAt = state.savedAt || 0;
  if (!state.createdAt) state.createdAt = Date.now();
  return state;
}

function save() {
  S.savedAt = Date.now();
  try { localStorage.setItem('calc-coach-progress', JSON.stringify(S)); } catch { /* private mode */ }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch('/api/progress?profile=learner', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(S),
      });
    } catch (e) { console.warn('Server save failed; progress is still in this browser.', e); }
  }, 600);
}

async function loadProgress() {
  let server = null;
  let local = null;
  try {
    const res = await fetch('/api/progress?profile=learner');
    if (res.ok) server = await res.json();
  } catch { /* offline is fine */ }
  try { local = JSON.parse(localStorage.getItem('calc-coach-progress') || 'null'); } catch { /* ignore */ }
  const pick = (server?.savedAt || 0) >= (local?.savedAt || 0) ? server : local;
  return ensureAppFields(pick || E.newState());
}

// ---------------------------------------------------------------- content load
async function loadContent() {
  const res = await fetch('/content/manifest.json');
  if (!res.ok) throw new Error(`manifest.json failed to load (HTTP ${res.status})`);
  CONTENT.manifest = await res.json();
  const results = await Promise.all(CONTENT.manifest.units.map(async (meta) => {
    try {
      const r = await fetch(`/content/${meta.file}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { meta, unit: await r.json() };
    } catch (e) {
      return { meta, error: e.message };
    }
  }));
  for (const r of results) {
    if (r.unit) {
      CONTENT.units.set(r.meta.id, r.unit);
      CONTENT.byNumber.set(r.unit.number, r.unit);
    } else CONTENT.failed.push(`${r.meta.id}: ${r.error}`);
  }
}

const allUnits = () => [...CONTENT.units.values()].sort((a, b) => a.number - b.number);
const questionById = (unit, qid) => unit.questions.find((q) => q.id === qid);
const skillName = (unit, skillId) => unit.skills.find((s) => s.id === skillId)?.name || skillId;

// ---------------------------------------------------------------- shared bits
function setBreadcrumb(parts) {
  $('#breadcrumb').innerHTML = parts.length
    ? `You are here: ${parts.map((p, i) => (i === parts.length - 1 ? `<strong>${esc(p)}</strong>` : esc(p))).join(' › ')}`
    : '';
}

function setNav(active) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === active));
}

function mountView(html, { breadcrumb = [], nav = '' } = {}) {
  clearInterval(tickTimer);
  const v = viewEl();
  v.innerHTML = html;
  setBreadcrumb(breadcrumb);
  setNav(nav);
  renderMath(v);
  window.scrollTo(0, 0);
  const h1 = $('h1', v);
  if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  return v;
}

function bar(label, value, max, { done = false } = {}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return `<div class="bar-row">
    <span class="bar-label">${label}</span>
    <span class="bar ${done ? 'done' : ''}" role="img" aria-label="${esc(label)}: ${value} of ${max}"><span style="width:${pct}%"></span></span>
    <span class="bar-num">${value} / ${max}</span>
  </div>`;
}

function skillBars(unit) {
  return unit.skills.map((sk) => {
    const score = E.masteryScore(S, sk.id);
    const mastered = score >= E.MASTERY_THRESHOLD;
    return bar(`${esc(sk.name)}${sk.core ? '' : ' <span class="tag">extra</span>'}`, score, 100, { done: mastered });
  }).join('');
}

function whatsNext(text) {
  return `<div class="whats-next"><span class="kicker">What happens next</span><p>${text}</p></div>`;
}

function startTimerIfEnabled(container) {
  if (!S.settings.showTimer) return;
  const span = document.createElement('span');
  span.className = 'timer';
  span.textContent = 'Elapsed: 0:00';
  container.appendChild(span);
  const t0 = Date.now();
  tickTimer = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    span.textContent = `Elapsed: ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
}

// -------------------------------------------------------- question interaction
// Two-step everywhere: select (or type), then press "Check answer". Nothing is
// graded on a stray click. `done({correct, hintsUsed, skipped})` fires only
// after the learner presses the explicit continue button.
function mountQuestion(container, unit, q, opts, done) {
  const { hintsAllowed = true, deferFeedback = false, index = 1, total = 1, countsTowardMastery = true } = opts;
  let selected = null;
  let hintsUsed = 0;

  const mcHtml = q.type === 'mc'
    ? `<div class="choices" role="group" aria-label="Answer choices">
        ${q.choices.map((c, i) => `<button type="button" class="choice" data-i="${i}" aria-pressed="false"><span class="choice-key">${'ABCDE'[i]}.</span> ${c}</button>`).join('')}
       </div>`
    : `<div class="numeric-row">
        <label for="num-in">Your answer:</label>
        <input id="num-in" type="text" inputmode="text" autocomplete="off" spellcheck="false">
        <span class="numeric-hint">Enter a number. Fractions like <code>3/4</code> and decimals like <code>-1.5</code> are accepted.</span>
       </div>`;

  container.innerHTML = `
    <div class="card">
      <div class="q-meta">
        <span class="session-progress">Question ${index} of ${total}</span>
        <span>Skill: ${esc(skillName(unit, q.skillId))}</span>
        <span>Difficulty ${q.difficulty} of 3</span>
      </div>
      <div class="q-prompt">${q.prompt}</div>
      ${mcHtml}
      <div class="hint-area"></div>
      <div class="btn-row">
        <button type="button" class="submit-btn" disabled>Check answer</button>
        ${hintsAllowed ? `<button type="button" class="secondary hint-btn">Show hint (1 of ${q.hints.length})</button>` : ''}
      </div>
      <div class="feedback-area"></div>
    </div>`;

  renderMath(container);
  const submitBtn = $('.submit-btn', container);
  const hintArea = $('.hint-area', container);
  const fbArea = $('.feedback-area', container);

  if (q.type === 'mc') {
    container.querySelectorAll('.choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.choice').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        selected = Number(btn.dataset.i);
        submitBtn.disabled = false;
      });
    });
  } else {
    const input = $('#num-in', container);
    input.addEventListener('input', () => { submitBtn.disabled = input.value.trim() === ''; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !submitBtn.disabled) submitBtn.click(); });
    input.focus();
  }

  if (hintsAllowed) {
    const hintBtn = $('.hint-btn', container);
    hintBtn.addEventListener('click', () => {
      const box = document.createElement('div');
      box.className = 'hint-box';
      box.innerHTML = `<strong>Hint ${hintsUsed + 1}:</strong> ${q.hints[hintsUsed]}`;
      hintArea.appendChild(box);
      renderMath(box);
      hintsUsed += 1;
      if (hintsUsed >= q.hints.length) { hintBtn.disabled = true; hintBtn.textContent = 'All hints shown'; }
      else hintBtn.textContent = `Show hint (${hintsUsed + 1} of ${q.hints.length})`;
    });
  }

  submitBtn.addEventListener('click', () => {
    const response = q.type === 'mc' ? selected : $('#num-in', container).value;
    const grade = E.gradeAnswer(q, response);
    if (grade.unparsed) {
      fbArea.innerHTML = `<div class="feedback notyet"><p>That input could not be read as a number. Use a form like <code>7</code>, <code>-1.5</code>, or <code>3/4</code>, then check again.</p></div>`;
      return;
    }
    submitBtn.disabled = true;
    if (hintsAllowed) { const hb = $('.hint-btn', container); if (hb) hb.disabled = true; }
    container.querySelectorAll('.choice').forEach((b) => { b.disabled = true; });
    const numIn = $('#num-in', container); if (numIn) numIn.disabled = true;

    if (countsTowardMastery) {
      E.recordAnswer(S, { skillId: q.skillId, questionId: q.id, correct: grade.correct, hintsUsed, difficulty: q.difficulty, now: Date.now() });
      save();
    }

    if (deferFeedback) {
      fbArea.innerHTML = `<div class="feedback ${'good'}" style="border-color: var(--border); background: var(--surface-2);">
        <p>Answer recorded. You will see all results at the end.</p>
        <div class="btn-row"><button type="button" class="next-btn">Next</button></div></div>`;
    } else {
      if (q.type === 'mc') {
        const btns = container.querySelectorAll('.choice');
        btns[q.answerIndex].classList.add('reveal-correct');
        if (!grade.correct && selected !== null) btns[selected].classList.add('reveal-chosen');
      }
      const solutionHtml = `<ol class="solution-steps">${q.solution.map((st) =>
        `<li>${st.text}${st.math ? `<div class="step-math">$$${st.math}$$</div>` : ''}</li>`).join('')}</ol>`;
      if (grade.correct) {
        fbArea.innerHTML = `<div class="feedback good">
          <h3>Correct.</h3>
          ${hintsUsed > 0 ? `<p>You used ${hintsUsed} hint${hintsUsed > 1 ? 's' : ''}, so this counts as partial credit toward mastery. Solving without hints counts fully.</p>` : ''}
          <details><summary>Show the full solution</summary>${solutionHtml}</details>
          <div class="btn-row"><button type="button" class="next-btn">Continue</button></div>
        </div>`;
        announce('Correct.');
      } else {
        fbArea.innerHTML = `<div class="feedback notyet">
          <h3>Not yet.</h3>
          ${grade.misconception ? `<p><strong>About this choice:</strong> ${grade.misconception}</p>` : ''}
          <p><strong>Here is the complete solution:</strong></p>
          ${solutionHtml}
          <div class="btn-row"><button type="button" class="next-btn">Continue</button></div>
        </div>`;
        announce('Not yet correct. The full solution is shown.');
      }
    }
    renderMath(fbArea);
    $('.next-btn', fbArea).addEventListener('click', () => done({ correct: grade.correct, hintsUsed, response }));
    $('.next-btn', fbArea).focus();
  });
}

// ---------------------------------------------------------------- views: home
function viewHome() {
  const m = CONTENT.manifest;
  const name = S.settings.name ? `, ${esc(S.settings.name)}` : '';
  const due = E.reviewQueue(S, allUnits(), Date.now(), m.reviewAfterDays);
  const failedNote = CONTENT.failed.length
    ? `<div class="card" style="border-color: var(--notyet);"><p><strong>Some content failed to load:</strong> ${esc(CONTENT.failed.join('; '))}. The server may still be preparing these units.</p></div>` : '';

  const unitCards = m.units.map((meta) => {
    const unit = CONTENT.units.get(meta.id);
    const unlocked = E.unitUnlocked(S, m, meta.number);
    const passed = Boolean(S.unitsPassed[meta.id]);
    const mastery = unit ? E.unitMastery(S, unit) : 0;
    const status = passed
      ? `<span class="tag passed">Passed${S.unitsPassed[meta.id].byPlacement ? ' by placement' : ''}</span>`
      : unlocked ? `<span class="tag">In progress — mastery ${mastery} / 100</span>`
      : `<span class="tag locked">Locked — pass Unit ${meta.number - 1}'s Mastery Check to unlock</span>`;
    return `<div class="card unit-card ${passed ? 'passed' : ''} ${unlocked ? '' : 'locked'}">
      <div class="unit-num" aria-hidden="true">${meta.number}</div>
      <div class="unit-body">
        <div class="unit-title-row">
          <h2>${esc(meta.title)}</h2>
          <span>${meta.bcOnly ? '<span class="tag bc">BC only</span>' : ''} ${status}</span>
        </div>
        <p>${esc(meta.blurb)} <em>(${esc(meta.examWeight)})</em></p>
        ${unlocked && unit ? `<div class="btn-row"><a class="btn ${passed ? 'secondary' : ''}" href="#/unit/${meta.id}">Open Unit ${meta.number}</a></div>` : ''}
      </div>
    </div>`;
  }).join('');

  mountView(`
    <h1>Welcome back${name}.</h1>
    <p>${esc(m.subtitle)}. Every unit follows the same path: <strong>lessons → practice → Mastery Check → next unit</strong>. Nothing unlocks by luck and nothing ever re-locks.</p>
    ${failedNote}
    ${S.lastLocation && S.lastLocation !== '#/home' ? `<div class="card subtle"><p><strong>Pick up where you left off:</strong></p><div class="btn-row"><a class="btn" href="${esc(S.lastLocation)}">Continue</a></div></div>` : ''}
    ${!S.diagnostic.completed ? `<div class="card">
        <h2>Optional: placement check</h2>
        <p>If you already know some calculus, a short placement check can unlock the units you have already mastered. It asks up to 3 questions per unit and stops as soon as a unit is not yet solid. You can stop at any time, and stopping early loses nothing.</p>
        <div class="btn-row"><a class="btn" href="#/diagnostic">Start placement check</a><span class="session-progress">Skippable — Unit 1 is already open.</span></div>
      </div>`
      : `<p class="session-progress">Placement check completed — placed through Unit ${S.diagnostic.placedThroughUnit || 0}.</p>`}
    ${due.length ? `<div class="card subtle"><p><strong>Review recommended:</strong> ${due.length} mastered skill${due.length > 1 ? 's have' : ' has'} not been exercised in a while. Review keeps mastery real; it never blocks your progress.</p><div class="btn-row"><a class="btn secondary" href="#/review">Open review</a></div></div>` : ''}
    <h2>Units</h2>
    ${unitCards}
  `, { breadcrumb: ['Home'], nav: 'home' });
  S.lastLocation = '#/home'; save();
}

// ---------------------------------------------------------------- views: unit
function viewUnit(unitId) {
  const unit = CONTENT.units.get(unitId);
  const m = CONTENT.manifest;
  if (!unit) return mountView(`<h1>Unit not found</h1><p>The unit "${esc(unitId)}" did not load. <a href="#/home">Back to Home</a>.</p>`, { breadcrumb: ['Home'] });
  if (!E.unitUnlocked(S, m, unit.number)) {
    return mountView(`<h1>Unit ${unit.number} is locked</h1>
      <p>To unlock it, pass the Mastery Check for Unit ${unit.number - 1}. That rule never changes.</p>
      <div class="btn-row"><a class="btn" href="#/unit/unit-${String(unit.number - 1).padStart(2, '0')}">Go to Unit ${unit.number - 1}</a></div>`,
      { breadcrumb: ['Home', `Unit ${unit.number}`], nav: 'home' });
  }
  const eligible = E.masteryCheckEligible(S, unit);
  const passed = Boolean(S.unitsPassed[unitId]);
  const notMastered = E.unitCoreSkills(unit).filter((sk) => !E.isMastered(S, sk.id));
  const lessonRows = unit.lessons.map((l) => {
    const doneAt = S.lessons[l.id];
    return `<div class="card subtle">
      <div class="unit-title-row"><h3 style="margin:0">${doneAt ? '✓ ' : ''}${esc(l.title)}</h3><span class="tag">${doneAt ? 'Completed' : `about ${l.estMinutes} min`}</span></div>
      <div class="btn-row"><a class="btn ${doneAt ? 'secondary' : ''}" href="#/lesson/${unitId}/${l.id}">${doneAt ? 'Reopen lesson' : 'Start lesson'}</a></div>
    </div>`;
  }).join('');

  mountView(`
    <h1>Unit ${unit.number}: ${esc(unit.title)}</h1>
    <p>${unit.overview}</p>
    ${whatsNext(passed
      ? `This unit is passed. You can keep practicing here any time, or continue to the next unit from <a href="#/home">Home</a>.`
      : eligible
        ? `All core skills are at mastery. The <strong>Mastery Check</strong> below is open — passing it unlocks Unit ${unit.number + 1}.`
        : `Work through the lessons, then use <strong>Practice</strong> until every core skill reaches ${E.MASTERY_THRESHOLD} / 100. Then the Mastery Check opens.`)}
    <h2>Skills in this unit</h2>
    <div class="card">${skillBars(unit)}
      <p class="session-progress">Mastery is earned by answering correctly without hints, including at difficulty 2 or higher. Wrong answers lower the score — that is expected and recoverable.</p>
    </div>
    <h2>Lessons</h2>
    ${lessonRows}
    <h2>Practice</h2>
    <div class="card">
      <p>Adaptive practice serves ${m.practiceSetSize} questions per set, always targeting your weakest skill at the right difficulty.</p>
      <div class="btn-row"><a class="btn" href="#/practice/${unitId}">Start a practice set</a></div>
    </div>
    <h2>Mastery Check</h2>
    <div class="card">
      <p><strong>The rules, in full:</strong></p>
      <ul class="rules-list">
        <li>${unit.masteryCheck.questionCount} questions, drawn from this unit's core skills at difficulty 2 and 3.</li>
        <li>You need ${unit.masteryCheck.passCount} correct to pass.</li>
        <li>No hints during the check. No time limit.</li>
        <li>Results and full solutions appear after the last question, not during.</li>
        <li>You can retake it as many times as you want — each retake draws a fresh set of questions. Nothing is lost by not passing.</li>
      </ul>
      ${passed ? `<p class="tag passed" style="display:inline-block">Passed on ${new Date(S.unitsPassed[unitId].passedAt).toLocaleDateString()}</p>` : ''}
      ${eligible
        ? `<div class="btn-row"><a class="btn" href="#/mastery/${unitId}">${passed ? 'Retake' : 'Start'} the Mastery Check</a></div>`
        : `<p><strong>Not open yet.</strong> These core skills are below ${E.MASTERY_THRESHOLD} / 100: ${notMastered.map((sk) => `${esc(sk.name)} (${E.masteryScore(S, sk.id)})`).join(', ')}.</p>`}
    </div>
  `, { breadcrumb: ['Home', `Unit ${unit.number}: ${unit.title}`], nav: 'home' });
  S.lastLocation = `#/unit/${unitId}`; save();
}

// -------------------------------------------------------------- views: lesson
function viewLesson(unitId, lessonId) {
  const unit = CONTENT.units.get(unitId);
  const lesson = unit?.lessons.find((l) => l.id === lessonId);
  if (!unit || !lesson) return mountView(`<h1>Lesson not found</h1><p><a href="#/home">Back to Home</a></p>`, { breadcrumb: ['Home'] });

  const idx = unit.lessons.indexOf(lesson);
  const next = unit.lessons[idx + 1];

  const sectionsHtml = lesson.sections.map((sec, i) => {
    if (sec.type === 'concept') return `<div class="section">${sec.html}</div>`;
    if (sec.type === 'coder-note') return `<div class="section coder-note"><span class="kicker">// for coders</span>${sec.html}</div>`;
    if (sec.type === 'worked-example') {
      return `<div class="section worked-example"><h3>Worked example: ${esc(sec.title)}</h3>
        <ol class="solution-steps">${sec.steps.map((st) => `<li>${st.text}${st.math ? `<div class="step-math">$$${st.math}$$</div>` : ''}</li>`).join('')}</ol></div>`;
    }
    if (sec.type === 'checkpoint') return `<div class="section checkpoint" data-sec="${i}"><h3>Check your understanding</h3><div class="checkpoint-slot"></div></div>`;
    return '';
  }).join('');

  const v = mountView(`
    <h1>${esc(lesson.title)}</h1>
    <p class="session-progress">Unit ${unit.number}, lesson ${idx + 1} of ${unit.lessons.length} · about ${lesson.estMinutes} minutes · checkpoints count toward mastery, and hints are allowed.</p>
    ${sectionsHtml}
    <div class="card">
      <div class="btn-row">
        <button type="button" id="lesson-done" class="${S.lessons[lessonId] ? 'secondary' : ''}">${S.lessons[lessonId] ? 'Lesson already completed — mark again' : 'Mark this lesson complete'}</button>
        <a class="btn secondary" href="#/unit/${unitId}">Back to Unit ${unit.number}</a>
        ${next ? `<a class="btn quiet" href="#/lesson/${unitId}/${next.id}">Next lesson: ${esc(next.title)}</a>` : ''}
      </div>
    </div>
  `, { breadcrumb: ['Home', `Unit ${unit.number}`, lesson.title], nav: 'home' });

  // Mount checkpoint questions in place, one after another within each slot.
  lesson.sections.forEach((sec, i) => {
    if (sec.type !== 'checkpoint') return;
    const slot = $(`.checkpoint[data-sec="${i}"] .checkpoint-slot`, v);
    const qs = sec.questionIds.map((qid) => questionById(unit, qid)).filter(Boolean);
    let k = 0;
    const nextQ = () => {
      if (k >= qs.length) {
        slot.insertAdjacentHTML('beforeend', `<p class="session-progress">Checkpoint finished (${qs.length} of ${qs.length}).</p>`);
        return;
      }
      const holder = document.createElement('div');
      slot.appendChild(holder);
      mountQuestion(holder, unit, qs[k], { hintsAllowed: true, index: k + 1, total: qs.length }, () => { k += 1; nextQ(); });
    };
    nextQ();
  });

  $('#lesson-done', v).addEventListener('click', () => {
    S.lessons[lessonId] = Date.now();
    save();
    location.hash = `#/unit/${unitId}`;
  });
  S.lastLocation = `#/lesson/${unitId}/${lessonId}`; save();
}

// ------------------------------------------------------------ views: practice
function viewPractice(unitId) {
  const unit = CONTENT.units.get(unitId);
  const m = CONTENT.manifest;
  if (!unit) return mountView(`<h1>Unit not found</h1><p><a href="#/home">Back to Home</a></p>`, { breadcrumb: ['Home'] });
  const setSize = m.practiceSetSize;
  const before = Object.fromEntries(unit.skills.map((sk) => [sk.id, E.masteryScore(S, sk.id)]));
  const recentIds = [];
  const results = [];

  const v = mountView(`
    <h1>Practice: Unit ${unit.number}</h1>
    <p class="session-progress" id="set-progress">A set is ${setSize} questions. Hints are allowed; solving without hints counts fully toward mastery.</p>
    <div id="timer-slot" class="btn-row"></div>
    <div id="q-slot"></div>
  `, { breadcrumb: ['Home', `Unit ${unit.number}`, 'Practice'], nav: 'home' });
  startTimerIfEnabled($('#timer-slot', v));

  const slot = $('#q-slot', v);
  const askNext = () => {
    if (results.length >= setSize) return showSummary();
    const q = E.pickPracticeQuestion(S, unit, recentIds);
    if (!q) return showSummary();
    recentIds.push(q.id);
    if (recentIds.length > 3) recentIds.shift();
    slot.innerHTML = '';
    mountQuestion(slot, unit, q, { hintsAllowed: true, index: results.length + 1, total: setSize }, (r) => {
      results.push({ q, ...r });
      askNext();
    });
  };

  const showSummary = () => {
    const correct = results.filter((r) => r.correct).length;
    const skillsTouched = [...new Set(results.map((r) => r.q.skillId))];
    const deltas = skillsTouched.map((sid) => {
      const after = E.masteryScore(S, sid);
      const d = after - (before[sid] ?? 0);
      return `<li>${esc(skillName(unit, sid))}: ${before[sid] ?? 0} → ${after} (${d >= 0 ? '+' : ''}${d})</li>`;
    }).join('');
    const eligible = E.masteryCheckEligible(S, unit);
    slot.innerHTML = `<div class="card">
      <h2>Set complete: ${correct} of ${results.length} correct</h2>
      <p>Mastery changes this set:</p>
      <ul class="rules-list">${deltas}</ul>
      ${whatsNext(eligible
        ? `All core skills are at mastery — the <strong>Mastery Check</strong> is open.`
        : `Keep practicing; the Mastery Check opens when every core skill reaches ${E.MASTERY_THRESHOLD} / 100.`)}
      <div class="btn-row">
        <button type="button" id="another-set">Another set</button>
        ${eligible ? `<a class="btn" href="#/mastery/${unitId}">Start the Mastery Check</a>` : ''}
        <a class="btn secondary" href="#/unit/${unitId}">Back to Unit ${unit.number}</a>
      </div>
    </div>`;
    renderMath(slot);
    $('#another-set', slot).addEventListener('click', () => viewPractice(unitId));
    announce(`Practice set complete. ${correct} of ${results.length} correct.`);
  };

  askNext();
  S.lastLocation = `#/practice/${unitId}`; save();
}

// ------------------------------------------------------------- views: mastery
function viewMastery(unitId) {
  const unit = CONTENT.units.get(unitId);
  if (!unit) return mountView(`<h1>Unit not found</h1><p><a href="#/home">Back to Home</a></p>`, { breadcrumb: ['Home'] });
  if (!E.masteryCheckEligible(S, unit)) {
    return mountView(`<h1>Mastery Check not open yet</h1>
      <p>It opens when every core skill in Unit ${unit.number} reaches ${E.MASTERY_THRESHOLD} / 100. <a href="#/unit/${unitId}">Back to the unit</a>.</p>`,
      { breadcrumb: ['Home', `Unit ${unit.number}`, 'Mastery Check'], nav: 'home' });
  }
  const { questionCount, passCount } = unit.masteryCheck;

  const v = mountView(`
    <h1>Mastery Check: Unit ${unit.number}</h1>
    <div class="card">
      <p><strong>Exactly what will happen:</strong></p>
      <ul class="rules-list">
        <li>${questionCount} questions, one at a time. ${passCount} correct passes.</li>
        <li>No hints. No time limit. After each answer you will only see "answer recorded".</li>
        <li>After question ${questionCount}, you get full results with every solution.</li>
        <li>Passing unlocks Unit ${unit.number + 1}. Not passing changes nothing — you keep all progress and can retake with fresh questions.</li>
      </ul>
      <div class="btn-row">
        <button type="button" id="start-check">Start now</button>
        <a class="btn secondary" href="#/unit/${unitId}">Go back instead</a>
      </div>
    </div>
    <div id="timer-slot" class="btn-row"></div>
    <div id="q-slot"></div>
  `, { breadcrumb: ['Home', `Unit ${unit.number}`, 'Mastery Check'], nav: 'home' });

  $('#start-check', v).addEventListener('click', () => {
    $('#start-check', v).closest('.card').remove();
    startTimerIfEnabled($('#timer-slot', v));
    const questions = E.sampleMasteryCheck(unit);
    const answers = [];
    const slot = $('#q-slot', v);
    const ask = () => {
      if (answers.length >= questions.length) return finish();
      const q = questions[answers.length];
      slot.innerHTML = '';
      mountQuestion(slot, unit, q, { hintsAllowed: false, deferFeedback: true, index: answers.length + 1, total: questions.length }, (r) => {
        answers.push({ q, ...r });
        ask();
      });
    };
    const finish = () => {
      const correct = answers.filter((a) => a.correct).length;
      const passed = E.recordMasteryCheck(S, unit, correct, questions.length, Date.now());
      save();
      const weakSkills = [...new Set(answers.filter((a) => !a.correct).map((a) => a.q.skillId))];
      const reviewHtml = answers.map((a, i) => `
        <details class="card subtle">
          <summary>Question ${i + 1}: ${a.correct ? 'correct' : 'not correct'} — ${esc(skillName(unit, a.q.skillId))}</summary>
          <div class="q-prompt">${a.q.prompt}</div>
          ${a.q.type === 'mc'
            ? `<p>Your answer: ${a.response !== null && a.response !== undefined ? a.q.choices[a.response] : '(none)'} · Correct answer: ${a.q.choices[a.q.answerIndex]}</p>`
            : `<p>Your answer: ${esc(String(a.response))} · Correct answer: ${a.q.answer}</p>`}
          <ol class="solution-steps">${a.q.solution.map((st) => `<li>${st.text}${st.math ? `<div class="step-math">$$${st.math}$$</div>` : ''}</li>`).join('')}</ol>
        </details>`).join('');
      slot.innerHTML = `<div class="card">
        <h2>${passed ? `Passed: ${correct} of ${questions.length}.` : `Not passed yet: ${correct} of ${questions.length}. You need ${passCount}.`}</h2>
        ${passed
          ? `<p>Unit ${unit.number} is complete. Unit ${unit.number + 1} is now unlocked.</p>`
          : `<p>This is information, not a setback: it shows exactly what to practice. Skills to revisit: ${weakSkills.map((sid) => esc(skillName(unit, sid))).join(', ') || '—'}.</p>`}
        <div class="btn-row">
          ${passed
            ? (CONTENT.byNumber.get(unit.number + 1) ? `<a class="btn" href="#/unit/unit-${String(unit.number + 1).padStart(2, '0')}">Go to Unit ${unit.number + 1}</a>` : `<a class="btn" href="#/home">Back to Home</a>`)
            : `<a class="btn" href="#/practice/${unitId}">Practice the weak skills</a><button type="button" class="secondary" id="retake-btn">Retake with fresh questions</button>`}
          <a class="btn quiet" href="#/unit/${unitId}">Back to Unit ${unit.number}</a>
        </div>
      </div>
      <h2>Every question, with solutions</h2>
      ${reviewHtml}`;
      renderMath(slot);
      const retake = $('#retake-btn', slot);
      if (retake) retake.addEventListener('click', () => viewMastery(unitId));
      announce(passed ? `Mastery check passed, ${correct} of ${questions.length}.` : `Mastery check: ${correct} of ${questions.length}. ${passCount} needed.`);
      window.scrollTo(0, 0);
    };
    ask();
  });
  S.lastLocation = `#/unit/${unitId}`; save();
}

// ---------------------------------------------------------- views: diagnostic
function viewDiagnostic() {
  const units = allUnits();
  const v = mountView(`
    <h1>Placement check</h1>
    <div class="card">
      <p><strong>Exactly how this works:</strong></p>
      <ul class="rules-list">
        <li>Questions come unit by unit, starting at Unit 1: two questions per unit, plus a third only if you get exactly one of the first two.</li>
        <li>A unit places out when you answer 2 questions correctly. Hints are not available; you see whether you were right after each question.</li>
        <li>The check stops at the first unit that does not place out, or whenever you press "Stop here". Stopping early loses nothing.</li>
        <li>Result: all placed units unlock immediately and count as passed by placement. You can still practice or review them any time.</li>
      </ul>
      <div class="btn-row"><button type="button" id="diag-start">Begin with Unit 1</button><a class="btn secondary" href="#/home">Not now</a></div>
    </div>
    <div id="q-slot"></div>
  `, { breadcrumb: ['Home', 'Placement check'], nav: 'home' });

  $('#diag-start', v).addEventListener('click', () => {
    $('#diag-start', v).closest('.card').remove();
    const slot = $('#q-slot', v);
    let unitIdx = 0;
    let placedThrough = 0;

    const runUnit = () => {
      if (unitIdx >= units.length) return finish();
      const unit = units[unitIdx];
      const core = E.unitCoreSkills(unit);
      const pool = unit.questions.filter((q) => q.difficulty === 2 && core.some((s) => s.id === q.skillId));
      const bySkill = new Map();
      for (const q of pool) if (!bySkill.has(q.skillId)) bySkill.set(q.skillId, q);
      const picks = [...bySkill.values()].slice(0, 3);
      if (picks.length < 2) { finish(); return; } // content too thin to place — stop cleanly
      let right = 0, asked = 0;
      const askOne = () => {
        const needThird = asked === 2 && right === 1;
        if (asked >= 2 && !needThird) {
          if (right >= 2) { placedThrough = unit.number; unitIdx += 1; runUnit(); }
          else finish();
          return;
        }
        if (needThird && picks.length < 3) { finish(); return; }
        const q = picks[asked];
        slot.innerHTML = `<h2>Unit ${unit.number}: ${esc(unit.title)}</h2>`;
        const holder = document.createElement('div');
        slot.appendChild(holder);
        mountQuestion(holder, unit, q, { hintsAllowed: false, index: asked + 1, total: needThird || asked === 2 ? 3 : 2 }, (r) => {
          asked += 1;
          if (r.correct) right += 1;
          if (asked === 3) {
            if (right >= 2) { placedThrough = unit.number; unitIdx += 1; runUnit(); }
            else finish();
            return;
          }
          askOne();
        });
        holder.insertAdjacentHTML('beforeend', `<div class="btn-row"><button type="button" class="quiet stop-btn">Stop here and apply my placement</button></div>`);
        $('.stop-btn', holder).addEventListener('click', finish);
      };
      askOne();
    };

    const finish = () => {
      E.applyDiagnosticPlacement(S, placedThrough, units, Date.now());
      save();
      slot.innerHTML = `<div class="card">
        <h2>Placement complete</h2>
        <p>${placedThrough === 0
          ? 'You start at Unit 1 — the standard starting point. Nothing about this was a failure; it simply sets the right first step.'
          : `Units 1 through ${placedThrough} are unlocked and marked passed by placement. Your next new material is Unit ${Math.min(placedThrough + 1, 10)}.`}</p>
        <div class="btn-row"><a class="btn" href="#/home">Go to Home</a>
        ${placedThrough < 10 ? `<a class="btn secondary" href="#/unit/unit-${String(Math.min(placedThrough + 1, 10)).padStart(2, '0')}">Open Unit ${Math.min(placedThrough + 1, 10)}</a>` : ''}</div>
      </div>`;
      announce('Placement complete.');
    };

    runUnit();
  });
}

// -------------------------------------------------------------- views: review
function viewReview() {
  const m = CONTENT.manifest;
  const due = E.reviewQueue(S, allUnits(), Date.now(), m.reviewAfterDays);
  if (!due.length) {
    return mountView(`<h1>Review</h1>
      <p>Nothing is due for review right now. Skills come here after being mastered and then untouched for ${m.reviewAfterDays} days. Review is recommended, never required — it keeps mastery honest but never blocks progress.</p>
      <div class="btn-row"><a class="btn secondary" href="#/home">Back to Home</a></div>`,
      { breadcrumb: ['Home', 'Review'], nav: 'review' });
  }
  const sessionItems = due.slice(0, 6);
  const listed = due.map((d) => `<li>${esc(d.skill.name)} (Unit ${d.unit.number}) — last exercised ${new Date(d.lastSeen).toLocaleDateString()}</li>`).join('');
  const v = mountView(`
    <h1>Review</h1>
    <p>${due.length} skill${due.length > 1 ? 's are' : ' is'} due. This session covers up to ${sessionItems.length} of them, one question each, hints allowed.</p>
    <ul class="rules-list">${listed}</ul>
    <div class="btn-row"><button type="button" id="rev-start">Start review session</button><a class="btn secondary" href="#/home">Back to Home</a></div>
    <div id="q-slot"></div>
  `, { breadcrumb: ['Home', 'Review'], nav: 'review' });

  $('#rev-start', v).addEventListener('click', () => {
    $('#rev-start', v).disabled = true;
    const slot = $('#q-slot', v);
    let i = 0, correct = 0;
    const ask = () => {
      if (i >= sessionItems.length) {
        slot.innerHTML = `<div class="card"><h2>Review complete: ${correct} of ${sessionItems.length} correct</h2>
          <p>Anything answered incorrectly has its mastery score adjusted, so adaptive practice in that unit will pick it up. Nothing was locked.</p>
          <div class="btn-row"><a class="btn" href="#/home">Back to Home</a></div></div>`;
        announce('Review complete.');
        return;
      }
      const { unit, skill } = sessionItems[i];
      const seen = S.seenQuestions;
      const qs = unit.questions.filter((q) => q.skillId === skill.id && q.difficulty >= 2)
        .sort((a, b) => (seen[a.id]?.last || 0) - (seen[b.id]?.last || 0));
      const q = qs[0] || unit.questions.find((qq) => qq.skillId === skill.id);
      slot.innerHTML = '';
      mountQuestion(slot, unit, q, { hintsAllowed: true, index: i + 1, total: sessionItems.length }, (r) => {
        if (r.correct) correct += 1;
        i += 1; ask();
      });
    };
    ask();
  });
}

// ------------------------------------------------------------ views: settings
function viewSettings() {
  const s = S.settings;
  const v = mountView(`
    <h1>Settings</h1>
    <div class="card">
      <h2>Display</h2>
      <p><label>Your name (used only for the greeting): <input id="set-name" type="text" value="${esc(s.name)}" style="font:inherit;padding:0.4rem;border:2px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)"></label></p>
      <p>Text size:
        ${['medium', 'large', 'xlarge'].map((t) => `<label style="margin-right:1rem"><input type="radio" name="textsize" value="${t}" ${s.textSize === t ? 'checked' : ''}> ${t === 'medium' ? 'Standard' : t === 'large' ? 'Large' : 'Extra large'}</label>`).join('')}
      </p>
      <p>Theme:
        ${['system', 'light', 'dark'].map((t) => `<label style="margin-right:1rem"><input type="radio" name="theme" value="${t}" ${s.theme === t ? 'checked' : ''}> ${t[0].toUpperCase()}${t.slice(1)}</label>`).join('')}
      </p>
      <p><label><input type="checkbox" id="set-timer" ${s.showTimer ? 'checked' : ''}> Show an elapsed-time counter during practice and mastery checks. It only counts up; nothing in this app has a time limit.</label></p>
    </div>
    <div class="card">
      <h2>How this app decides things</h2>
      <ul class="rules-list">
        <li>Mastery per skill is 0–100. Correct without hints raises it the most; hints give half credit; wrong answers lower it. Recent answers count more than old ones.</li>
        <li>A skill can only reach mastery (${E.MASTERY_THRESHOLD}) with correct answers at difficulty 2 or higher.</li>
        <li>The Mastery Check opens when all core skills reach ${E.MASTERY_THRESHOLD}, and passing it unlocks the next unit. Units never re-lock.</li>
        <li>Keyboard: Tab moves between controls, Enter or Space activates, Enter submits a typed answer.</li>
      </ul>
    </div>
    <div class="card">
      <h2>Your data</h2>
      <p>Progress saves to this server and to this browser after every answer. It never leaves this app.</p>
      <div class="btn-row">
        <button type="button" id="export-btn" class="secondary">Download my progress (JSON)</button>
        <label class="btn secondary" style="cursor:pointer">Import progress<input id="import-file" type="file" accept="application/json" class="visually-hidden"></label>
      </div>
      <h3>Start over</h3>
      <p><label><input type="checkbox" id="reset-confirm"> I understand this erases all progress and cannot be undone.</label></p>
      <div class="btn-row"><button type="button" id="reset-btn" disabled>Erase all progress</button></div>
    </div>
  `, { breadcrumb: ['Home', 'Settings'], nav: 'settings' });

  $('#set-name', v).addEventListener('input', (e) => { S.settings.name = e.target.value.slice(0, 40); save(); });
  v.querySelectorAll('input[name="textsize"]').forEach((r) => r.addEventListener('change', (e) => { S.settings.textSize = e.target.value; applySettings(); save(); }));
  v.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', (e) => { S.settings.theme = e.target.value; applySettings(); save(); }));
  $('#set-timer', v).addEventListener('change', (e) => { S.settings.showTimer = e.target.checked; save(); });
  $('#export-btn', v).addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'calc-coach-progress.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#import-file', v).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || !parsed.skills) throw new Error('not a Calc Coach progress file');
      S = ensureAppFields(parsed);
      applySettings(); save();
      location.hash = '#/home';
    } catch (err) {
      alert(`That file could not be imported: ${err.message}`);
    }
  });
  const resetChk = $('#reset-confirm', v);
  const resetBtn = $('#reset-btn', v);
  resetChk.addEventListener('change', () => { resetBtn.disabled = !resetChk.checked; });
  resetBtn.addEventListener('click', () => {
    S = ensureAppFields(E.newState());
    applySettings(); save();
    location.hash = '#/home';
  });
}

// ---------------------------------------------------------------- app plumbing
function applySettings() {
  const s = S.settings;
  const dark = s.theme === 'dark' || (s.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.textsize = s.textSize || 'medium';
}

function router() {
  const hash = location.hash || '#/home';
  const parts = hash.slice(2).split('/');
  const [route, a, b] = parts;
  if (route === 'home' || route === '') viewHome();
  else if (route === 'unit' && a) viewUnit(a);
  else if (route === 'lesson' && a && b) viewLesson(a, b);
  else if (route === 'practice' && a) viewPractice(a);
  else if (route === 'mastery' && a) viewMastery(a);
  else if (route === 'diagnostic') viewDiagnostic();
  else if (route === 'review') viewReview();
  else if (route === 'settings') viewSettings();
  else viewHome();
}

async function boot() {
  try {
    S = await loadProgress();
    applySettings();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);
    await loadContent();
    window.addEventListener('hashchange', router);
    router();
  } catch (e) {
    viewEl().innerHTML = `<h1>Calc Coach could not start</h1>
      <p>${esc(e.message)}</p>
      <p>Check that the server is running (<code>node server.js</code> in the calculus-coach folder) and reload this page.</p>`;
  }
}

boot();
