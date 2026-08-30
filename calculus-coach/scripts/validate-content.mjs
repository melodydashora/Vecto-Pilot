#!/usr/bin/env node
// Validates unit content files against content/schema.md.
// Usage: node validate-content.mjs [unit-01 ...]   (no args = validate all units in manifest)
// Exit 0 = clean; exit 1 = errors (printed one per line, prefixed with the unit id).

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content');

const ALLOWED_TAGS = new Set(['p', 'ul', 'ol', 'li', 'strong', 'em', 'code', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote']);
const SECTION_TYPES = new Set(['concept', 'coder-note', 'worked-example', 'checkpoint']);

const errors = [];
let currentUnit = 'manifest';
const err = (msg) => errors.push(`[${currentUnit}] ${msg}`);

function checkString(s, where, { html = false } = {}) {
  if (typeof s !== 'string' || s.length === 0) { err(`${where}: must be a non-empty string`); return; }
  const dollars = (s.match(/\$/g) || []).length;
  if (dollars % 2 !== 0) err(`${where}: odd number of '$' characters (unbalanced math delimiters)`);
  if (/\\[()[\]]/.test(s.replace(/\\\\/g, ''))) {
    // catches \( \) \[ \] used as delimiters (after collapsing escaped backslashes)
    if (/(^|[^\\])\\[()[\]]/.test(s)) err(`${where}: uses \\( \\) \\[ \\] delimiters; use $ and $$`);
  }
  if (/<script|javascript:|on\w+\s*=/i.test(s)) err(`${where}: contains disallowed script/handler content`);
  if (html) {
    for (const m of s.matchAll(/<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/g)) {
      if (!ALLOWED_TAGS.has(m[1].toLowerCase())) err(`${where}: HTML tag <${m[1]}> is not in the allowed set`);
    }
    if (/style\s*=/i.test(s)) err(`${where}: inline style attributes are not allowed`);
  }
}

function validateUnit(unitMeta, seenSkillIds, seenQuestionIds) {
  currentUnit = unitMeta.id;
  const path = join(CONTENT, unitMeta.file);
  if (!existsSync(path)) { err(`file ${unitMeta.file} does not exist`); return; }
  let u;
  try { u = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { err(`invalid JSON: ${e.message}`); return; }

  if (u.id !== unitMeta.id) err(`id "${u.id}" does not match manifest id "${unitMeta.id}"`);
  if (u.number !== unitMeta.number) err(`number ${u.number} does not match manifest number ${unitMeta.number}`);
  if (u.title !== unitMeta.title) err(`title does not match manifest title`);
  checkString(u.overview, 'overview');

  // --- skills ---
  if (!Array.isArray(u.skills) || u.skills.length < 4 || u.skills.length > 8) err(`skills: need 4–8, found ${u.skills?.length ?? 0}`);
  const skillIds = new Set();
  const prefix = `u${u.number}-`;
  for (const s of u.skills || []) {
    if (typeof s.id !== 'string' || !s.id.startsWith(prefix)) err(`skill "${s.id}": id must start with "${prefix}"`);
    if (skillIds.has(s.id)) err(`skill "${s.id}": duplicate id in unit`);
    if (seenSkillIds.has(s.id)) err(`skill "${s.id}": duplicate id across units`);
    skillIds.add(s.id); seenSkillIds.add(s.id);
    checkString(s.name, `skill ${s.id} name`);
    if (typeof s.core !== 'boolean') err(`skill "${s.id}": core must be boolean`);
  }

  // --- questions ---
  if (!Array.isArray(u.questions) || u.questions.length < 24 || u.questions.length > 40) err(`questions: need 24–40, found ${u.questions?.length ?? 0}`);
  const qIds = new Set();
  const qidRe = new RegExp(`^u${u.number}-q\\d{3}$`);
  for (const q of u.questions || []) {
    const w = `question ${q.id}`;
    if (typeof q.id !== 'string' || !qidRe.test(q.id)) err(`${w}: id must match u${u.number}-qNNN`);
    if (qIds.has(q.id)) err(`${w}: duplicate id in unit`);
    if (seenQuestionIds.has(q.id)) err(`${w}: duplicate id across units`);
    qIds.add(q.id); seenQuestionIds.add(q.id);
    if (!skillIds.has(q.skillId)) err(`${w}: skillId "${q.skillId}" not defined in unit skills`);
    if (![1, 2, 3].includes(q.difficulty)) err(`${w}: difficulty must be 1, 2, or 3`);
    checkString(q.prompt, `${w} prompt`, { html: true });
    if (q.type === 'mc') {
      if (!Array.isArray(q.choices) || q.choices.length < 3 || q.choices.length > 5) err(`${w}: mc needs 3–5 choices`);
      else {
        q.choices.forEach((c, i) => checkString(c, `${w} choice ${i}`));
        if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex >= q.choices.length) err(`${w}: answerIndex out of range`);
        if (!Array.isArray(q.misconceptions) || q.misconceptions.length !== q.choices.length) err(`${w}: misconceptions must match choices length`);
        else q.misconceptions.forEach((m, i) => {
          if (i === q.answerIndex) { if (m !== null) err(`${w}: misconceptions[${i}] (correct choice) must be null`); }
          else checkString(m, `${w} misconceptions ${i}`);
        });
      }
    } else if (q.type === 'numeric') {
      if (typeof q.answer !== 'number' || !Number.isFinite(q.answer)) err(`${w}: numeric answer must be a finite number`);
      if (q.tolerance !== undefined && (typeof q.tolerance !== 'number' || q.tolerance < 0)) err(`${w}: tolerance must be a number >= 0`);
    } else err(`${w}: type must be "mc" or "numeric"`);
    if (!Array.isArray(q.hints) || q.hints.length < 2 || q.hints.length > 3) err(`${w}: need 2–3 hints`);
    else q.hints.forEach((h, i) => checkString(h, `${w} hint ${i}`));
    if (!Array.isArray(q.solution) || q.solution.length < 2 || q.solution.length > 6) err(`${w}: solution needs 2–6 steps`);
    else q.solution.forEach((st, i) => {
      checkString(st.text, `${w} solution step ${i} text`);
      if (st.math !== undefined) checkString(st.math, `${w} solution step ${i} math`);
    });
  }

  // per-skill coverage
  for (const s of u.skills || []) {
    const qs = (u.questions || []).filter((q) => q.skillId === s.id);
    const d2 = qs.filter((q) => q.difficulty >= 2).length;
    const d3 = qs.filter((q) => q.difficulty === 3).length;
    if (s.core) {
      if (qs.length < 4) err(`skill "${s.id}" (core): needs >= 4 questions, has ${qs.length}`);
      if (d2 < 2) err(`skill "${s.id}" (core): needs >= 2 questions at difficulty >= 2, has ${d2}`);
      if (d3 < 1) err(`skill "${s.id}" (core): needs >= 1 question at difficulty 3, has ${d3}`);
    } else if (qs.length < 2) err(`skill "${s.id}": needs >= 2 questions, has ${qs.length}`);
  }

  // --- lessons ---
  if (!Array.isArray(u.lessons) || u.lessons.length < 3 || u.lessons.length > 6) err(`lessons: need 3–6, found ${u.lessons?.length ?? 0}`);
  const lessonIds = new Set();
  const coveredSkills = new Set();
  for (const l of u.lessons || []) {
    const w = `lesson ${l.id}`;
    if (typeof l.id !== 'string' || !l.id.startsWith(prefix)) err(`${w}: id must start with "${prefix}"`);
    if (lessonIds.has(l.id)) err(`${w}: duplicate lesson id`);
    lessonIds.add(l.id);
    checkString(l.title, `${w} title`);
    if (!Number.isInteger(l.estMinutes) || l.estMinutes < 3 || l.estMinutes > 45) err(`${w}: estMinutes must be an integer 3–45`);
    if (!Array.isArray(l.skillIds) || l.skillIds.length === 0) err(`${w}: skillIds required`);
    else l.skillIds.forEach((sid) => { if (!skillIds.has(sid)) err(`${w}: skillId "${sid}" not defined`); coveredSkills.add(sid); });
    if (!Array.isArray(l.sections) || l.sections.length < 3) err(`${w}: needs >= 3 sections`);
    let hasCheckpoint = false;
    for (const [i, sec] of (l.sections || []).entries()) {
      if (!SECTION_TYPES.has(sec.type)) { err(`${w} section ${i}: unknown type "${sec.type}"`); continue; }
      if (sec.type === 'checkpoint') {
        hasCheckpoint = true;
        if (!Array.isArray(sec.questionIds) || sec.questionIds.length < 1 || sec.questionIds.length > 3) err(`${w} section ${i}: checkpoint needs 1–3 questionIds`);
        else sec.questionIds.forEach((qid) => { if (!qIds.has(qid)) err(`${w} section ${i}: questionId "${qid}" not in unit pool`); });
      } else if (sec.type === 'worked-example') {
        checkString(sec.title, `${w} section ${i} title`);
        if (!Array.isArray(sec.steps) || sec.steps.length < 2) err(`${w} section ${i}: worked-example needs >= 2 steps`);
        else sec.steps.forEach((st, j) => {
          checkString(st.text, `${w} section ${i} step ${j} text`);
          if (st.math !== undefined) checkString(st.math, `${w} section ${i} step ${j} math`);
        });
      } else checkString(sec.html, `${w} section ${i} html`, { html: true });
    }
    if (!hasCheckpoint) err(`${w}: every lesson needs a checkpoint section`);
    if ((l.sections || []).at(-1)?.type !== 'checkpoint') err(`${w}: last section must be a checkpoint`);
  }
  for (const s of u.skills || []) if (!coveredSkills.has(s.id)) err(`skill "${s.id}": not taught by any lesson`);

  // --- mastery check ---
  const mc = u.masteryCheck;
  if (!mc || !Number.isInteger(mc.questionCount) || !Number.isInteger(mc.passCount)) err(`masteryCheck: needs integer questionCount and passCount`);
  else {
    if (mc.passCount > mc.questionCount) err(`masteryCheck: passCount > questionCount`);
    if (mc.questionCount < 6 || mc.questionCount > 12) err(`masteryCheck: questionCount must be 6–12`);
    if (mc.passCount / mc.questionCount < 0.8) err(`masteryCheck: pass ratio must be >= 0.8`);
    const coreIds = new Set((u.skills || []).filter((s) => s.core).map((s) => s.id));
    const pool = (u.questions || []).filter((q) => q.difficulty >= 2 && coreIds.has(q.skillId)).length;
    if (pool < 12) err(`masteryCheck pool (difficulty >= 2 on core skills) must be >= 12, has ${pool}`);
  }
}

// --- run ---
const manifest = JSON.parse(readFileSync(join(CONTENT, 'manifest.json'), 'utf8'));
const requested = process.argv.slice(2);
const units = requested.length
  ? manifest.units.filter((m) => requested.includes(m.id))
  : manifest.units;
if (requested.length && units.length !== requested.length) {
  const known = new Set(manifest.units.map((m) => m.id));
  for (const r of requested) if (!known.has(r)) errors.push(`[args] unknown unit id "${r}"`);
}
const seenSkillIds = new Set();
const seenQuestionIds = new Set();
for (const meta of units) validateUnit(meta, seenSkillIds, seenQuestionIds);

if (errors.length) {
  for (const e of errors) console.error(`ERROR ${e}`);
  console.error(`\n${errors.length} error(s).`);
  process.exit(1);
}
console.log(`OK — ${units.map((u) => u.id).join(', ')} valid.`);
