// server/api/utils/safeElapsedMs.js
/**
 * Safely calculate elapsed milliseconds between two timestamps
 * Returns 0 if timestamps are invalid
 */
export function safeElapsedMs(startTime, endTime) {
  try {
    const start = startTime ? new Date(startTime).getTime() : null;
    const end = endTime ? new Date(endTime).getTime() : null;
    
    if (!start || !end || isNaN(start) || isNaN(end)) {
      return 0;
    }
    
    const elapsed = end - start;
    return elapsed >= 0 ? elapsed : 0;
  } catch {
    return 0;
  }
}
