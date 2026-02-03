
// server/util/uuid.js
// Shared UUID validation utility for consistent user_id handling

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates if a string is a valid UUID v4 format
 * @param {string} value - Value to validate
 * @returns {boolean} True if valid UUID, false otherwise
 */
export function isValidUUID(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * Returns a valid UUID or null
 * @param {any} value - Value to validate and normalize
 * @returns {string|null} Valid UUID string or null
 */
export function uuidOrNull(value) {
  return isValidUUID(value) ? value : null;
}

/**
 * Validates and throws error if invalid UUID
 * @param {any} value - Value to validate
 * @param {string} fieldName - Name of field for error message
 * @returns {string} Valid UUID string
 * @throws {Error} If invalid UUID format
 */
export function requireUUID(value, fieldName = 'value') {
  if (!isValidUUID(value)) {
    throw new Error(`Invalid UUID format for ${fieldName}: ${value}`);
  }
  return value;
}
