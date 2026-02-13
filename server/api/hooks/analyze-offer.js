import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { intercepted_signals } from '../../../shared/schema.js';
import { callModel } from '../../lib/ai/adapters/index.js';

const router = Router();

// POST /api/hooks/analyze-offer
// Accepts OCR text or raw image data from Siri Shortcuts/Mobile Automation
// NOTE: Explicitly public for now to allow Siri/Automations without complex auth
router.post('/analyze-offer', async (req, res) => {
  try {
    const { text, image, device_id, source = 'api_hook' } = req.body;

    if (!text && !image) {
      return res.status(400).json({ error: 'Missing text or image payload' });
    }

    // 1. Construct AI Prompt
    const systemPrompt = `
      You are an expert Rideshare Strategy Analyst. 
      Your job is to parse "Ride Offer" screens from Uber/Lyft and decide ACCEPT or REJECT.
      
      Output JSON ONLY:
      {
        "parsed_data": {
          "price": number,
          "miles": number,
          "time_minutes": number,
          "pickup": "string",
          "dropoff": "string",
          "platform": "uber" | "lyft"
        },
        "decision": "ACCEPT" | "REJECT",
        "reasoning": "string (concise strategic reason)",
        "confidence": number (0-100)
      }

      Strategic Rules:
      - Minimum $1 per mile is baseline.
      - Reject long pickups (>10 mins) for short rides.
      - Reject rides going to known "Dead Zones" (e.g., deep suburbs with no return trips).
    `;

    const userMessage = text 
      ? `Analyze this ride offer text: "${text}"`
      : `Analyze this ride offer image.`;

    // 2. Call AI Model
    // Using 'COACH_CHAT' role as a proxy for strategy logic
    // 2026-02-12: FIX - Pass `user` not `messages`. The Gemini adapter only reads
    // `system` and `user`, so `messages` was silently dropped — the ride offer text
    // was never sent to the AI model (user was `undefined`).
    const aiResponse = await callModel('COACH_CHAT', {
      system: systemPrompt,
      user: userMessage
    });

    if (!aiResponse.success) {
      throw new Error(`AI Analysis Failed: ${aiResponse.error}`);
    }

    // 3. Parse JSON from AI Response
    let result;
    try {
      // clean code block formatting if present
      const cleaned = aiResponse.text.replace(/```json/g, '').replace(/```/g, '').trim();
      result = JSON.parse(cleaned);
    } catch (e) {
      console.warn("Failed to parse AI JSON, saving raw:", aiResponse.text);
      result = { 
        decision: 'UNKNOWN', 
        reasoning: aiResponse.text, 
        confidence: 0, 
        parsed_data: {} 
      };
    }

    // 4. Save to Database
    const savedRecord = await db.insert(intercepted_signals).values({
      device_id: device_id || 'anonymous_device',
      raw_text: text || '[Image Data]',
      parsed_data: result.parsed_data,
      decision: result.decision,
      decision_reasoning: result.reasoning,
      confidence_score: result.confidence,
      source: source
    }).returning();

    // 5. Respond to Client
    res.json({
      success: true,
      analysis: result,
      id: savedRecord[0].id
    });

  } catch (error) {
    console.error('[hooks/analyze-offer] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;