// server/api/feedback/index.js - Barrel exports for feedback routes
// Feedback endpoints: user feedback and action logging

export { default as feedbackRouter } from './feedback.js';
export { default as actionsRouter } from './actions.js';

// Route summary:
// POST /api/feedback/venue - Venue feedback
// POST /api/feedback/strategy - Strategy feedback
// POST /api/feedback/app - App feedback
// POST /api/actions - Log user actions
