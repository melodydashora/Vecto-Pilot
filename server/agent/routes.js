// server/agent/routes.js
// Agent server API routes with enhanced thread awareness

import express from "express";
import { getEnhancedProjectContext, performInternetSearch, analyzeWorkspaceDeep } from "./enhanced-context.js";
import { getThreadManager, getThreadAwareContext } from "./thread-context.js";
import { listConfigFiles, readConfigFile, updateEnvFile, createBackup } from "./config-manager.js";
import { memoryPut, memoryGet, memoryQuery } from "../eidolon/memory/pg.js";
import { storeCrossThreadMemory, getCrossThreadMemory, storeAgentMemory, getAgentMemory } from "./enhanced-context.js";

const router = express.Router();

// Thread-aware context endpoints
router.get("/context", async (req, res) => {
  try {
    const { threadId, includeThreadContext = "true" } = req.query;
    const context = await getEnhancedProjectContext({
      threadId,
      includeThreadContext: includeThreadContext === "true"
    });
    res.json({ ok: true, context });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/context/summary", async (req, res) => {
  try {
    const analysis = await analyzeWorkspaceDeep();
    res.json({ ok: true, summary: analysis });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Thread management endpoints (NEW)
router.post("/thread/init", async (req, res) => {
  try {
    const { userId = "system", sessionId = null, parentThreadId = null } = req.body;
    const manager = getThreadManager();
    const threadId = await manager.initThread({ userId, sessionId, parentThreadId });

    res.json({ 
      ok: true, 
      threadId,
      message: "Thread initialized successfully"
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/thread/:threadId", async (req, res) => {
  try {
    const { threadId } = req.params;
    const manager = getThreadManager();
    const threadContext = await manager.getThreadContext(threadId);

    if (!threadContext) {
      return res.status(404).json({ ok: false, error: "Thread not found" });
    }

    res.json({ ok: true, thread: threadContext });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/thread/:threadId/message", async (req, res) => {
  try {
    const { threadId } = req.params;
    const { role, content, modelProvider = null, metadata = {} } = req.body;

    const manager = getThreadManager();
    await manager.resumeThread(threadId);

    const message = await manager.addMessage({ 
      role, 
      content, 
      modelProvider, 
      metadata 
    });

    res.json({ 
      ok: true, 
      message,
      threadId 
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/thread/:threadId/decision", async (req, res) => {
  try {
    const { threadId } = req.params;
    const { decision, reasoning, impact, relatedTo = [] } = req.body;

    const manager = getThreadManager();
    await manager.resumeThread(threadId);

    const decisionRecord = await manager.trackDecision({ 
      decision, 
      reasoning, 
      impact, 
      relatedTo 
    });

    res.json({ 
      ok: true, 
      decision: decisionRecord,
      threadId 
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/threads/recent", async (req, res) => {
  try {
    const { userId = "system", limit = 10 } = req.query;
    const manager = getThreadManager();
    const threads = await manager.getRecentThreads(userId, parseInt(limit));

    res.json({ 
      ok: true, 
      threads,
      count: threads.length 
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Memory endpoints
router.post("/memory/preference", async (req, res) => {
  try {
    const { key, value, userId = "system" } = req.body;
    await memoryPut({
      table: "assistant_memory",
      scope: "user_preferences",
      key,
      userId,
      content: value,
      ttlDays: 365,
    });
    res.json({ ok: true, key, message: "Preference saved" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/memory/session", async (req, res) => {
  try {
    const { key, data, userId = "system" } = req.body;
    await memoryPut({
      table: "eidolon_memory",
      scope: "session_state",
      key,
      userId,
      content: data,
      ttlDays: 7,
    });
    res.json({ ok: true, key, message: "Session state saved" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/memory/project", async (req, res) => {
  try {
    const { key, data, userId = "system" } = req.body;
    await memoryPut({
      table: "eidolon_memory",
      scope: "project_state",
      key,
      userId,
      content: data,
      ttlDays: 30,
    });
    res.json({ ok: true, key, message: "Project state saved" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/memory/conversation", async (req, res) => {
  try {
    const { topic, summary, userId = "system" } = req.body;
    await memoryPut({
      table: "assistant_memory",
      scope: "conversations",
      key: `conv_${Date.now()}`,
      userId,
      content: { topic, summary, timestamp: new Date().toISOString() },
      ttlDays: 30,
    });
    res.json({ ok: true, message: "Conversation logged" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/memory/conversations", async (req, res) => {
  try {
    const { userId = "system", limit = 30 } = req.query;
    const convs = await memoryQuery({
      table: "assistant_memory",
      scope: "conversations",
      userId,
      limit: parseInt(limit),
    });
    res.json({ ok: true, conversations: convs.map(c => c.content) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Internet search
router.post("/search", async (req, res) => {
  try {
    const { query, userId = "system" } = req.body;
    const result = await performInternetSearch(query, userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Config management
router.get("/config/list", async (req, res) => {
  try {
    const files = await listConfigFiles();
    res.json({ ok: true, files });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/config/read/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const result = await readConfigFile(filename);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/config/env/update", async (req, res) => {
  try {
    const { updates } = req.body;
    const result = await updateEnvFile(updates);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/config/backup/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const result = await createBackup(filename);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;