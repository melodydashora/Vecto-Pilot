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
  
  // Strip Google API data - models only get isOpen status (not full hours)
  const venuesForModel = venues.map(({ businessHours, businessStatus, hasSpecialHours, calculated_distance_miles, ...rest }) => ({
    ...rest,
    // Send distance for ranking calculations only (model cannot override)
    distance_for_ranking: calculated_distance_miles
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
  return `You are a rideshare earnings calculator and venue validator for ${snapshot?.city || 'the area'}.

DRIVER LOCATION: ${driverLocation.lat}, ${driverLocation.lng}
DAY/TIME: ${snapshot?.day_part || 'unknown'} | WEATHER: ${snapshot?.weather || 'unknown'}

VENUES TO ANALYZE:
${JSON.stringify(venues, null, 2)}

TASK - Calculate probable earnings per ride for each venue based on:

1. **DISTANCE** - Use distance_for_ranking from venue data (DO NOT modify this value)
2. **VENUE TYPE** - Different categories have different earning potential:
   - Airports: $15-30/ride (high-value passengers)
   - Entertainment/Sports: $12-25/ride (events, nightlife)
   - Shopping Centers: $8-18/ride (consistent but lower)
   - Dining/Hotels: $10-20/ride (varies by time)
   
3. **TIME OF DAY** - ${snapshot?.day_part || 'current time'} affects demand and pricing

4. **OPEN/CLOSED** - If venue is CLOSED (isOpen=false), explain strategic value of positioning nearby WITHOUT including any time references

VALIDATION:
- "valid" = coordinates accurate, venue exists
- "invalid" = suspicious coordinates or non-existent venue

RANKING:
- Calculate ranking_score (1-10) based on earnings potential vs distance
- Higher score = better earnings per mile ratio

OUTPUT (JSON array; MUST preserve input order and echo "placeId" unchanged for each item):
[
  {
    "placeId": "PLACE_ID_HERE",
    "name": "venue name",
    "estimated_earnings_per_ride": 18.50,
    "earnings_per_mile": 3.56,
    "validation_status": "valid",
    "ranking_score": 8.5,
    "closed_venue_reasoning": "Strategic positioning explanation - NO TIMES" (only if closed)
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
