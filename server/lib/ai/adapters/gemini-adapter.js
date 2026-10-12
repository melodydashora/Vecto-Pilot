// server/lib/ai/adapters/gemini-adapter.js
// Generic Gemini adapter - returns { ok, output } shape
// Updated 2026-01-05: Migrated to @google/genai SDK for Gemini 3 thinkingLevel support
// Updated 2026-01-06: Added streaming support via callGeminiStream()
// Updated 2026-10-11: Thinking and sampling follow exact registry model policies.
// Updated 2026-04-28 (Phase A of log format merge plan): per-call adapter
//   diagnostics gated behind LOG_LEVEL=debug so model names and resp shapes do
//   not leak into the primary stream. Errors/warnings stay visible at all levels.

import { GoogleGenAI } from "@google/genai";
import { getGeminiModelPolicy } from '../model-registry.js';

// 2026-10-11: One-shot text requests do not reuse response IDs or thought
// signatures. Omit those opaque fields on the wire while retaining completion,
// safety, grounding and usage evidence. Do not apply this mask to chat history
// or streaming, where thought signatures may be needed by a subsequent turn.
const ONE_SHOT_RESPONSE_FIELDS = [
  'candidates.content.parts.text',
  'candidates.content.parts.thought',
  'candidates.finishReason',
  'candidates.safetyRatings',
  'candidates.groundingMetadata',
  'promptFeedback',
  'usageMetadata',
  'modelVersion',
].join(',');

function _aiDebug(...args) {
  if (String(process.env.LOG_LEVEL || 'info').toLowerCase() === 'debug') console.log(...args);
}

/**
 * 2026-10-11: Validate against the exact model policy in the registry. Gemini
 * 3.8 Flash rejects MINIMAL, while 3.6 Flash supports it. Invalid configuration
 * fails explicitly instead of silently substituting another thinking level.
 * A null level omits thinkingConfig and uses the provider's default; it does
 * not disable thinking. Never send thinkingBudget together with thinkingLevel.
 * Return UPPERCASE for REST; the SDK request uses the lowercase equivalent.
 *
 * @param {string} model - The pinned Gemini model name
 * @param {string|null} thinkingLevel - Requested thinking level
 * @returns {string|null} Validated thinking level (UPPERCASE) or null for provider default
 */
function validateThinkingLevel(model, thinkingLevel) {
  if (thinkingLevel == null) return null;

  const { validThinkingLevels } = getGeminiModelPolicy(model);
  if (!validThinkingLevels) {
    throw new Error(`No verified thinkingLevel policy for model "${model}"`);
  }
  const normalized = typeof thinkingLevel === 'string' ? thinkingLevel.toUpperCase() : null;
  if (!validThinkingLevels.includes(normalized)) {
    throw new Error(`thinkingLevel "${thinkingLevel}" is not supported by ${model}. Valid: ${validThinkingLevels.join(', ')}`);
  }

  return normalized;
}

export async function callGemini({
  model,
  system,
  user,
  images = [],  // 2026-02-16: Optional multimodal images [{mimeType: "image/jpeg", data: "base64..."}]
  maxTokens,
  temperature,
  topP,
  topK,
  useSearch = false,
  thinkingLevel = null, // Model-specific validation; null uses the provider's thinking default.
  skipJsonExtraction = false,
  responseJsonSchema,
  signal,
}) {
  try {
    signal?.throwIfAborted();
    if (responseJsonSchema !== undefined &&
        (!responseJsonSchema || typeof responseJsonSchema !== 'object' || Array.isArray(responseJsonSchema))) {
      throw new Error('responseJsonSchema must be a JSON Schema object');
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[AI] GEMINI_API_KEY not configured');
      return { ok: false, error: 'GEMINI_API_KEY not configured' };
    }

    const validatedLevel = validateThinkingLevel(model, thinkingLevel);
    const { omitSamplingParameters } = getGeminiModelPolicy(model);

    // WORKAROUND: The @google/genai SDK prioritizes GOOGLE_API_KEY from env over the apiKey passed in constructor
    // or emits a warning/error if both exist. We temporarily hide GOOGLE_API_KEY if it exists.
    const conflictingKey = process.env.GOOGLE_API_KEY;
    if (conflictingKey) {
      delete process.env.GOOGLE_API_KEY;
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // Restore the key immediately for other services (Maps etc)
    if (conflictingKey) {
      process.env.GOOGLE_API_KEY = conflictingKey;
    }

    _aiDebug(`[AI] calling ${model} with max_tokens=${maxTokens}`);

    // Models that still support sampling retain the JSON temperature cap. New
    // Flash models ignore sampling controls, so their requests omit all three.
    const expectsJson = user.toLowerCase().includes('json') ||
                        (system && system.toLowerCase().includes('json'));
    const finalTemperature = expectsJson
      ? Math.min(temperature ?? 0.2, 0.2)
      : (temperature ?? 0.7);

    // Build config object for new SDK
    const config = {
      ...(signal && { abortSignal: signal }),
      httpOptions: { headers: { 'X-Goog-FieldMask': ONE_SHOT_RESPONSE_FIELDS } },
      maxOutputTokens: maxTokens,
      ...(!omitSamplingParameters && {
        temperature: finalTemperature,
        ...(topP !== undefined && { topP }),
        ...(topK !== undefined && { topK }),
      }),
      // 2026-09-29: Grounding plus a bare JSON MIME type returned zero candidates
      // in live tests. Grounded callers without a schema use prompted JSON and
      // extraction below; ungrounded JSON callers can still use the MIME type.
      // 2026-10-12: Airport supplies an explicit schema with Search. Keep the
      // no-bare-MIME contract for other grounded callers; the schema constrains
      // JSON syntax without weakening downstream identity/evidence validation.
      ...(responseJsonSchema !== undefined
        ? { responseMimeType: 'application/json', responseJsonSchema }
        : expectsJson && !useSearch ? { responseMimeType: 'application/json' } : {}),
      // 2026-02-26: Safety filters set to OFF — news/traffic content about accidents,
      // violence, protests was being blocked. CIVIC_INTEGRITY removed (not a valid
      // adjustable category per Gemini API docs — caused silent request failures).
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
      ]
    };

    if (validatedLevel) {
      config.thinkingConfig = {
        thinkingLevel: validatedLevel.toLowerCase() // SDK expects lowercase
      };
      _aiDebug(`[AI] Thinking enabled: ${validatedLevel}`);
    }

    // Add Google Search if requested
    if (useSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    // 2026-02-26: FIX - Suppress source citations globally for google_search grounding.
    // Gemini injects markdown citations [Source](url) into responses when using google_search,
    // which corrupts JSON output and clutters prose responses. The UI does not display citations.
    if (useSearch) {
      const noCitationDirective = '\n\nIMPORTANT: Do NOT include source citations, URLs, reference links, or markdown link syntax like [text](url) in your response. Do NOT include any preamble, summary, or commentary — return ONLY the requested data format. No markdown formatting.';
      if (system) {
        system = system + noCitationDirective;
      } else {
        user = user + noCitationDirective;
      }
    }

    // 2026-03-02: Use native systemInstruction for proper system/user separation.
    // Previously concatenated system+user into a single user message, causing Flash
    // to echo rules as prose instead of following them as instructions.
    const userParts = [];
    userParts.push({ text: user });

    if (images && images.length > 0) {
      for (const img of images) {
        userParts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data,
          }
        });
      }
      _aiDebug(`[AI] Attached ${images.length} image(s) for vision analysis`);
    }

    const contents = [{ role: "user", parts: userParts }];

    const generateParams = { model, contents, config };
    if (system) {
      generateParams.config = {
        ...config,
        systemInstruction: system,
      };
    }

    const result = await ai.models.generateContent(generateParams);
    signal?.throwIfAborted();

    // New SDK response: result.text or result.response.text()
    let output = (result?.text || result?.response?.text?.() || "").trim();

    // 2026-08-06: finishReason is part of the adapter contract. MAX_TOKENS means
    // the response violated the request (truncated mid-JSON for every JSON role) —
    // returning it as ok:true is how truncation incidents (lessons_learned #17,
    // OFFER_ANALYZER@1024) masqueraded as downstream parse failures.
    const finishReason = result?.candidates?.[0]?.finishReason
      || result?.response?.candidates?.[0]?.finishReason || null;
    const blockReason = result?.promptFeedback?.blockReason
      || result?.response?.promptFeedback?.blockReason || null;
    if (finishReason === 'MAX_TOKENS') {
      // Thinking and visible text share the cap. Record only provider numeric
      // counters; missing usage stays absent and response text is never logged.
      const usage = result?.usageMetadata || result?.response?.usageMetadata || {};
      const counts = [['promptTokens', 'promptTokenCount'], ['outputTokens', 'candidatesTokenCount'],
        ['thoughtsTokens', 'thoughtsTokenCount'], ['totalTokens', 'totalTokenCount']]
        .filter(([, key]) => Number.isInteger(usage[key]) && usage[key] >= 0)
        .map(([label, key]) => `${label}=${usage[key]}`).join(' ');
      console.warn(`[AI] ${model} truncated at max_tokens=${maxTokens} (finishReason=MAX_TOKENS) — returning ok:false with partial output (${output.length} chars)${counts ? ` ${counts}` : ''}`);
      return { ok: false, output, truncated: true, error: `truncated at max_tokens=${maxTokens} (finishReason=MAX_TOKENS)` };
    }

    // GEMINI CLEANUP: Remove markdown code blocks and wrapper text
    if (output) {
      const rawLength = output.length;
      
      // 2026-02-09: FIX - Only strip code blocks if they wrap the ENTIRE response
      // Prevents data loss when code blocks are embedded in documentation
      // Matches: start, optional whitespace, ```tag, content, ```, optional whitespace, end
      const codeBlockMatch = output.match(/^\s*```(?:\w+)?\s*([\s\S]*?)\s*```\s*$/);
      if (codeBlockMatch) {
        output = codeBlockMatch[1].trim();
        _aiDebug(`[AI] Removed wrapping markdown code block (${rawLength} → ${output.length} chars)`);
      }

      // 2026-02-26: FIX - Removed isMarkdown check that skipped JSON extraction when
      // Gemini prepended markdown headers (e.g., "### Findings...") before JSON.
      // DOCS_GENERATOR already uses skipJsonExtraction=true, making isMarkdown redundant.
      // 2026-03-01: FIX — Check both system AND user for "json" keyword.
      // Previously only checked user, missing cases where system prompt requests JSON output
      // (e.g., OFFER_ANALYZER Phase 1 prompt says "Output ONLY JSON" in system, not user).
      if (expectsJson && !skipJsonExtraction) {
        // Strip leading markdown prose before JSON extraction
        // (google_search grounding sometimes adds a prose preamble before the JSON)
        let extractTarget = output;
        const firstBrace = output.search(/[[\{]/);
        if (firstBrace > 0) {
          const preamble = output.substring(0, firstBrace);
          // Only strip if preamble is pure prose (no JSON-like characters)
          if (!preamble.includes('"') && !preamble.includes(':')) {
            extractTarget = output.substring(firstBrace);
            _aiDebug(`[AI] Stripped ${firstBrace} chars of preamble before JSON`);
          }
        }

        let jsonStart = -1;
        let jsonEnd = -1;
        let isArray = false;

        const arrayStart = extractTarget.indexOf('[');
        const objectStart = extractTarget.indexOf('{');

        if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
          jsonStart = arrayStart;
          jsonEnd = extractTarget.lastIndexOf(']');
          isArray = true;
        } else if (objectStart !== -1) {
          jsonStart = objectStart;
          jsonEnd = extractTarget.lastIndexOf('}');
          isArray = false;
        }

        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          // extractTarget differs from output when a prose preamble was stripped above.
          // The slice must be applied then too, or the preamble is returned with the JSON.
          if (jsonStart > 0 || jsonEnd < extractTarget.length - 1 || extractTarget !== output) {
            const extracted = extractTarget.slice(jsonStart, jsonEnd + 1);
            try {
              JSON.parse(extracted);
              output = extracted;
              _aiDebug(`[AI] Extracted JSON (${rawLength} → ${output.length} chars, ${isArray ? 'array' : 'object'})`);
            } catch (e) {
              console.warn(`[AI] JSON extraction failed, keeping original output`);
            }
          }
        }
      }
    }

    _aiDebug("[AI] resp:", {
      model,
      response: !!result?.response,
      len: output?.length ?? 0
    });

    if (output) return { ok: true, output };

    // Counts only, never upstream content: enough to tell "no candidate came back" from
    // "a candidate came back without text" after the router reduces the cause to a code.
    const candidates = result?.candidates || result?.response?.candidates || [];
    const usage = result?.usageMetadata || result?.response?.usageMetadata || {};
    const cause = ['Empty response from Gemini',
      `candidates=${candidates.length}`,
      finishReason && `finishReason=${finishReason}`,
      blockReason && `blockReason=${blockReason}`,
      Number.isFinite(usage.promptTokenCount) && `promptTokens=${usage.promptTokenCount}`,
      Number.isFinite(usage.thoughtsTokenCount) && `thoughtsTokens=${usage.thoughtsTokenCount}`,
      `grounded=${Boolean(useSearch)}`,
      `jsonMode=${Boolean(config.responseMimeType)}`].filter(Boolean).join(' ');
    console.warn(`[AI] ${cause}`);
    return { ok: false, output: "", error: cause };
  } catch (err) {
    console.error("[AI] error:", err?.message || err);
    return { ok: false, output: "", error: err?.message || String(err) };
  }
}

/**
 * Streaming version of callGemini for chat/SSE use cases
 * 2026-01-06: Added to support adapter pattern for coach chat
 *
 * @param {Object} params - Same as callGemini plus messageHistory
 * @returns {Promise<Response>} - Fetch Response object with readable stream body
 */
// 2026-02-11: Added thinkingLevel parameter for Gemini 3 Pro streaming support
export async function callGeminiStream({
  model,
  system,
  messageHistory = [], // Array of { role: 'user'|'model', parts: [{ text }] }
  maxTokens,
  temperature,
  useSearch = true,
  thinkingLevel = "high", // Model-specific validation; explicit null uses the provider's default.
  timeoutMs = 90000,
  signal              // Optional caller AbortSignal — forwarded so client disconnect cancels the upstream Gemini call
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const validatedStreamLevel = validateThinkingLevel(model, thinkingLevel);
  const { omitSamplingParameters } = getGeminiModelPolicy(model);

  _aiDebug(`[AI] Calling ${model} with ${messageHistory.length} messages, maxTokens=${maxTokens}`);

  // Build the request body
  const generationConfig = {
    ...(!omitSamplingParameters && {
      temperature: temperature ?? 0.7,
      topP: 0.95,
      topK: 40,
    }),
    maxOutputTokens: maxTokens || 8192,
  };

  if (validatedStreamLevel) {
    generationConfig.thinkingConfig = {
      thinkingLevel: validatedStreamLevel // Already uppercase from validator; REST API expects uppercase
    };
    _aiDebug(`[AI] Thinking enabled: ${validatedStreamLevel}`);
  }

  const requestBody = {
    contents: messageHistory,
    generationConfig,
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
    ]
  };

  // Add system instruction if provided
  // 2026-02-26: Suppress citations in streaming responses too (AI Coach uses google_search)
  let streamSystem = system;
  if (useSearch && streamSystem) {
    streamSystem += '\n\nIMPORTANT: Do NOT include source citations, URLs, reference links, or markdown link syntax like [text](url) in your response. Return CLEAN content only. No markdown formatting.';
  }
  if (streamSystem) {
    requestBody.systemInstruction = {
      parts: [{ text: streamSystem }]
    };
  }

  // Add Google Search tool if requested
  if (useSearch) {
    requestBody.tools = [{ google_search: {} }];
  }

  // Create abort controller with timeout. If the caller passes a signal
  // (e.g., chat.js wires req.on('close') for client-disconnect cancellation),
  // chain it so external aborts also propagate to the upstream Gemini call.
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) abortController.abort();
    else signal.addEventListener('abort', () => abortController.abort(), { once: true });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify(requestBody)
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[AI] API error ${response.status}: ${errText.substring(0, 200)}`);
      throw new Error(`Gemini API error ${response.status}: ${errText.substring(0, 100)}`);
    }

    _aiDebug(`[AI] Stream started for ${model}`);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error(`[AI] Error: ${err.message}`);
    throw err;
  }
}
