// server/routes/snapshot.js
import express from "express";
const router = express.Router();

// keep it minimal first to prove the path is correct
router.post("/", (req, res) => {
  console.log("[snapshot] handler ENTER", { url: req.originalUrl });
  return res.json({ ok: true, ts: Date.now() });
});

export default router;
