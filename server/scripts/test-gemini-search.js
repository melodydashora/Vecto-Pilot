// Standalone test to verify Gemini 3.0 Pro + Google Search Tool configuration
import process from 'node:process';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ Error: GEMINI_API_KEY is not set in environment variables.");
  process.exit(1);
}

async function testGeminiConnection() {
  console.log("🚀 Starting Gemini 3.0 Pro Preview Search Tool Test...");

  const model = "gemini-3-pro-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: "Find 3 major events happening in Dallas, TX today. Return valid JSON only."
          }
        ]
      }
    ],
    tools: [
      { google_search: {} }
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048,
      responseMimeType: "application/json"
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
    ]
  };

  console.log("📡 Sending Payload:", JSON.stringify(payload, null, 2));

  try {
    const start = Date.now();
    const response = await fetch(`${url}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const duration = Date.now() - start;
    console.log(`⏱️ Request took ${duration}ms`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];

    if (candidate?.groundingMetadata?.searchEntryPoint || candidate?.groundingMetadata?.groundingChunks) {
      console.log("\n✅ SUCCESS: Google Search Tool was USED.");
      console.log("🔎 Grounding Metadata found:", JSON.stringify(candidate.groundingMetadata, null, 2).substring(0, 200) + "...");
    } else {
      console.warn("\n⚠️ WARNING: No Grounding Metadata found. The model may have answered from internal knowledge instead of searching.");
    }

    const rawText = candidate?.content?.parts?.[0]?.text || "";
    console.log("\n📝 Raw Response Output:");
    console.log(rawText.substring(0, 500) + "...");

    try {
      const parsed = JSON.parse(rawText);
      console.log(`\n✅ JSON Parsing: VALID (${Array.isArray(parsed) ? parsed.length : 'Object'} items)`);
    } catch (e) {
      console.error(`\n❌ JSON Parsing: FAILED - ${e.message}`);
    }

  } catch (error) {
    console.error("\n❌ TEST FAILED:", error.message);
  }
}

testGeminiConnection();
