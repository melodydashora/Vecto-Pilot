#!/usr/bin/env node
// scripts/check-model-pins.mjs — verify every model pinned in server/lib/ai/model-registry.js
// against the LIVE provider model lists. Exit 1 if any pin is not served.
//
// WHY (2026-09-15, Melody's decision): model names live only in the registry. A name
// remembered from training data or an old doc is not a fact — the provider's /models
// endpoint is. Run this BEFORE editing a pin, and again after. Wired into `npm run guard`.
//
// Usage: node scripts/check-model-pins.mjs            # all providers with a key present
//        node scripts/check-model-pins.mjs --strict   # a missing provider key is also a failure
//
// Keys are read from the environment (GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY)
// and are never printed.

import { MODEL_ROLES, getProviderForModel } from '../server/lib/ai/model-registry.js';

const strict = process.argv.includes('--strict');
const TIMEOUT_MS = 30_000;

async function fetchJson(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const PROVIDERS = {
  google: {
    keyName: 'GEMINI_API_KEY',
    async list(key) {
      const ids = new Set();
      let pageToken = '';
      do {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}&key=${key}`;
        const data = await fetchJson(url);
        for (const m of data.models || []) ids.add(String(m.name).replace(/^models\//, ''));
        pageToken = data.nextPageToken || '';
      } while (pageToken);
      return ids;
    },
  },
  openai: {
    keyName: 'OPENAI_API_KEY',
    async list(key) {
      const data = await fetchJson('https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` });
      return new Set((data.data || []).map(m => m.id));
    },
  },
  anthropic: {
    keyName: 'ANTHROPIC_API_KEY',
    async list(key) {
      const data = await fetchJson('https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
      return new Set((data.data || []).map(m => m.id));
    },
  },
};

// Group pins by provider
const byProvider = new Map();
for (const [role, cfg] of Object.entries(MODEL_ROLES)) {
  const provider = getProviderForModel(cfg.model);
  if (!byProvider.has(provider)) byProvider.set(provider, []);
  byProvider.get(provider).push({ role, model: cfg.model });
}

let failures = 0;
let skipped = 0;
for (const [provider, pins] of byProvider) {
  const spec = PROVIDERS[provider];
  if (!spec) {
    console.error(`FAIL  unknown provider '${provider}' for: ${pins.map(p => `${p.role}=${p.model}`).join(', ')}`);
    failures += pins.length;
    continue;
  }
  const key = process.env[spec.keyName];
  if (!key) {
    const msg = `${spec.keyName} not set — ${pins.length} ${provider} pin(s) NOT verified`;
    if (strict) { console.error(`FAIL  ${msg}`); failures += pins.length; } else { console.warn(`SKIP  ${msg}`); skipped += pins.length; }
    continue;
  }
  let served;
  try {
    served = await spec.list(key);
  } catch (err) {
    console.error(`FAIL  ${provider}: could not list models (${err.message})`);
    failures += pins.length;
    continue;
  }
  for (const { role, model } of pins) {
    if (served.has(model)) console.log(`ok    ${role.padEnd(26)} ${model}`);
    else { console.error(`FAIL  ${role.padEnd(26)} ${model}  — not served by ${provider} (${served.size} models listed)`); failures += 1; }
  }
}

const total = Object.keys(MODEL_ROLES).length;
console.log(`\n${total - failures - skipped} verified, ${skipped} skipped, ${failures} failed of ${total} pins`);
process.exit(failures ? 1 : 0);
