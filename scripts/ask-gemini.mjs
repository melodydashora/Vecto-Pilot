#!/usr/bin/env node
/**
 * ask-gemini.mjs — Claude Code ↔ Gemini 3.1 Pro bridge (2026-04-08)
 *
 * Purpose: Let Claude Code delegate tasks to Gemini 3.1 Pro from the terminal.
 * Gemini brings capabilities Claude Code lacks in-session:
 *   • 1M-token input context (large-file or whole-directory analysis)
 *   • Native Google Search grounding (live web knowledge)
 *   • Vision / multimodal input — pass screenshots with --image (2026-04-08)
 *   • A second opinion from a different model family
 *
 * Architecture notes:
 *   • Calls @google/genai directly (NOT via server/lib/ai/adapters/gemini-adapter.js).
 *     Rationale: the adapter auto-forces responseMimeType='application/json' whenever
 *     the word "json" appears in the prompt — fine for role-based calls, wrong for
 *     a conversational CLI where prompts may mention JSON incidentally.
 *   • Gemini 3.1 Pro only supports thinkingLevel LOW or HIGH (MEDIUM is Flash-only).
 *     See MODEL_QUIRKS['gemini-3.1-pro'] in server/lib/ai/model-registry.js.
 *   • Thread history is stored as JSON files in .gemini-threads/ (gitignored).
 *     Multi-turn is implemented by stringifying prior turns into the user message
 *     rather than using the SDK's native contents[] array, so the full conversation
 *     is visible in a single prompt — simpler to debug, and Gemini's 1M context
 *     makes the overhead negligible.
 *
 * Usage:
 *   node scripts/ask-gemini.mjs "What's the current TomTom API rate limit?"
 *   node scripts/ask-gemini.mjs --file server/lib/ai/model-registry.js "List every role that uses Google Search"
 *   node scripts/ask-gemini.mjs --thread refactor-auth "What do you think of this approach?"
 *   node scripts/ask-gemini.mjs --no-search --no-diff --think low "Quick classification: is this a bug report or feature request?"
 *   node scripts/ask-gemini.mjs --list
 *   node scripts/ask-gemini.mjs --show refactor-auth
 *   node scripts/ask-gemini.mjs --reset refactor-auth
 *
 * Defaults:
 *   --model gemini-3.1-pro-preview
 *   --think high           (Pro supports low|high only)
 *   --max-tokens 8192
 *   Google Search: ENABLED  (disable with --no-search)
 *   Git diff: auto-attached on first turn if repo is dirty (disable with --no-diff)
 *
 * Exit codes:
 *   0 = success
 *   1 = Gemini returned an error or empty response
 *   2 = bad CLI arguments
 *   3 = I/O error (file read, thread persist)
 */

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

// ---------- Constants ----------

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const THREADS_DIR = path.join(REPO_ROOT, '.gemini-threads');

const DEFAULT_MODEL = 'gemini-3.1-pro-preview';
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_THINK = 'high';
const VALID_PRO_THINK = ['low', 'high'];
const VALID_FLASH_THINK = ['low', 'medium', 'high'];

// Image support (2026-04-08): map common screenshot extensions to MIME types
// that Gemini's inline data API accepts.
const IMAGE_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};
// Gemini inline data request limit is ~20MB total. We cap single images at 15MB
// to leave headroom for the text prompt + other attachments. Warn at 5MB because
// anything larger is usually an un-downsampled raw screenshot and should be
// shrunk for cost/latency reasons.
const IMAGE_WARN_BYTES = 5 * 1024 * 1024;
const IMAGE_HARD_LIMIT_BYTES = 15 * 1024 * 1024;

const DEFAULT_SYSTEM = `You are Gemini 3.1 Pro, acting as a peer engineer collaborating with Claude Code (the agent sending you this prompt). Claude Code is actively editing a repository and delegates tasks to you when it needs:
  • Live web knowledge (you have Google Search)
  • Large-context analysis (you have 1M input tokens)
  • A second opinion on tricky code, architecture, or design decisions
  • Multimodal analysis

Claude Code is technically capable — don't over-explain fundamentals. Be direct and precise. When you use Google Search, mention which facts came from the web so Claude can decide what to trust. If the task is ambiguous, ask ONE concise clarifying question rather than guessing. If you're uncertain about something, say so explicitly — false confidence wastes Claude's time more than an honest "I don't know".`;

// ---------- CLI parsing ----------

function printHelpAndExit(code = 0) {
  console.log(`ask-gemini.mjs — Claude Code ↔ Gemini 3.1 Pro bridge

USAGE
  node scripts/ask-gemini.mjs [options] "<prompt>"

PROMPT SOURCES
  <positional>            The task / question (required unless using a meta command)
  --file <path>           Attach a file as text context. Repeatable.
  --image <path>          Attach an image (screenshot) for vision analysis. Repeatable.
                          Supports: .png .jpg .jpeg .webp .gif .heic .heif
                          Max 15MB per image; warns above 5MB.
                          Note: in thread mode, an image is visible to Gemini ONLY
                          on the turn it's attached — re-attach on follow-up turns
                          if you need Gemini to re-examine it.
  --diff <ref>            Attach 'git diff <ref>' as context (default: HEAD)
  --no-diff               Skip auto-attach of 'git diff HEAD' (default: on, first turn only)

MODEL
  --model <id>            Default: ${DEFAULT_MODEL}
                          Alternatives: gemini-3-flash-preview (cheap+fast)
  --think <low|med|high>  Thinking level. Pro supports low|high only. Default: ${DEFAULT_THINK}
  --max-tokens <n>        Default: ${DEFAULT_MAX_TOKENS}
  --no-search             Disable Google Search grounding (default: enabled)
  --json                  Return raw JSON — don't strip code fences or wrappers
  --system <text>         Override the default system prompt

THREADS
  --thread <name>         Use/create a conversation thread. Omit for one-shot mode.
  --list                  List existing threads and exit
  --show <name>           Print a thread's history and exit
  --reset <name>          Delete a thread and exit

OTHER
  -h, --help              Show this help and exit

EXAMPLES
  node scripts/ask-gemini.mjs "What's the current TomTom API rate limit?"
  node scripts/ask-gemini.mjs --file briefing-service.js "Summarize the data flow"
  node scripts/ask-gemini.mjs --thread refactor-auth "What's wrong with this approach?"
  node scripts/ask-gemini.mjs --no-search --think low "Classify: bug or feature?"
  node scripts/ask-gemini.mjs --image ~/Desktop/dashboard.png \\
    "What's visually wrong with this dashboard layout?"
  node scripts/ask-gemini.mjs --image before.png --image after.png \\
    "Compare these two screenshots and list the differences"

ENVIRONMENT
  GEMINI_API_KEY          Required.
`);
  process.exit(code);
}

function parseCli() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        model: { type: 'string' },
        think: { type: 'string' },
        'max-tokens': { type: 'string' },
        'no-search': { type: 'boolean' },
        'no-diff': { type: 'boolean' },
        diff: { type: 'string' },
        file: { type: 'string', multiple: true },
        image: { type: 'string', multiple: true },
        system: { type: 'string' },
        json: { type: 'boolean' },
        thread: { type: 'string' },
        list: { type: 'boolean' },
        show: { type: 'string' },
        reset: { type: 'string' },
      },
    });
  } catch (err) {
    console.error(`❌ Bad arguments: ${err.message}\n`);
    printHelpAndExit(2);
  }

  const { values, positionals } = parsed;
  if (values.help) printHelpAndExit(0);

  return {
    meta: {
      list: !!values.list,
      show: values.show || null,
      reset: values.reset || null,
    },
    prompt: positionals.join(' ').trim(),
    model: values.model || DEFAULT_MODEL,
    think: (values.think || DEFAULT_THINK).toLowerCase(),
    maxTokens: parseInt(values['max-tokens'] || String(DEFAULT_MAX_TOKENS), 10),
    useSearch: !values['no-search'],
    includeDiff: !values['no-diff'],
    diffRef: values.diff || 'HEAD',
    files: values.file || [],
    images: values.image || [],
    system: values.system || DEFAULT_SYSTEM,
    skipJsonCleanup: !!values.json,
    thread: values.thread || null,
  };
}

// ---------- Thread persistence ----------

async function ensureThreadsDir() {
  if (!existsSync(THREADS_DIR)) {
    await mkdir(THREADS_DIR, { recursive: true });
  }
}

function threadPath(name) {
  // Sanitize thread name to prevent path traversal — only allow safe chars
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    throw new Error(`Invalid thread name "${name}". Use only letters, digits, dot, underscore, hyphen.`);
  }
  return path.join(THREADS_DIR, `${name}.json`);
}

async function loadThread(name) {
  const file = threadPath(name);
  if (!existsSync(file)) return null;
  const raw = await readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function saveThread(thread) {
  await ensureThreadsDir();
  const file = threadPath(thread.name);
  thread.updated = new Date().toISOString();
  await writeFile(file, JSON.stringify(thread, null, 2) + '\n', 'utf8');
}

async function listThreads() {
  if (!existsSync(THREADS_DIR)) {
    console.log('(no threads yet — create one with --thread <name>)');
    return;
  }
  const entries = await readdir(THREADS_DIR);
  const jsonFiles = entries.filter((f) => f.endsWith('.json'));
  if (jsonFiles.length === 0) {
    console.log('(no threads yet — create one with --thread <name>)');
    return;
  }
  const rows = [];
  for (const f of jsonFiles) {
    try {
      const full = path.join(THREADS_DIR, f);
      const raw = await readFile(full, 'utf8');
      const t = JSON.parse(raw);
      const st = await stat(full);
      rows.push({
        name: t.name || f.replace(/\.json$/, ''),
        turns: Array.isArray(t.turns) ? t.turns.length : 0,
        model: t.model || '?',
        updated: t.updated || st.mtime.toISOString(),
      });
    } catch (err) {
      rows.push({ name: f, turns: '?', model: '?', updated: `ERROR: ${err.message}` });
    }
  }
  rows.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  console.log('Gemini conversation threads:\n');
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(28)}  ${String(r.turns).padStart(3)} turns  ${r.model.padEnd(24)}  ${r.updated}`);
  }
}

async function showThread(name) {
  const thread = await loadThread(name);
  if (!thread) {
    console.error(`❌ Thread "${name}" not found.`);
    process.exit(3);
  }
  console.log(`\n━━ Thread: ${thread.name} ━━`);
  console.log(`Model:   ${thread.model}`);
  console.log(`Created: ${thread.created}`);
  console.log(`Updated: ${thread.updated}`);
  console.log(`Turns:   ${thread.turns.length}\n`);
  for (let i = 0; i < thread.turns.length; i++) {
    const t = thread.turns[i];
    console.log(`── [${i + 1}] ${t.role.toUpperCase()} ──`);
    console.log(t.content);
    console.log();
  }
}

async function resetThread(name) {
  const file = threadPath(name);
  if (!existsSync(file)) {
    console.error(`❌ Thread "${name}" not found.`);
    process.exit(3);
  }
  await unlink(file);
  console.log(`✅ Deleted thread "${name}".`);
}

// ---------- Context assembly ----------

function safeGitDiff(ref) {
  try {
    // Limit to ~200KB of diff to avoid flooding Gemini's context on huge WIP branches
    const out = execSync(`git diff ${ref}`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    if (!out.trim()) return null;
    if (out.length > 200_000) {
      return out.slice(0, 200_000) + '\n\n[... truncated: diff exceeded 200KB ...]';
    }
    return out;
  } catch (err) {
    // Not a git repo, or bad ref — return null rather than blowing up
    console.error(`⚠️  git diff ${ref} failed (${err.message.split('\n')[0]}); continuing without diff`);
    return null;
  }
}

async function readFileContext(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    return content;
  } catch (err) {
    console.error(`❌ Cannot read --file ${filePath}: ${err.message}`);
    process.exit(3);
  }
}

/**
 * Load an image file as { mimeType, data: base64, bytes, filename } for Gemini's
 * inlineData parts. Enforces the 15MB hard cap and warns at 5MB. Rejects file
 * extensions we don't recognize — catching typos early beats a confusing API error.
 */
async function loadImage(imagePath) {
  let buffer;
  try {
    buffer = await readFile(imagePath);
  } catch (err) {
    console.error(`❌ Cannot read --image ${imagePath}: ${err.message}`);
    process.exit(3);
  }
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES[ext];
  if (!mimeType) {
    console.error(`❌ Unsupported image extension "${ext}" for ${imagePath}.`);
    console.error(`   Supported: ${Object.keys(IMAGE_MIME_TYPES).join(', ')}`);
    process.exit(3);
  }
  if (buffer.length > IMAGE_HARD_LIMIT_BYTES) {
    const mb = (buffer.length / 1024 / 1024).toFixed(1);
    console.error(`❌ Image ${imagePath} is ${mb}MB — exceeds 15MB limit for Gemini inline data.`);
    console.error(`   Resize/compress it (e.g., pngquant, sips, or macOS Preview export) and retry.`);
    process.exit(3);
  }
  if (buffer.length > IMAGE_WARN_BYTES) {
    const mb = (buffer.length / 1024 / 1024).toFixed(1);
    console.error(`⚠️  Image ${imagePath} is ${mb}MB — consider downscaling for faster responses.`);
  }
  return {
    filename: path.basename(imagePath),
    mimeType,
    data: buffer.toString('base64'),
    bytes: buffer.length,
  };
}

function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

async function assembleUserMessage(opts, thread, loadedImages) {
  const isFirstTurn = !thread || thread.turns.length === 0;
  const parts = [];

  // Prior turns (from thread history)
  if (thread && thread.turns.length > 0) {
    parts.push('=== Conversation so far ===\n');
    for (let i = 0; i < thread.turns.length; i++) {
      const t = thread.turns[i];
      parts.push(`── [Turn ${i + 1} · ${t.role}] ──\n${t.content}\n`);
    }
    parts.push('=== End of history ===\n');
  }

  // Attached files
  for (const f of opts.files) {
    const content = await readFileContext(f);
    parts.push(`=== File: ${f} (${content.length} chars) ===\n${content}\n=== End file ===\n`);
  }

  // Attached images: we don't embed the bytes in the text (those go in parts[] as
  // inlineData), but we DO tell Gemini what's attached so it knows to look at the
  // image inputs as part of the current task.
  if (loadedImages.length > 0) {
    const descriptions = loadedImages
      .map((img, idx) => `  [${idx + 1}] ${img.filename} (${img.mimeType}, ${formatBytes(img.bytes)})`)
      .join('\n');
    parts.push(`=== Attached images (visible only for this turn) ===\n${descriptions}\n=== End images ===\n`);
  }

  // Auto git diff (only on first turn of a thread, or always in one-shot mode)
  if (opts.includeDiff && isFirstTurn) {
    const diff = safeGitDiff(opts.diffRef);
    if (diff) {
      parts.push(`=== git diff ${opts.diffRef} (${diff.length} chars) ===\n${diff}\n=== End diff ===\n`);
    }
  }

  // The actual prompt goes last, clearly labeled
  parts.push(`=== Current task ===\n${opts.prompt}`);

  return parts.join('\n');
}

// ---------- Gemini call (direct SDK) ----------

function validateThinkLevel(model, think) {
  const levels = model.includes('flash') ? VALID_FLASH_THINK : VALID_PRO_THINK;
  if (!levels.includes(think)) {
    console.error(`⚠️  thinkingLevel "${think}" not valid for ${model}. Valid: ${levels.join('|')}. Using "high".`);
    return levels.includes('high') ? 'high' : levels[levels.length - 1];
  }
  return think;
}

async function callGeminiDirect({ model, system, user, maxTokens, think, useSearch, skipJsonCleanup, images = [] }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY is not set in environment.');
    process.exit(1);
  }

  // SDK conflict workaround: @google/genai prefers GOOGLE_API_KEY over the passed key
  const stash = process.env.GOOGLE_API_KEY;
  if (stash) delete process.env.GOOGLE_API_KEY;
  const ai = new GoogleGenAI({ apiKey });
  if (stash) process.env.GOOGLE_API_KEY = stash;

  const thinkLevel = validateThinkLevel(model, think);

  const config = {
    maxOutputTokens: maxTokens,
    temperature: 0.5,
    systemInstruction: system,
    thinkingConfig: { thinkingLevel: thinkLevel },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
    ],
  };

  if (useSearch) {
    config.tools = [{ googleSearch: {} }];
  }

  // Build the parts array: text first, then any images as inlineData. Gemini
  // reads them in order; text-then-image is the pattern the in-repo adapter uses
  // at gemini-adapter.js:137 and works reliably.
  const messageParts = [{ text: user }];
  for (const img of images) {
    messageParts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.data,
      },
    });
  }
  const contents = [{ role: 'user', parts: messageParts }];

  const startedAt = Date.now();
  let result;
  try {
    result = await ai.models.generateContent({ model, contents, config });
  } catch (err) {
    console.error(`❌ Gemini API call failed: ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(0, 3).join('\n'));
    process.exit(1);
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  let text = (result?.text || result?.response?.text?.() || '').trim();
  if (!text) {
    console.error('❌ Gemini returned an empty response.');
    // Dump any available metadata to help diagnose
    try {
      console.error('Debug: candidates=', JSON.stringify(result?.candidates || [], null, 2).slice(0, 1000));
    } catch { /* ignore */ }
    process.exit(1);
  }

  // Strip wrapping markdown code fences — same rule as the adapter
  if (!skipJsonCleanup) {
    const fenceMatch = text.match(/^\s*```(?:\w+)?\s*([\s\S]*?)\s*```\s*$/);
    if (fenceMatch) text = fenceMatch[1].trim();
  }

  return { text, elapsed, model };
}

// ---------- Main ----------

async function main() {
  const opts = parseCli();

  // Meta commands (don't call Gemini)
  if (opts.meta.list) { await listThreads(); return; }
  if (opts.meta.show) { await showThread(opts.meta.show); return; }
  if (opts.meta.reset) { await resetThread(opts.meta.reset); return; }

  if (!opts.prompt) {
    console.error('❌ No prompt given. Pass a prompt as the last argument, or use --help.');
    process.exit(2);
  }

  // Load thread if continuing one
  let thread = null;
  if (opts.thread) {
    thread = await loadThread(opts.thread);
    if (!thread) {
      thread = {
        name: opts.thread,
        created: new Date().toISOString(),
        updated: null,
        model: opts.model,
        turns: [],
      };
    }
  }

  // Load images first so any I/O or size errors fail fast, before we pay for
  // Gemini tokens on an assembly that was going to be rejected anyway.
  const loadedImages = [];
  for (const imgPath of opts.images) {
    loadedImages.push(await loadImage(imgPath));
  }

  const userMessage = await assembleUserMessage(opts, thread, loadedImages);

  // Log to stderr so stdout stays clean for Gemini's reply (pipe-friendly)
  const imageSuffix = loadedImages.length > 0 ? ` · images=${loadedImages.length}` : '';
  console.error(`\n🤖 Calling ${opts.model} · think=${opts.think} · search=${opts.useSearch ? 'on' : 'off'}${opts.thread ? ` · thread=${opts.thread}` : ''}${imageSuffix}`);
  console.error(`   prompt=${userMessage.length} chars · max_tokens=${opts.maxTokens}`);
  if (loadedImages.length > 0) {
    for (const img of loadedImages) {
      console.error(`   🖼️  ${img.filename} (${img.mimeType}, ${formatBytes(img.bytes)})`);
    }
  }

  const { text, elapsed } = await callGeminiDirect({
    model: opts.model,
    system: opts.system,
    user: userMessage,
    maxTokens: opts.maxTokens,
    think: opts.think,
    useSearch: opts.useSearch,
    skipJsonCleanup: opts.skipJsonCleanup,
    images: loadedImages,
  });

  console.error(`   ✓ ${text.length} chars in ${elapsed}s\n`);

  // Persist thread turn. For the user turn we record the prompt plus a note
  // about any attached images (names + sizes only — no base64 bytes). Gemini
  // can't re-see the images on follow-up turns, but the note keeps prose
  // continuity readable when you --show the thread later.
  if (opts.thread && thread) {
    const imageNote = loadedImages.length > 0
      ? '\n\n[attached images this turn: ' + loadedImages.map((i) => `${i.filename} (${formatBytes(i.bytes)})`).join(', ') + ']'
      : '';
    thread.turns.push({ role: 'user', content: opts.prompt + imageNote });
    thread.turns.push({ role: 'gemini', content: text });
    await saveThread(thread);
    console.error(`   💾 Saved to .gemini-threads/${opts.thread}.json (${thread.turns.length} turns total)\n`);
  }

  // Reply to stdout — clean so I can pipe it or read it directly
  process.stdout.write(text + '\n');
}

main().catch((err) => {
  console.error(`❌ Unhandled error: ${err.stack || err.message}`);
  process.exit(1);
});
