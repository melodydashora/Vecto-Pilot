// server/api/coach/index.js
// AI Coach API Routes - Schema awareness, validation, notes CRUD
// Created: 2026-01-05

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import schemaRouter from './schema.js';
import validateRouter from './validate.js';
import notesRouter from './notes.js';
import { db } from '../../db/drizzle.js';
import { coach_memos } from '../../../shared/schema.js';
import { createCoachMemoStore, createCoachMemosRouter } from './memos.js';

const router = Router();

// All coach routes require authentication
router.use(requireAuth);

// Mount sub-routers
router.use('/schema', schemaRouter);
router.use('/validate', validateRouter);
router.use('/notes', notesRouter);
router.use('/memos', createCoachMemosRouter(createCoachMemoStore(db, coach_memos)));

export default router;
