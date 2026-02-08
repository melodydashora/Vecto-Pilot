/**
 * Error Classifier for LLM Router
 * Classifies errors to determine retry/fallback behavior
 */

export const ErrorType = {
  ABORTED: 'ABORTED',       // Request was intentionally aborted (hedged race loser)
  TIMEOUT: 'TIMEOUT',       // Request exceeded timeout threshold
  THROTTLED: 'THROTTLED',   // Rate limited by provider
  SERVER: 'SERVER',         // Provider server error (5xx)
  CLIENT: 'CLIENT',         // Client error (4xx) - likely invalid request
  NETWORK: 'NETWORK',       // Network connectivity issue
  UNKNOWN: 'UNKNOWN'        // Unclassified error
};

// Only provider errors should trigger circuit breaker
export const CIRCUIT_BREAKER_ERRORS = [
  ErrorType.THROTTLED,
  ErrorType.SERVER
];

/**
 * Classify an error to determine handling strategy
 * @param {Error} error - The error to classify
 * @returns {{ type: string, shouldRetry: boolean, affectsCircuit: boolean }}
 */
export function classifyError(error) {
  const message = error?.message?.toLowerCase() || '';
  const name = error?.name?.toLowerCase() || '';
  const code = error?.code?.toLowerCase() || '';
  const status = error?.status || error?.statusCode || 0;

  // Aborted requests (hedged race losers)
  if (name === 'aborterror' ||
      message.includes('aborted') ||
      code === 'abort_err' ||
      error?.name === 'AbortError') {
    return {
      type: ErrorType.ABORTED,
      shouldRetry: false,
      affectsCircuit: false
    };
  }

  // Timeout errors
  if (message.includes('timeout') ||
      code === 'etimedout' ||
      code === 'esockettimedout' ||
      name.includes('timeout')) {
    return {
      type: ErrorType.TIMEOUT,
      shouldRetry: true,
      affectsCircuit: true
    };
  }

  // Rate limiting (429)
  if (status === 429 ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('quota exceeded')) {
    return {
      type: ErrorType.THROTTLED,
      shouldRetry: false,
      affectsCircuit: true
    };
  }

  // Server errors (5xx)
  if (status >= 500 && status < 600) {
    return {
      type: ErrorType.SERVER,
      shouldRetry: true,
      affectsCircuit: true
    };
  }

  // Client errors (4xx) - typically shouldn't retry
  if (status >= 400 && status < 500) {
    return {
      type: ErrorType.CLIENT,
      shouldRetry: false,
      affectsCircuit: false
    };
  }

  // Network errors
  if (code === 'econnrefused' ||
      code === 'econnreset' ||
      code === 'enotfound' ||
      message.includes('network') ||
      message.includes('connection')) {
    return {
      type: ErrorType.NETWORK,
      shouldRetry: true,
      affectsCircuit: true
    };
  }

  // Unknown error - be conservative
  return {
    type: ErrorType.UNKNOWN,
    shouldRetry: true,
    affectsCircuit: false
  };
}

/**
 * Check if error should affect circuit breaker state
 * @param {Error} error
 * @returns {boolean}
 */
export function shouldAffectCircuitBreaker(error) {
  const { affectsCircuit } = classifyError(error);
  return affectsCircuit;
}

/**
 * Check if error indicates a retriable condition
 * @param {Error} error
 * @returns {boolean}
 */
export function isRetriable(error) {
  const { shouldRetry } = classifyError(error);
  return shouldRetry;
}

export default {
  ErrorType,
  CIRCUIT_BREAKER_ERRORS,
  classifyError,
  shouldAffectCircuitBreaker,
  isRetriable
};
