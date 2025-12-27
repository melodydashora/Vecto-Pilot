// server/middleware/validate.js
// Express middleware for request validation using Zod schemas
// Validates request body, query params, or route params

import { formatZodError } from '../validation/schemas.js';

/**
 * Validation middleware factory
 * @param {Object} schema - Zod schema to validate against
 * @param {String} source - Where to get data from: 'body', 'query', 'params'
 * @returns {Function} Express middleware
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = req[source];
    
    if (!data) {
      return res.status(400).json({
        error: 'validation_failed',
        message: `No ${source} data provided`,
        field_errors: []
      });
    }

    const result = schema.safeParse(data);

    if (!result.success) {
      const errorMessage = formatZodError(result.error);
      // Zod v4 uses 'issues', older versions used 'errors'
      const issues = result.error?.issues || result.error?.errors || [];
      
      console.warn(`[validation] ${req.method} ${req.path} failed:`, {
        source,
        issues
      });

      return res.status(400).json({
        error: 'validation_failed',
        message: errorMessage,
        field_errors: issues.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code
        }))
      });
    }

    // Replace original data with validated/transformed data
    req[source] = result.data;
    
    next();
  };
}

/**
 * Validate body data
 * @param {Object} schema - Zod schema
 */
export function validateBody(schema) {
  return validate(schema, 'body');
}

/**
 * Validate query parameters
 * @param {Object} schema - Zod schema
 */
export function validateQuery(schema) {
  return validate(schema, 'query');
}

/**
 * Validate route parameters
 * @param {Object} schema - Zod schema
 */
export function validateParams(schema) {
  return validate(schema, 'params');
}
