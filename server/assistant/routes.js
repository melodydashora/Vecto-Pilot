// server/assistant/routes.js
import express from "express";
import { getEnhancedProjectContext, performInternetSearch, analyzeWorkspaceDeep } from "./enhanced-context.js";
import { loadAssistantPolicy } from "./policy-loader.js";

const router = express.Router();

// Load policy for configuration only (not enforcement)
const policy = loadAssistantPolicy();

// Enhanced context endpoint
router.get("/context", async (req, res) => {
  try {
    const context = await getEnhancedProjectContext({
      threadId: req.query.threadId,
      includeThreadContext: req.query.includeThreadContext !== "false"
    });
    res.json(context);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Internet search endpoint
router.post("/search", async (req, res) => {
  try {
    const { query, userId } = req.body;
    const result = await performInternetSearch(query, userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deep workspace analysis
router.get("/analyze", async (req, res) => {
  try {
    const analysis = await analyzeWorkspaceDeep();
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Policy info (for debugging/visibility only)
router.get("/policy", (req, res) => {
  res.json({
    identity: policy.identity,
    capabilities: policy.capabilities,
    note: "Policy enforcement disabled - configuration only"
  });
});

export default router;