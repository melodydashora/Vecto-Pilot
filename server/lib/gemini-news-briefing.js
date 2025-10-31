// server/lib/gemini-news-briefing.js
// Generate 60-minute news briefing using Gemini with snapshot context

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generate news briefing for next 60 minutes using Gemini
 * @param {Object} snapshot - Full snapshot object from database
 * @returns {Promise<Object>} Briefing with airports, traffic, events, policy, takeaways
 */
export async function generateNewsBriefing(snapshot) {
  const startTime = Date.now();
  
  try {
    console.log(`[gemini-briefing] Generating 60-min briefing for snapshot ${snapshot.snapshot_id}`);
    
    // Validate required fields
    if (!snapshot.formatted_address || !snapshot.city || !snapshot.state) {
      throw new Error('Missing required location fields (formatted_address, city, state)');
    }
    
    if (!snapshot.timezone || !snapshot.created_at) {
      throw new Error('Missing required time fields (timezone, created_at)');
    }
    
    // Format current time in local timezone
    const currentTime = new Date(snapshot.created_at);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const dayName = dayNames[currentTime.getDay()];
    const monthName = monthNames[currentTime.getMonth()];
    const dayNum = currentTime.getDate();
    const year = currentTime.getFullYear();
    
    const timeStr = currentTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: snapshot.timezone
    });
    
    // Format: "Sun Oct 26, 2025, 5:00 PM"
    const formattedTime = `${dayName} ${monthName} ${dayNum}, ${year}, ${timeStr}`;
    
    // Extract timezone abbreviation (e.g., "CT" from "America/Chicago")
    const tzAbbrev = snapshot.timezone.includes('Chicago') ? 'CT' :
                     snapshot.timezone.includes('New_York') ? 'ET' :
                     snapshot.timezone.includes('Denver') ? 'MT' :
                     snapshot.timezone.includes('Los_Angeles') ? 'PT' :
                     'Local';
    
    // Get closest airports from snapshot
    const closestAirports = snapshot.airport_context?.airport_code 
      ? `${snapshot.airport_context.airport_code}` 
      : 'None nearby';
    
    // Use only the detected airports from the snapshot's location
    const airportList = closestAirports;
    
    // Build system instruction with radius constraints
    const systemInstruction = {
      parts: [
        {
          text: `You are my rideshare briefing assistant. Respond with **ONLY** a single JSON object, no prose. Keys: airports, traffic_construction, major_events, policy_safety, driver_takeaway (array of 3 strings). Each of the first four keys must be an array of short strings. Scope: ONLY the next 60 minutes from the provided time. If a section has nothing verifiable, use an empty array.

GEOGRAPHIC RADIUS CONSTRAINTS:
- major_events: 15-minute drive OR 7-10 mile radius from driver address (whichever is SMALLER)
- traffic_construction: 0-30 minute drive OR 0-15 mile radius from driver address (whichever is SMALLER)
- airports: Nearby airports only
- policy_safety: City/metro-wide information

Example shape:
{
  "airports": ["Expected traffic patterns for nearby airports based on time of day."],
  "traffic_construction": ["Major roadway conditions affecting the area within 0-30min drive OR 0-15mi radius."],
  "major_events": ["Large events ending or starting in the next hour within 15min drive OR 7-10mi radius."],
  "policy_safety": [],
  "driver_takeaway": [
    "Strategic positioning based on current conditions.",
    "Traffic flow patterns to watch for opportunities.",
    "Time-sensitive opportunities in the next hour."
  ]
}`
        }
      ]
    };
    
    // Build user message with snapshot data
    const userMessage = {
      role: "user",
      parts: [
        {
          text: `Current time (${tzAbbrev}): ${formattedTime}
Driver address: ${snapshot.formatted_address}
Closest airports: ${airportList}

Generate the briefing now, strictly for the next 60 minutes.`
        }
      ]
    };
    
    // Configure Gemini model with thinking budget
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-2.5-pro",
      systemInstruction: systemInstruction,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        topP: 0.95,
        topK: 40,
        responseMimeType: "application/json"
      }
    });
    
    console.log(`[gemini-briefing] Requesting briefing:`, {
      time: formattedTime,
      timezone: tzAbbrev,
      address: snapshot.formatted_address,
      city: snapshot.city,
      state: snapshot.state,
      airports: airportList
    });
    
    // Generate briefing
    const result = await model.generateContent({
      contents: [userMessage]
    });
    
    const response = result.response;
    const text = response.text();
    
    console.log(`[gemini-briefing] Raw response:`, text.substring(0, 200));
    
    // Parse JSON response with aggressive extraction
    let briefing;
    try {
      briefing = JSON.parse(text);
    } catch (parseError) {
      console.warn(`[gemini-briefing] Initial parse failed: ${parseError.message}`);
      console.warn(`[gemini-briefing] Raw text: ${text}`);
      
      // Strategy 1: Extract from markdown code blocks
      let extracted = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (extracted) {
        try {
          briefing = JSON.parse(extracted[1]);
          console.log(`[gemini-briefing] ✅ Extracted from markdown code block`);
        } catch (e) {
          console.warn(`[gemini-briefing] Markdown block extraction failed`);
        }
      }
      
      // Strategy 2: Find first balanced JSON object
      if (!briefing) {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            briefing = JSON.parse(match[0]);
            console.log(`[gemini-briefing] ✅ Extracted first JSON object`);
          } catch (e) {
            console.warn(`[gemini-briefing] JSON object extraction failed`);
          }
        }
      }
      
      // Strategy 3: Try to fix truncated JSON by closing brackets
      if (!briefing) {
        let fixed = text.trim();
        // Count open/close braces and brackets
        const openBraces = (fixed.match(/\{/g) || []).length;
        const closeBraces = (fixed.match(/\}/g) || []).length;
        const openBrackets = (fixed.match(/\[/g) || []).length;
        const closeBrackets = (fixed.match(/\]/g) || []).length;
        
        // Add missing closing characters
        if (openBraces > closeBraces || openBrackets > closeBrackets) {
          // Close any open strings
          if ((fixed.match(/"/g) || []).length % 2 !== 0) {
            fixed += '"';
          }
          // Close arrays
          for (let i = 0; i < (openBrackets - closeBrackets); i++) {
            fixed += ']';
          }
          // Close objects
          for (let i = 0; i < (openBraces - closeBraces); i++) {
            fixed += '}';
          }
          
          try {
            briefing = JSON.parse(fixed);
            console.log(`[gemini-briefing] ✅ Repaired truncated JSON`);
          } catch (e) {
            console.warn(`[gemini-briefing] JSON repair failed`);
          }
        }
      }
      
      if (!briefing) {
        throw new Error(`All JSON extraction strategies failed. Original error: ${parseError.message}`);
      }
    }
    
    // Validate structure
    const requiredKeys = ['airports', 'traffic_construction', 'major_events', 'policy_safety', 'driver_takeaway'];
    const missingKeys = requiredKeys.filter(key => !briefing.hasOwnProperty(key));
    
    if (missingKeys.length > 0) {
      throw new Error(`Missing required keys: ${missingKeys.join(', ')}`);
    }
    
    // Validate driver_takeaway has 3 items
    if (!Array.isArray(briefing.driver_takeaway) || briefing.driver_takeaway.length !== 3) {
      console.warn(`[gemini-briefing] driver_takeaway should have exactly 3 items, got ${briefing.driver_takeaway?.length}`);
    }
    
    const duration = Date.now() - startTime;
    
    console.log(`[gemini-briefing] ✅ Briefing generated in ${duration}ms:`, {
      airports: briefing.airports.length,
      traffic: briefing.traffic_construction.length,
      events: briefing.major_events.length,
      policy: briefing.policy_safety.length,
      takeaways: briefing.driver_takeaway.length
    });
    
    return {
      ok: true,
      briefing,
      latency_ms: duration,
      model: process.env.GEMINI_MODEL || "gemini-2.5-pro"
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[gemini-briefing] ❌ Failed after ${duration}ms:`, error.message);
    
    return {
      ok: false,
      error: error.message,
      latency_ms: duration,
      briefing: {
        airports: [],
        traffic_construction: [],
        major_events: [],
        policy_safety: [],
        driver_takeaway: ["News briefing temporarily unavailable", "Continue with standard positioning", "Check back soon for updates"]
      }
    };
  }
}
