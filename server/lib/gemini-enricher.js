// server/lib/gemini-enricher.js
// Gemini enrichment: Calculate earnings from real distance, validate venues, explain closed venues

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_MAPS_API_KEY);

export async function enrichVenuesWithGemini({ venues, driverLocation, snapshot }) {
  const model = genAI.getGenerativeModel({ 
    model: process.env.GEMINI_MODEL || "gemini-3-pro-preview",
    generationConfig: {
      temperature: 0.0, // Deterministic
      maxOutputTokens: 8000,
    }
  });

  const prompt = `You are a rideshare earnings calculator and venue validator for ${snapshot?.city || 'the area'}.

DRIVER LOCATION: ${driverLocation.lat}, ${driverLocation.lng}
DAY/TIME: ${snapshot?.day_part || 'unknown'} | WEATHER: ${snapshot?.weather || 'unknown'}

VENUES TO ANALYZE:
${JSON.stringify(venues, null, 2)}

TASK - Calculate probable earnings per ride for each venue based on:

1. **DISTANCE** - Use calculated_distance_miles from venue data
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
    "estimated_distance_miles": 5.2,
    "estimated_earnings_per_ride": 18.50,
    "earnings_per_mile": 3.56,
    "validation_status": "valid",
    "ranking_score": 8.5,
    "closed_venue_reasoning": "Strategic positioning explanation - NO TIMES" (only if closed)
  }
]

Return ONLY the JSON array.`;

  const result = await model.generateContent(prompt);
  const response = result.response.text();
  
  // Parse JSON response
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Gemini did not return valid JSON array');
  }
  
  return JSON.parse(jsonMatch[0]);
}
