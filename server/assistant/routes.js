
// server/assistant/routes.js
// Assistant server API routes

import express from "express";
import { getEnhancedProjectContext, performInternetSearch, analyzeWorkspaceDeep } from "./enhanced-context.js";
import { getAssistantThreadManager } from "./thread-context.js";
import { memoryPut, memoryQuery } from "../eidolon/memory/pg.js";

const router = express.Router();

// Enhanced context with thread awareness
router.get("/context", async (req, res) => {
  try {
    const { threadId, includeThreadContext = "true" } = req.query;
    const context = await getEnhancedProjectContext({
      threadId,
      includeThreadContext: includeThreadContext === "true"
    });
    res.json({ ok: true, context, identity: "assistant" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Thread management
router.post("/thread/init", async (req, res) => {
  try {
    const { userId = "assistant", sessionId = null } = req.body;
    const manager = getAssistantThreadManager();
    const threadId = await manager.initThread({ userId, sessionId });
    res.json({ ok: true, threadId, identity: "assistant" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/thread/:threadId/message", async (req, res) => {
  try {
    const { threadId } = req.params;
    const { role, content, modelProvider = null, metadata = {} } = req.body;
    const manager = getAssistantThreadManager();
    manager.currentThreadId = threadId;
    const message = await manager.addMessage({ role, content, modelProvider, metadata });
    res.json({ ok: true, message, identity: "assistant" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Internet search
router.post("/search", async (req, res) => {
  try {
    const { query, userId = "assistant" } = req.body;
    const result = await performInternetSearch(query, userId);
    res.json({ ...result, identity: "assistant" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Workspace analysis
router.get("/analyze", async (req, res) => {
  try {
    const analysis = await analyzeWorkspaceDeep();
    res.json({ ok: true, analysis, identity: "assistant" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Memory operations
router.post("/memory", async (req, res) => {
  try {
    const { scope, key, content, ttlDays = 90 } = req.body;
    await memoryPut({
      table: "assistant_memory",
      scope,
      key,
      userId: "assistant",
      content,
      ttlDays
    });
    res.json({ ok: true, identity: "assistant" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/memory/:scope", async (req, res) => {
  try {
    const { scope } = req.params;
    const { limit = 50 } = req.query;
    const results = await memoryQuery({
      table: "assistant_memory",
      scope,
      userId: "assistant",
      limit: parseInt(limit)
    });
    res.json({ ok: true, results, identity: "assistant" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
