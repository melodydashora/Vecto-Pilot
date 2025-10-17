// server/lib/enricher-unified.js
// Model-agnostic enricher - routes to Claude, GPT, or Gemini based on TRIAD_VALIDATOR_PROVIDER

import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Universal enricher - routes to configured model provider
 * NEVER overrides distance (Routes API) or business hours (Google Places API)
 */
export async function enrichVenues({ venues, driverLocation, snapshot }) {
  const provider = (process.env.TRIAD_VALIDATOR_PROVIDER || 'google').toLowerCase();
  
  console.log(`[Enricher] Using provider: ${provider}`);
  
  // Pass all resolved data to model for intelligent reasoning
  const venuesForModel = venues.map(v => ({
    placeId: v.placeId,
    name: v.name,
    category: v.category,
    lat: v.lat,
    lng: v.lng,
    address: v.address,
    // Real data from Google APIs - model uses for context, cannot override
    distance_miles: v.calculated_distance_miles,
    drive_time_minutes: v.driveTimeMinutes,
    business_hours: v.businessHours,
    is_open: v.isOpen,
    // Keep description from tactical planner
    description: v.description
  }));

  const prompt = buildPrompt(venuesForModel, driverLocation, snapshot);
  
  let result;
  switch (provider) {
    case 'anthropic':
      result = await callClaude(prompt);
      break;
    case 'openai':
      result = await callGPT(prompt);
      break;
    case 'google':
    default:
      result = await callGemini(prompt);
      break;
  }
  
  return result;
}

function buildPrompt(venues, driverLocation, snapshot) {
  return `You are a rideshare earnings calculator for ${snapshot?.city || 'the area'}.

DRIVER LOCATION: ${driverLocation.lat}, ${driverLocation.lng}
DAY/TIME: ${snapshot?.day_part || 'unknown'} | WEATHER: ${snapshot?.weather || 'unknown'}

VENUES (with full Google API data - distance, hours, open status):
${JSON.stringify(venues, null, 2)}

TASK - Calculate earnings and validate using the provided data:

1. **DISTANCE** - Use distance_miles (Routes API - traffic-aware, DO NOT recalculate)
2. **DRIVE TIME** - Use drive_time_minutes (Routes API - DO NOT recalculate)
3. **BUSINESS HOURS** - Already provided from Google Places API
4. **OPEN STATUS** - Use is_open field (true/false from Google Places API)

EARNINGS ESTIMATION (based on category + distance + time):
- Airports: $15-30/ride (high-value passengers)
- Entertainment/Sports: $12-25/ride (events, nightlife)
- Shopping Centers: $8-18/ride (consistent but lower)
- Dining/Hotels: $10-20/ride (varies by time)

CLOSED VENUE REASONING (CRITICAL):
- ONLY provide "closed_venue_reasoning" if is_open === false
- Explain why positioning near this closed venue is still strategic
- Examples: nearby restaurants, foot traffic spillover, upcoming events, late-night crowds
- NEVER include time references (hours, AM/PM, opening times)

VALIDATION:
- "valid" = real venue with accurate coordinates
- "invalid" = suspicious or non-existent venue

OUTPUT (JSON array; preserve input order and placeId):
[
  {
    "placeId": "ChIJ...",
    "name": "venue name",
    "estimated_earnings_per_ride": 18.50,
    "earnings_per_mile": 3.56,
    "validation_status": "valid",
    "ranking_score": 8.5,
    "closed_venue_reasoning": "..." (ONLY if is_open === false)
  }
]

Return ONLY the JSON array.`;
}

async function callGemini(prompt) {
  const model = genAI.getGenerativeModel({ 
    model: process.env.GEMINI_MODEL || "gemini-2.5-pro",
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 8000,
    }
  });

  const result = await model.generateContent(prompt);
  const response = result.response.text();
  
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Gemini did not return valid JSON array');
  }
  
  return JSON.parse(jsonMatch[0]);
}

async function callGPT(prompt) {
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5',
    messages: [
      { role: 'system', content: 'You are a rideshare earnings calculator. Return only JSON.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.0,
    max_tokens: 8000,
    response_format: { type: 'json_object' }
  });

  const text = response.choices[0].message.content;
  const parsed = JSON.parse(text);
  
  // Handle both array and object with venues array
  return Array.isArray(parsed) ? parsed : (parsed.venues || parsed.recommended_venues || []);
}

async function callClaude(prompt) {
  const response = await anthropic.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
    max_tokens: 8000,
    temperature: 0.0,
    messages: [
      { role: 'user', content: prompt }
    ]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Claude did not return valid JSON array');
  }
  
  return JSON.parse(jsonMatch[0]);
}
