// server/lib/offers/normalize-offer-body.js — forgiving-but-deterministic
// field-name normalization for the analyze-offer hook.
//
// 2026-08-14: Shortcuts are hand-built by drivers — key names WILL arrive
// misspelled, re-cased, or abbreviated, and the server must still answer. This
// is a SAFETY NET, not a reason to stay quiet: when a specific shortcut is
// sending wrong keys, say so (Melody, 2026-08-17: "fix me first"). The July fix
// accepted exactly one typo ('lattitude', which silently nulled GPS for months);
// this generalizes it into an explicit alias table. Deterministic by construction:
// exact lookup only (case-insensitive), never fuzzy/distance matching — every
// accepted variant is enumerated below, and every remap is warn-logged so
// drift stays visible. Canonical keys always win over aliases.
//
// PURE module (no db/model imports) — jest-safe, same policy as ruleset-hash.

/** Canonical field -> accepted variants (matched case-insensitively). */
export const BODY_FIELD_ALIASES = {
  text: ['ocr_text', 'ocr'],
  image: ['screenshot', 'photo'],
  image_type: ['imagetype', 'mime_type', 'mimetype'],
  device_id: ['deviceid', 'device'],
  latitude: ['lattitude', 'lat'],
  longitude: ['longitude', 'longitud', 'lng', 'lon', 'long'],
  source: [],
  shortcut_token: ['shortcuttoken', 'token'],
  // 2026-08-26 (Melody 2026-08-24): the automation system that sent the payload —
  // diagnostics/provenance only (the 2026-08-24 "$750" forensics would have named the OCR
  // client instantly). NOT identity: X-Shortcut-Token remains the only identity bridge.
  shortcut_system: ['shortcutsystem', 'client', 'automation', 'client_app'],
};

/**
 * Normalize the self-reported client signature ("macrodroid/5.65", "http_shortcuts/3.x",
 * "tasker/6.6", "ios_shortcuts"). Lowercased, whitespace → single space, restricted to
 * [a-z0-9._/ -], capped at 40 chars. Anything empty/non-string → null (absent field is
 * simply null — old shortcuts keep working).
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeShortcutSystem(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9._/ -]/g, '').slice(0, 40).trim();
  return cleaned.length ? cleaned : null;
}

// variant (lowercased) -> canonical, built once.
const CANONICAL_BY_VARIANT = new Map();
for (const [canon, aliases] of Object.entries(BODY_FIELD_ALIASES)) {
  CANONICAL_BY_VARIANT.set(canon.toLowerCase(), canon);
  for (const alias of aliases) CANONICAL_BY_VARIANT.set(alias.toLowerCase(), canon);
}

/**
 * Normalize an analyze-offer request body's field names.
 * @param {object} body - req.body (JSON or multipart form fields)
 * @returns {{ body: object, remapped: string[] }} normalized copy + the list
 *   of remaps performed (['Lattitude→latitude', ...]) for the caller to log.
 */
export function normalizeOfferBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { body: {}, remapped: [] };
  }

  const out = {};
  const remapped = [];

  // Pass 1: canonical keys (exact, any case) and unknown keys copy through.
  // Canonical-exact wins over any alias for the same target.
  for (const [key, value] of Object.entries(body)) {
    const canon = CANONICAL_BY_VARIANT.get(key.toLowerCase());
    if (canon === undefined) {
      out[key] = value; // unknown key: preserved untouched
    } else if (canon.toLowerCase() === key.toLowerCase()) {
      out[canon] = value; // canonical (possibly re-cased, e.g. 'Latitude')
      if (canon !== key) remapped.push(`${key}→${canon}`);
    }
  }

  // Pass 2: aliases fill the canonical slot only when nothing exact claimed it.
  for (const [key, value] of Object.entries(body)) {
    const canon = CANONICAL_BY_VARIANT.get(key.toLowerCase());
    if (canon !== undefined && canon.toLowerCase() !== key.toLowerCase() && !(canon in out)) {
      out[canon] = value;
      remapped.push(`${key}→${canon}`);
    }
  }

  return { body: out, remapped };
}
