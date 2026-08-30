// Calc Coach adaptive engine — pure logic, no DOM, no network.
// Used by the browser app (public/app.js) and by node:test (test/engine.test.mjs).
//
// The model, in plain terms (also documented in README.md):
// - Every answer updates the skill's mastery estimate `ewma` (0..1) by
//   exponential moving average: new = ALPHA*credit + (1-ALPHA)*old.
//   credit: 1 for correct with no hints, 0.5 for correct with hints, 0 for wrong.
// - Displayed mastery is round(100*ewma), but capped at 70 until the learner
//   has a recent (last 6 events) correct answer at difficulty >= 2 — so
//   mastery can never be reached on easy questions alone.
// - Each skill has a difficulty ladder position (1..3): clean correct moves up,
//   wrong (or correct only via 2+ hints) moves down.
// - A unit's Mastery Check unlocks when every core skill is mastered (>= 80).
//   Passing the check (e.g. 7 of 8, no hints) unlocks the next unit. Units are
//   never re-locked afterward.

export const MASTERY_THRESHOLD = 80;
export const EWMA_ALPHA = 0.3; // 5 clean correct answers reach mastery: 1 - 0.7^5 ≈ 0.83
export const RECENT_WINDOW = 6;
export const EVENT_CAP = 20;

export function newState() {
  return {
    version: 1,
    createdAt: null,
    settings: { name: '', textSize: 'medium', theme: 'system', showTimer: false },
    diagnostic: { completed: false, placedThroughUnit: 0 },
    unitsPassed: {},   // unitId -> { passedAt, correct, total }
    skills: {},        // skillId -> { events[], ewma, difficulty, lastSeen, placed }
    seenQuestions: {}, // questionId -> { last, correctCount, wrongCount }
  };
}

export function skillState(state, skillId) {
  if (!state.skills[skillId]) {
    state.skills[skillId] = { events: [], ewma: 0, difficulty: 1, lastSeen: 0, placed: false };
  }
  return state.skills[skillId];
}

export function recordAnswer(state, { skillId, questionId, correct, hintsUsed, difficulty, now }) {
  const s = skillState(state, skillId);
  const credit = correct ? (hintsUsed > 0 ? 0.5 : 1) : 0;
  s.ewma = EWMA_ALPHA * credit + (1 - EWMA_ALPHA) * s.ewma;
  s.events.push({ t: now, qid: questionId, correct, hintsUsed, difficulty });
  if (s.events.length > EVENT_CAP) s.events.splice(0, s.events.length - EVENT_CAP);
  if (correct && hintsUsed === 0) s.difficulty = Math.min(3, s.difficulty + 1);
  else if (!correct || hintsUsed >= 2) s.difficulty = Math.max(1, s.difficulty - 1);
  s.lastSeen = now;

  const q = state.seenQuestions[questionId] || { last: 0, correctCount: 0, wrongCount: 0 };
  q.last = now;
  if (correct) q.correctCount += 1; else q.wrongCount += 1;
  state.seenQuestions[questionId] = q;
  return state;
}

export function masteryScore(state, skillId) {
  const s = state.skills[skillId];
  if (!s) return 0;
  let score = Math.round(100 * s.ewma);
  const recent = s.events.slice(-RECENT_WINDOW);
  const provenAtLevel = s.placed || recent.some((e) => e.correct && e.difficulty >= 2);
  if (!provenAtLevel) score = Math.min(score, MASTERY_THRESHOLD - 10);
  return score;
}

export const isMastered = (state, skillId) => masteryScore(state, skillId) >= MASTERY_THRESHOLD;

export function unitCoreSkills(unit) {
  return unit.skills.filter((s) => s.core);
}

export function unitMastery(state, unit) {
  const core = unitCoreSkills(unit);
  if (!core.length) return 0;
  const total = core.reduce((sum, s) => sum + masteryScore(state, s.id), 0);
  return Math.round(total / core.length);
}

export function masteryCheckEligible(state, unit) {
  return unitCoreSkills(unit).every((s) => isMastered(state, s.id));
}

export function unitUnlocked(state, manifest, unitNumber) {
  if (unitNumber <= 1) return true;
  const prev = manifest.units.find((u) => u.number === unitNumber - 1);
  if (prev && state.unitsPassed[prev.id]) return true;
  return state.diagnostic.placedThroughUnit >= unitNumber - 1;
}

// Practice selection: weakest core-skill-first, at the skill's current ladder
// difficulty, preferring questions never seen, then previously-wrong, then
// least-recently-seen. `recentIds` (the last few shown) are excluded so the
// same question never repeats back-to-back.
export function pickPracticeQuestion(state, unit, recentIds = []) {
  const recent = new Set(recentIds);
  const skills = [...unit.skills].sort((a, b) => {
    const am = isMastered(state, a.id) ? 1 : 0;
    const bm = isMastered(state, b.id) ? 1 : 0;
    if (am !== bm) return am - bm; // unmastered first
    if (a.core !== b.core) return a.core ? -1 : 1; // core first
    const diff = masteryScore(state, a.id) - masteryScore(state, b.id);
    if (diff !== 0) return diff; // weakest first
    return (state.skills[a.id]?.lastSeen || 0) - (state.skills[b.id]?.lastSeen || 0);
  });

  for (const skill of skills) {
    const target = state.skills[skill.id]?.difficulty || 1;
    const pool = unit.questions.filter((q) => q.skillId === skill.id && !recent.has(q.id));
    if (!pool.length) continue;
    pool.sort((a, b) => {
      const da = Math.abs(a.difficulty - target);
      const db = Math.abs(b.difficulty - target);
      if (da !== db) return da - db;
      const sa = state.seenQuestions[a.id];
      const sb = state.seenQuestions[b.id];
      if (!sa !== !sb) return sa ? 1 : -1; // unseen first
      if (sa && sb) {
        const wa = sa.wrongCount > sa.correctCount ? 0 : 1; // previously-wrong first
        const wb = sb.wrongCount > sb.correctCount ? 0 : 1;
        if (wa !== wb) return wa - wb;
        return sa.last - sb.last; // least recently seen
      }
      return a.id < b.id ? -1 : 1;
    });
    return pool[0];
  }
  return null;
}

// Mastery check: `questionCount` questions at difficulty >= 2 drawn from core
// skills, spread round-robin across skills so one strong skill can't carry it.
export function sampleMasteryCheck(unit, rand = Math.random) {
  const coreIds = new Set(unitCoreSkills(unit).map((s) => s.id));
  const bySkill = new Map();
  for (const q of unit.questions) {
    if (q.difficulty >= 2 && coreIds.has(q.skillId)) {
      if (!bySkill.has(q.skillId)) bySkill.set(q.skillId, []);
      bySkill.get(q.skillId).push(q);
    }
  }
  const buckets = [...bySkill.values()].map((qs) => shuffle(qs, rand));
  const picked = [];
  let i = 0;
  while (picked.length < unit.masteryCheck.questionCount && buckets.some((b) => b.length)) {
    const bucket = buckets[i % buckets.length];
    if (bucket.length) picked.push(bucket.pop());
    i += 1;
  }
  return shuffle(picked, rand);
}

export function recordMasteryCheck(state, unit, correct, total, now) {
  const passed = correct >= unit.masteryCheck.passCount;
  if (passed) state.unitsPassed[unit.id] = { passedAt: now, correct, total };
  return passed;
}

// Diagnostic placement: passing units 1..N seeds their core skills at a solid
// (but not perfect) level, so review still has room to matter. Never lowers
// anything the learner already has.
export function applyDiagnosticPlacement(state, throughUnitNumber, unitsData, now) {
  state.diagnostic.completed = true;
  state.diagnostic.placedThroughUnit = throughUnitNumber;
  for (const unit of unitsData) {
    if (unit.number > throughUnitNumber) continue;
    for (const skill of unitCoreSkills(unit)) {
      const s = skillState(state, skill.id);
      if (s.ewma < 0.85) s.ewma = 0.85;
      s.placed = true;
      s.difficulty = Math.max(s.difficulty, 2);
      if (!s.lastSeen) s.lastSeen = now;
    }
    if (!state.unitsPassed[unit.id]) {
      state.unitsPassed[unit.id] = { passedAt: now, correct: 0, total: 0, byPlacement: true };
    }
  }
  return state;
}

// Review: mastered skills not exercised for `afterDays` days, oldest first.
// Review is recommended, never blocking — falling behind on review does not
// re-lock anything.
export function reviewQueue(state, unitsData, now, afterDays = 3) {
  const cutoff = now - afterDays * 24 * 60 * 60 * 1000;
  const due = [];
  for (const unit of unitsData) {
    for (const skill of unit.skills) {
      const s = state.skills[skill.id];
      if (s && isMastered(state, skill.id) && s.lastSeen > 0 && s.lastSeen < cutoff) {
        due.push({ unit, skill, lastSeen: s.lastSeen });
      }
    }
  }
  return due.sort((a, b) => a.lastSeen - b.lastSeen);
}

// Numeric answers accept integers, decimals, and simple fractions like -3/4.
export function parseNumericInput(text) {
  const t = String(text ?? '').trim().replace(/\s+/g, '');
  if (!t) return null;
  const frac = t.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
  if (frac) {
    const denom = Number(frac[2]);
    if (denom === 0) return null;
    return Number(frac[1]) / denom;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function gradeAnswer(question, response) {
  if (question.type === 'mc') {
    const idx = Number(response);
    const correct = idx === question.answerIndex;
    return {
      correct,
      misconception: correct ? null : (question.misconceptions?.[idx] ?? null),
    };
  }
  const value = parseNumericInput(response);
  if (value === null) return { correct: false, misconception: null, unparsed: true };
  const tol = question.tolerance ?? 0.001;
  return { correct: Math.abs(value - question.answer) <= tol, misconception: null };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
