// server/agent/chat.js
// Streaming chat endpoint for on-shift rideshare strategy coaching
import express from "express";
import { OpenAI } from "openai";
import pg from "pg";

export const chatRouter = express.Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function loadContext(userId) {
  // 1) latest snapshot (time/zone, gps, weather, aqi, airport, etc.)
  const snap = await pool.query(
    `select *
       from snapshots
      where user_id = $1
      order by created_at desc
      limit 1`,
    [userId]
  );
  const snapshot = snap.rows[0] ?? null;

  // 2) latest strategy from strategies table for same user
  const strat = await pool.query(
    `select s.strategy, s.created_at
       from strategies s
       join snapshots snap on snap.snapshot_id = s.snapshot_id
      where snap.user_id = $1 and s.status = 'ok'
      order by s.created_at desc
      limit 1`,
    [userId]
  );
  const strategy = strat.rows[0]?.strategy ?? null;

  return { snapshot, strategy };
}

function systemPrompt({ snapshot, strategy }) {
  const when = snapshot?.created_at ?? snapshot?.timestamp ?? null;
  const city = snapshot?.city ?? null;
  const state = snapshot?.state ?? null;
  const lat = snapshot?.lat ?? snapshot?.gps_lat ?? null;
  const lng = snapshot?.lng ?? snapshot?.gps_lng ?? null;
  const weather = snapshot?.weather ? `${snapshot.weather.tempF}°F ${snapshot.weather.conditions}` : null;
  const aqi = snapshot?.air ? `AQI ${snapshot.air.aqi} (${snapshot.air.category})` : null;
  const tz = snapshot?.timezone ?? "local";
  const airport = snapshot?.airport_context ? 
    `${snapshot.airport_context.airport_code} airport ${snapshot.airport_context.distance_miles} miles away - ${snapshot.airport_context.delay_minutes} min delays` : 
    null;

  return [
    {
      role: "system",
      content:
        "You are an on-shift rideshare strategy coach. Be crisp, current, and concrete. " +
        "Do not mention model names or providers. Use the latest strategy and snapshot context. " +
        "If asked where to stage 'right now', give a single actionable pick with a short why. " +
        "If asked about 'no pings', suggest time/venue pivots and repositioning windows. " +
        "Be okay saying 'hold position' when warranted. Never invent venues; if uncertain, say so.",
    },
    {
      role: "system",
      content:
        `Snapshot:
- when: ${when ?? "unknown"} (${tz})
- place: ${city ?? "?"}, ${state ?? "?"}
- coords: ${lat ?? "?"}, ${lng ?? "?"}
- weather: ${weather ?? "?"}
- air_quality: ${aqi ?? "?"}
- airport: ${airport ?? "?"}
Strategy (latest): ${strategy ? strategy.slice(0, 4000) : "none"}
Policies:
- Single-model pipeline (do not mention names)
- No venue invention
- Keep responses short and on-duty helpful`,
    },
  ];
}

// POST /api/chat { message: string, userId?: string }
chatRouter.post("/api/chat", async (req, res) => {
  try {
    // Extract userId from body (for now, until we have proper auth middleware)
    const userId = req.body?.userId || "";
    if (!userId) {
      return res.status(401).json({ error: "unauthorized - userId required" });
    }

    const { message } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message required" });
    }

    const ctx = await loadContext(userId);
    const messages = [
      ...systemPrompt(ctx),
      { role: "user", content: message },
    ];

    console.log(`[Chat] User ${userId.slice(0, 8)} asked: "${message.slice(0, 50)}..."`);

    // Stream back to the client
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");

    const stream = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || process.env.GPT_MODEL || "gpt-5",
      max_completion_tokens: 1024,
      stream: true,
      messages,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    console.log(`[Chat] Response complete for user ${userId.slice(0, 8)}`);
  } catch (err) {
    console.error(`[Chat] Error:`, err);
    // Fall back to JSON error if streaming headers not sent yet
    try {
      res.write(`data: ${JSON.stringify({ error: String(err?.message || err) })}\n\n`);
      res.end();
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ error: "chat failed" });
      }
    }
  }
});
