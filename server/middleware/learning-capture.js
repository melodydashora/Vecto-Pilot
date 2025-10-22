// server/middleware/learning-capture.js
// Middleware to capture ML training data for every significant interaction
import crypto from 'crypto';

// Learning event types
const LEARNING_EVENTS = {
  SNAPSHOT_CREATED: 'snapshot_created',
  STRATEGY_GENERATED: 'strategy_generated',
  RANKING_CREATED: 'ranking_created',
  VENUE_FEEDBACK: 'venue_feedback',
  STRATEGY_FEEDBACK: 'strategy_feedback',
  USER_ACTION: 'user_action',
  ERROR_ENCOUNTERED: 'error_encountered'
};

/**
 * Capture learning context for ML pipeline
 * @param {string} eventType - Type of learning event
 * @param {object} data - Event data to capture
 * @param {string|null} userId - User ID if available
 */
export async function capturelearning(eventType, data, userId = null) {
  const timestamp = new Date().toISOString();
  const eventId = crypto.randomUUID();
  
  const learningEvent = {
    event_id: eventId,
    event_type: eventType,
    timestamp,
    user_id: userId,
    data,
    captured_at: timestamp
  };

  try {
    // TODO: Store in assistant_memory when rememberContext is available
    // For now, just log the event
    console.log(`[learning] Captured: ${eventType}`, {
      event_id: eventId,
      user_id: userId || 'anonymous',
      data_keys: Object.keys(data)
    });
    
    return eventId;
  } catch (err) {
    console.error('[learning] Failed to capture event:', err.message);
    // Don't throw - learning capture failure shouldn't break the request
    return null;
  }
}

/**
 * Express middleware to auto-capture successful responses
 */
export function learningMiddleware(eventType) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    
    res.json = function(body) {
      // Only capture successful responses
      if (res.statusCode >= 200 && res.statusCode < 300 && body?.ok !== false) {
        const userId = req.headers['x-user-id'] || req.body?.userId || null;
        
        // Capture async (don't block response)
        setImmediate(() => {
          capturelearning(eventType, {
            path: req.path,
            method: req.method,
            status: res.statusCode,
            response_keys: Object.keys(body),
            request_id: res.get('x-req-id') || res.get('x-correlation-id')
          }, userId).catch(err => {
            console.error('[learning] Middleware capture failed:', err.message);
          });
        });
      }
      
      return originalJson(body);
    };
    
    next();
  };
}

/**
 * Capture error for learning (what went wrong and why)
 */
export async function captureError(error, context = {}, userId = null) {
  return capturelearning(LEARNING_EVENTS.ERROR_ENCOUNTERED, {
    error_message: error.message,
    error_code: error.code,
    error_stack: error.stack?.split('\n').slice(0, 5).join('\n'), // First 5 lines
    context
  }, userId);
}

export { LEARNING_EVENTS };
