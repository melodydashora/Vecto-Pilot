// server/lib/utils/sanitize.js
// 2026-04-05: Shared input sanitization for CodeQL type-confusion fixes.
// Express qs parser allows ?param[]=a&param[]=b (arrays) and ?param[k]=v (objects).
// These helpers ensure req.query/req.body values are the expected scalar types.

/**
 * Coerce a value to a string. If it's an array, take the first element.
 * If it's an object, convert to string. Returns undefined for nullish input.
 * @param {*} val - Value from req.query or req.body
 * @returns {string|undefined}
 */
export function sanitizeString(val) {
  if (val == null) return undefined;
  if (Array.isArray(val)) return sanitizeString(val[0]);
  if (typeof val === 'object') return String(val);
  return String(val);
}

/**
 * Coerce a value to a number. Returns NaN for unparseable input, undefined for nullish.
 * @param {*} val - Value from req.query or req.body
 * @returns {number|undefined}
 */
export function sanitizeNumber(val) {
  if (val == null) return undefined;
  const str = sanitizeString(val);
  if (str === undefined) return undefined;
  const num = Number(str);
  return num;
}

/**
 * Coerce a value to a boolean. Treats 'true', '1', 'yes' as true.
 * @param {*} val - Value from req.query or req.body
 * @returns {boolean}
 */
export function sanitizeBoolean(val) {
  if (val == null) return false;
  if (typeof val === 'boolean') return val;
  const str = sanitizeString(val);
  return str === 'true' || str === '1' || str === 'yes';
}

/**
 * Validate that a value is a valid IPv4 or IPv6 address.
 * Returns the validated IP string or null if invalid.
 * @param {string} val - Candidate IP string
 * @returns {string|null}
 */
export function sanitizeIp(val) {
  if (val == null) return null;
  const str = sanitizeString(val);
  if (!str) return null;
  // IPv4: 1-3 digits per octet, 4 octets
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(str)) {
    const octets = str.split('.').map(Number);
    if (octets.every(o => o >= 0 && o <= 255)) return str;
  }
  // IPv6: hex groups separated by colons (including :: shorthand)
  if (/^[0-9a-fA-F:]+$/.test(str) && str.includes(':')) {
    return str;
  }
  return null;
}

/**
 * Sanitize a string for safe inclusion in log messages.
 * Truncates long values and strips control characters.
 * @param {*} val - Value to sanitize for logging
 * @param {number} [maxLen=100] - Maximum length
 * @returns {string}
 */
export function sanitizeForLog(val) {
  if (val == null) return '(null)';
  let str = sanitizeString(val) || '(empty)';
  // Strip control characters (except space)
  str = str.replace(/[\x00-\x1f\x7f]/g, '');
  // Escape % to prevent console.warn/log format string interpretation (%s, %d, %j)
  str = str.replace(/%/g, '%%');
  if (str.length > 100) str = str.slice(0, 100) + '...';
  return str;
}
