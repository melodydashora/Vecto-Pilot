// server/lib/fast-tactical-reranker.js
// Fast Tactical Reranker: Sub-7s performance path
// Takes deterministic candidates → reranks with LLM → returns within 5s timeout
// NO venue generation - only reranking from provided list

import { callGeminiGenerateContent } from "./adapters/gemini-2.5-pro.js";
import { z } from "zod";

// Strict schema - only allow reranking from candidate list
const RerankItemSchema = z.object({
  id: z.string(), // Must match a candidate ID
  score: z.number().min(0).max(100),
  reason: z.string().optional()  // No char limit - model-agnostic
});

const RerankResponseSchema = z.object({
  ranked_venues: z.array(RerankItemSchema).max(12),
  tactical_notes: z.string().optional()  // No char limit - model-agnostic
});

/**
 * Fast tactical reranking for sub-7s performance
 * @param {Object} params
 * @param {Array} params.candidates - Pre-selected candidates with features (max 30)
 * @param {Object} params.context - Snapshot context
 * @param {number} params.timeoutMs - Hard timeout in milliseconds (default: 5000)
 * @returns {Promise<Object>} Reranked venues or null if timeout/error
 */
export async function rerankCandidates({ candidates, context, timeoutMs = 5000 }) {
  const startTime = Date.now();
  
  if (!candidates || candidates.length === 0) {
    console.warn('[Fast Reranker] No candidates provided');
    return null;
  }

  // Limit to top 30 candidates for token efficiency
  const limitedCandidates = candidates.slice(0, 30);

  // Build compact prompt - strict reranking only
  const systemInstruction = [
    "You are a tactical venue reranker for rideshare drivers.",
    "CRITICAL: You may ONLY select from the provided candidate list.",
    "Do NOT generate, invent, or suggest any venues not in the list.",
    "Task: Rerank the candidates based on current context and return up to 12 best venues.",
    "Consider: drive time, earnings potential, open probability, demand patterns.",
    "Return JSON only: {ranked_venues: [{id, score, reason?}], tactical_notes?: string}"
  ].join(" ");

  // Build candidate list with compact features
  const candidateList = limitedCandidates.map((c, idx) => ({
    id: c.venue_id || `cand_${idx}`,
    name: c.name,
    category: c.category,
    drive_min: c.data?.driveTimeMinutes || c.driveTimeMinutes || 0,
    potential_earnings: c.data?.potential || c.potential || 0,
    surge: c.data?.surge || c.surge || 1.0,
    reliability: c.reliability_score || 0.5,
    open_prob: c.open_now_prob || 0.5
  }));

  const userText = JSON.stringify({
    time: context?.day_part_key || 'unknown',
    location: context?.city ? `${context.city}, ${context.state}` : 'unknown',
    weather: context?.weather?.conditions || 'clear',
    candidates: candidateList,
    instruction: "Rerank candidates by tactical value. Select up to 12. Return JSON only."
  });

  console.log(`[Fast Reranker] Starting rerank of ${limitedCandidates.length} candidates (timeout: ${timeoutMs}ms)`);

  // Set up abort controller with strict timeout
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    console.warn(`[Fast Reranker] ⏱️ Timeout after ${timeoutMs}ms - aborting`);
    abortController.abort();
  }, timeoutMs);

  try {
    // Call Gemini 2.5 Pro with low temperature for consistent reranking
    const rawResponse = await callGeminiGenerateContent({
      systemInstruction,
      userText,
      abortSignal: abortController.signal,
      temperature: 0.2, // Low temperature for deterministic reranking
      maxOutputTokens: 500 // Strict token limit for fast response
    });

    clearTimeout(timeoutHandle);
    const elapsed = Date.now() - startTime;

    // Parse and validate response
    const parsed = safeJsonParse(rawResponse);
    if (!parsed) {
      console.warn('[Fast Reranker] Invalid JSON response');
      return null;
    }

    const validation = RerankResponseSchema.safeParse(parsed);
    if (!validation.success) {
      console.warn('[Fast Reranker] Validation failed:', validation.error.message);
      return null;
    }

    // Ensure all IDs exist in candidate list
    const validIds = new Set(candidateList.map(c => c.id));
    const validRanked = validation.data.ranked_venues.filter(v => validIds.has(v.id));

    if (validRanked.length === 0) {
      console.warn('[Fast Reranker] No valid ranked venues returned');
      return null;
    }

    console.log(`✅ [Fast Reranker] Reranked ${validRanked.length} venues in ${elapsed}ms`);

    return {
      ranked_venue_ids: validRanked.map(v => v.id),
      scores: validRanked.reduce((acc, v) => ({ ...acc, [v.id]: v.score }), {}),
      reasons: validRanked.reduce((acc, v) => v.reason ? { ...acc, [v.id]: v.reason } : acc, {}),
      tactical_notes: validation.data.tactical_notes || null,
      metadata: {
        elapsed_ms: elapsed,
        input_count: limitedCandidates.length,
        output_count: validRanked.length,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
        temperature: 0.2
      }
    };

  } catch (error) {
    clearTimeout(timeoutHandle);
    
    if (error.name === 'AbortError') {
      console.warn('[Fast Reranker] Request aborted (timeout)');
      return null;
    }

    console.error('[Fast Reranker] Error:', error.message);
    return null;
  }
}

/**
 * Safe JSON parsing with fallback
 */
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code blocks
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {}
    }
    
    // Try to find first balanced JSON object
    let depth = 0;
    let start = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (text[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {}
        }
      }
    }
    
    return null;
  }
}
