// server/lib/ai/adapters/vertex-adapter.js
// Google Cloud Vertex AI adapter for Gemini models
// Uses Google Cloud authentication (ADC or service account) instead of API key
//
// Created: 2026-01-08
// Supports: Vertex AI Gemini models (gemini-2.0-flash, gemini-1.5-pro, etc.)
//
// Environment variables:
//   GOOGLE_CLOUD_PROJECT - Google Cloud project ID (required)
//   GOOGLE_CLOUD_LOCATION - Region (default: us-central1)
//   GOOGLE_APPLICATION_CREDENTIALS - Path to service account JSON (optional, uses ADC if not set)
//   VERTEX_AI_ENABLED - Set to 'true' to enable Vertex AI adapter

import { VertexAI } from "@google-cloud/vertexai";

// Lazy-initialized client
let vertexClient = null;

/**
 * Initialize Vertex AI client
 * Uses Application Default Credentials (ADC) or service account
 */
function getVertexClient() {
  if (vertexClient) return vertexClient;

  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";

  if (!project) {
    throw new Error("GOOGLE_CLOUD_PROJECT environment variable is required for Vertex AI");
  }

  console.log(`[vertex-adapter] Initializing Vertex AI client for project=${project}, location=${location}`);

  vertexClient = new VertexAI({
    project,
    location,
  });

  return vertexClient;
}

/**
 * Call Vertex AI Gemini model
 *
 * @param {Object} params
 * @param {string} params.model - Model name (e.g., 'gemini-2.0-flash-001', 'gemini-1.5-pro')
 * @param {string} params.system - System instruction
 * @param {string} params.user - User message
 * @param {number} params.maxTokens - Maximum output tokens
 * @param {number} params.temperature - Temperature (0.0-1.0)
 * @param {boolean} params.useSearch - Enable Google Search grounding
 * @param {string} params.thinkingLevel - Thinking level for Gemini 2.0+ ("low", "medium", "high")
 * @returns {Promise<{ok: boolean, output: string, error?: string}>}
 */
export async function callVertexAI({
  model,
  system,
  user,
  maxTokens = 8192,
  temperature = 0.7,
  topP,
  topK,
  useSearch = false,
  thinkingLevel = null
}) {
  try {
    // Check if Vertex AI is enabled
    if (process.env.VERTEX_AI_ENABLED !== "true") {
      console.warn("[vertex-adapter] ⚠️ Vertex AI not enabled (set VERTEX_AI_ENABLED=true)");
      return { ok: false, error: "Vertex AI not enabled" };
    }

    const client = getVertexClient();

    // Get the generative model
    const generativeModel = client.getGenerativeModel({
      model,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
        ...(topP !== undefined && { topP }),
        ...(topK !== undefined && { topK }),
      },
      // Add system instruction if provided
      ...(system && {
        systemInstruction: {
          parts: [{ text: system }],
        },
      }),
      // Safety settings - permissive for development
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    });

    console.log(`[vertex-adapter] Calling ${model} with maxTokens=${maxTokens}, temp=${temperature}`);

    // Build request with optional tools
    const request = {
      contents: [
        {
          role: "user",
          parts: [{ text: user }],
        },
      ],
    };

    // Add Google Search grounding if requested
    if (useSearch) {
      request.tools = [{ googleSearchRetrieval: {} }];
      console.log("[vertex-adapter] 🔍 Google Search grounding enabled");
    }

    // Generate content
    const result = await generativeModel.generateContent(request);
    const response = result.response;

    // Extract text from response
    let output = "";
    if (response.candidates && response.candidates[0]) {
      const parts = response.candidates[0].content?.parts || [];
      output = parts.map((p) => p.text || "").join("").trim();
    }

    // Clean up JSON responses (same as gemini-adapter)
    if (output) {
      const rawLength = output.length;

      // Remove markdown code blocks
      const codeBlockMatch = output.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        output = codeBlockMatch[1].trim();
        console.log(`[vertex-adapter] 🧹 Removed markdown code block (${rawLength} → ${output.length} chars)`);
      }

      // Extract JSON if requested
      if (user.toLowerCase().includes("json")) {
        const jsonMatch = output.match(/[\[{][\s\S]*[\]}]/);
        if (jsonMatch) {
          try {
            JSON.parse(jsonMatch[0]);
            output = jsonMatch[0];
            console.log(`[vertex-adapter] 🧹 Extracted JSON (${rawLength} → ${output.length} chars)`);
          } catch {
            // Keep original if JSON parsing fails
          }
        }
      }
    }

    console.log("[vertex-adapter] Response:", {
      model,
      outputLength: output?.length || 0,
      hasGrounding: useSearch,
    });

    return output
      ? { ok: true, output }
      : { ok: false, output: "", error: "Empty response from Vertex AI" };

  } catch (err) {
    console.error("[vertex-adapter] Error:", err?.message || err);
    return { ok: false, output: "", error: err?.message || String(err) };
  }
}

/**
 * Streaming version for chat/SSE use cases
 *
 * @param {Object} params
 * @param {string} params.model - Model name
 * @param {string} params.system - System instruction
 * @param {Array} params.messageHistory - Array of { role, parts } objects
 * @param {number} params.maxTokens - Maximum output tokens
 * @param {number} params.temperature - Temperature
 * @param {boolean} params.useSearch - Enable Google Search
 * @returns {AsyncGenerator<string>} - Yields text chunks
 */
export async function* callVertexAIStream({
  model,
  system,
  messageHistory = [],
  maxTokens = 8192,
  temperature = 0.7,
  useSearch = false,
}) {
  if (process.env.VERTEX_AI_ENABLED !== "true") {
    throw new Error("Vertex AI not enabled (set VERTEX_AI_ENABLED=true)");
  }

  const client = getVertexClient();

  const generativeModel = client.getGenerativeModel({
    model,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
    },
    ...(system && {
      systemInstruction: {
        parts: [{ text: system }],
      },
    }),
  });

  console.log(`[vertex-adapter] Streaming ${model} with ${messageHistory.length} messages`);

  const request = {
    contents: messageHistory,
  };

  if (useSearch) {
    request.tools = [{ googleSearchRetrieval: {} }];
  }

  const streamingResult = await generativeModel.generateContentStream(request);

  for await (const chunk of streamingResult.stream) {
    const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (text) {
      yield text;
    }
  }
}

/**
 * Check if Vertex AI is configured and available
 */
export function isVertexAIAvailable() {
  return (
    process.env.VERTEX_AI_ENABLED === "true" &&
    !!process.env.GOOGLE_CLOUD_PROJECT
  );
}

/**
 * Get Vertex AI configuration status
 */
export function getVertexAIStatus() {
  return {
    enabled: process.env.VERTEX_AI_ENABLED === "true",
    project: process.env.GOOGLE_CLOUD_PROJECT || null,
    location: process.env.GOOGLE_CLOUD_LOCATION || "us-central1",
    hasCredentials: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
  };
}
