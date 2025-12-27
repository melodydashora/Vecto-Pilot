// server/api/utils/index.js - Barrel exports for API utilities
// Shared utilities for API route handlers

export { httpError, httpSuccess, safeJsonParse } from './http-helpers.js';
export { safeElapsedMs } from './safeElapsedMs.js';

// Utility summary:
// httpError(res, status, code, message) - Standard error response
// httpSuccess(res, data) - Standard success response
// safeJsonParse(text) - Parse JSON with error handling
// safeElapsedMs(start) - Calculate elapsed time safely
