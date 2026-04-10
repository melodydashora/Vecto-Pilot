# AI Coach Inbox

Observations, feature requests, and memos from the AI Coach.
Items are appended here automatically when the coach uses `[COACH_MEMO]` action tags.

**For Claude Code:** Check this file at session start. Pick up actionable items and implement them.
**For AI Coach:** Write here when Melody asks you to remember something, suggests a feature, or you observe something worth capturing.

---

### [BUG] Briefing pipeline pulling mocked news data
- **Priority:** high | **Date:** 2026-04-09
- The SerpAPI and Gemini news fetcher is returning simulated high-stress test data (e.g., DFW flight disruptions, concrete pump truck crash) instead of live real-world news. Update the pipeline to ensure live dynamic data is prioritized and verify the fallback logic.
  - Files: server/api/news.ts

### [CODE_SUGGESTION] Implement AI-Gatekeeper Architecture
- **Priority:** high | **Date:** 2026-04-09
- Shift to an AI-Gatekeeper model where Gemini pre-verifies all raw API data (news, traffic, venues) before it hits the UI. Implement an async background job (every 5-10 mins) that feeds raw data to the AI to generate a 'Verified State' to prevent hallucinations and stale data.

### [BUG] Translation API Failing
- **Priority:** high | **Date:** 2026-04-09
- The Rider Translation feature is throwing a 'Translation failed' error. Debug the API route handling the request and add robust error logging to identify why the payload is dropping.
  - Files: client/src/pages/TranslatePage.tsx

### [FEATURE_REQUEST] Redesign Translation UX for Auto-Detect & Rider Selection
- **Priority:** high | **Date:** 2026-04-09
- Move the manual language selector/flags to the passenger's side of the screen (top half, upside down). Implement an auto-detect language feature using Gemini/STT so the driver doesn't have to guess the passenger's language.
  - Files: client/src/pages/TranslatePage.tsx

### [FEATURE_REQUEST] Dynamic Time-Aware Concierge Prompts
- **Priority:** medium | **Date:** 2026-04-09
- Concierge chips are currently hardcoded for nighttime. Update logic to read local time and serve context-aware prompts: Morning (Coffee/Commute), Afternoon (Lunch/Sightseeing), Night (Dinner/Events).
  - Files: client/src/pages/concierge/PublicConciergePage.tsx

### [BUG] Concierge Chat Input Mobile Overflow
- **Priority:** high | **Date:** 2026-04-09
- On mobile browsers, the chat input container causes horizontal overflow, pushing the 'Send' button off-screen. Fix flexbox constraints: ensure container is max-w-full and input is flex-1.
  - Files: client/src/pages/concierge/PublicConciergePage.tsx

### [BUG] Chat Bubble Text Overflow on Long Strings
- **Priority:** high | **Date:** 2026-04-09
- Long unbroken strings (file paths/URLs) are breaking out of the chat bubbles. Add Tailwind classes 'break-words' or 'break-all' (CSS: overflow-wrap: anywhere) to the message text containers.
  - Files: client/src/components/Chat.tsx, client/src/pages/CoachPage.tsx

### [CODE_SUGGESTION] Remove Snapshot ID from User Interface
- **Priority:** medium | **Date:** 2026-04-09
- The raw Snapshot UUID is visible on the Smart Blocks Pipeline card. Remove this from the production UI to clean up the layout; move to console logs for developer use only.
  - Files: client/src/pages/StrategyPage.tsx, client/src/components/Strategy/SmartBlocksPipeline.tsx

### [INFRASTRUCTURE] Implement Client-Side Image Compression
- **Priority:** high | **Date:** 2026-04-09
- To prevent 'Payload Too Large' errors during AI chat, implement a utility to downscale and compress images (max-width 1080px, JPEG) before they are sent to the backend/AI API.

### [ARCHITECTURE] Native Swift/Android Wrapper
- **Priority:** high | **Date:** 2026-04-09 (extracted from prod DB)
- Web browsers suspend background tabs, causing WebSocket/SSE connection drops while driving. Wrap the React frontend in a native Swift (iOS) and Android shell to run a background service that keeps the AI connection alive continuously.

### [ARCHITECTURE] PredictHQ Event Integration
- **Priority:** high | **Date:** 2026-04-09 (extracted from prod DB)
- Abandon manual venue HTML scraping. Integrate PredictHQ for non-ticketed event demand, track hotel occupancy spikes via Amadeus/OTA APIs, and use LLM crawlers for massive convention center calendars to build a global event demand pipeline.

### [FEATURE_REQUEST] Live Context Payload for Chat
- **Priority:** high | **Date:** 2026-04-09 (extracted from prod DB)
- Bypass the heavy Database Snapshot for chat. When hitting Send, append a 'live_context' payload (lat, lng, local_time, daypart) from the Global Header directly to the AI message. This provides instant, location-aware strategy without requiring a manual refresh.

### [FEATURE_REQUEST] AI-Driven Intel Tab (Market Map)
- **Priority:** high | **Date:** 2026-04-09 (extracted from prod DB)
- Shift from a static venue list to a dynamic Market Map. AI writes directly to 'strategies' and 'zone_intelligence' tables. Render TacticalZones (Red=Avoid, Green=Honey Hole) visually on the map based on the active Daypart arc.

### [FEATURE_REQUEST] Market Exit Warning (Code 6)
- **Priority:** high | **Date:** 2026-04-09 (extracted from prod DB)
- Prevent 'The Waco Trap' by mapping hard boundaries of the DFW market. If an offer takes the driver out of the authorized zone (resulting in zero return rides), trigger a massive red warning: 'MARKET EXIT - NO RIDES BACK'.

### [FEATURE_REQUEST] Reject Reason Codes & AR Desperation Dial
- **Priority:** medium | **Date:** 2026-04-09 (extracted from prod DB)
- Append simple 1-5 integer codes to Reject notifications (e.g., Code 1=Low Pay, Code 3=Long Pickup) for fast cognitive processing. Add a 'Desperation Dial' (Sniper, Status Builder, Cash Flow modes) that dynamically adjusts the AI's acceptance strictness.

### [FEATURE_REQUEST] Ghost Toll Detection
- **Priority:** medium | **Date:** 2026-04-09 (extracted from prod DB)
- Since the Uber API hides toll routes, use physics to detect them on offers. If Distance/Time calculates to a speed > 50mph, append a '[TOLLS LIKELY]' flag to the offer screen.

### [FEATURE_REQUEST] Text-to-Speech (Voice Output)
- **Priority:** high | **Date:** 2026-04-09 (extracted from prod DB)
- Implement a Text-to-Speech engine so the driver can hear the AI Coach's strategy updates and offer analysis aloud without taking their eyes off the road.

### [FEATURE_REQUEST] Concierge QR Code
- **Priority:** medium | **Date:** 2026-04-09 (extracted from prod DB)
- Generate a dynamic 'Scan for Amenities/Tips/Local Guide' QR code to display on the backseat headrest. This turns the driver into a mobile travel agency and organically boosts tips.

### [BUG] Offer Intelligence Parsing
- **Priority:** high | **Date:** 2026-04-09 (extracted from prod DB)
- The Ride Offer Analysis Log isn't correctly passing the vehicle_mode (e.g., XL) or accurate price data from the Trip Radar OCR to the AI's context. Ensure the parser sends the full vehicle tag.

### [ARCHITECTURE] Multimodal Vision Heatmap Analysis
- **Priority:** medium | **Date:** 2026-04-09 (extracted from prod DB)
- Implement a Screenshot Uploader using GPT-4o or Gemini Vision API. Allow the driver to upload/paste a heatmap screenshot, and have the AI cross-reference the pixel density/surge numbers with current GPS coordinates.

### [ARCHITECTURE] Python OCR Layout Linter
- **Priority:** medium | **Date:** 2026-04-09 (extracted from prod DB)
- Build a 'LayoutValidator' script using Python Pillow (PIL) to mathematically measure the pixel width of OCR text strings before rendering. Use this to catch text overflow bugs that break the mobile UI.

### [BUG] Unmask Timestamps in Context Injector
- **Priority:** medium | **Date:** 2026-04-09 (extracted from prod DB)
- The 'created_at' timestamps for user_intel_notes are currently stripped by the Context Injector to save tokens, blinding the AI to the date of a preference. Expose the timestamp field for Super User admin debugging.

### [COACH_MEMO] Zombie Snapshot & Auth Boundary Fix
- **Priority:** high (State Management / Data Leak) | **Date:** 2026-04-10
- **Context:** When the user logs out or auth is lost, `CoPilotContext` closes SSE connections but immediately resyncs the old Snapshot ID from `LocationContext` React state (not just sessionStorage), causing reconnection to stale streams and bypassing the GPS/Enrichment waterfall on next login.
- **Root Cause:** `auth-context.tsx` already clears `sessionStorage.removeItem(SESSION_KEYS.SNAPSHOT)` in all 3 logout paths. However, `LocationContext` holds the old `lastSnapshotId` in React state and has NO auth-drop handler. When `CoPilotContext` clears its own `lastSnapshotId` on auth loss, its sync effect (line ~188) sees `locationContext.lastSnapshotId` still set → immediately re-syncs the zombie.
- **Required Execution:**
  1. **Clear LocationContext state on auth loss:** Add an `isAuthenticated` watcher in `location-context-clean.tsx` that clears `lastSnapshotId`, `currentCoords`, `city`, `state`, `isLocationResolved`, etc. when auth drops — mirror the sessionStorage cleanup with React state cleanup.
  2. **Guard CoPilotContext sync effect:** Wrap the snapshot sync (line ~188) with `isAuthenticated` check — if not authenticated, do not sync from LocationContext.
  3. **Verify SSE destruction:** Confirm `closeAllSSE()` (already called in auth-context logout) fully destroys EventSource instances and prevents auto-reconnect unless a NEW snapshot ID is explicitly provided.
- **Files:** `client/src/contexts/location-context-clean.tsx`, `client/src/contexts/co-pilot-context.tsx`, `client/src/contexts/auth-context.tsx`

### [TODO] Fix Google Maps deprecation and loading warnings on MapPage
- **Priority:** medium | **Date:** 2026-04-10 07:07
- Logs from /co-pilot/map indicate two issues that need fixing: 1. Google Maps JS API is loaded directly without loading=async, which impacts performance. 2. google.maps.Marker is deprecated and needs to be updated to google.maps.marker.AdvancedMarkerElement.
  - Files: client/src/pages/copilot/MapPage.tsx
