# Independent Coach snapshot and source lineage — October 12, 2026

This source change follows Melody's request for Coach to refresh its own location
without running MAIN. Coach activation attempts GPS/Google capture; a completed
model refresh request can lead to one answer-only continuation after success.
The saved-source ID and new Coach observation ID are separate. Original guidance
records remain unchanged and historical; coordinates never come from the model.

The following diffs preserve the exact preceding source and documentation passages
replaced in this bounded change. Preimages were copied before editing on
`astra/pipeline-readiness-20261004`, based at `380bdb619dfdea77be9b357f02e3ef62bc5a8e43`
with earlier authorized session changes already present. This is repository evidence,
not a deployment or real-device acceptance receipt. The old single-snapshot selector,
source projection and real-time labels are retired because they could couple Coach
to MAIN or label earlier observations as current at a different location.

## server/api/chat/chat.js

```diff
diff --git a/tmp/astra-coach-snapshot-context-before-20261012/chat.js b/server/api/chat/chat.js
index 386d53f5..1789d7a8 100644
--- a/tmp/astra-coach-snapshot-context-before-20261012/chat.js
+++ b/server/api/chat/chat.js
@@ -26,4 +26,5 @@ import { getRoleConfig } from '../../lib/ai/model-registry.js';
 import { formatCoachSourceContext } from '../../lib/ai/coach-source-context.js';
 import { getCoachContextProgress } from '../../lib/ai/coach-context-progress.js';
+import { readOwnedCoachSnapshot } from '../../lib/location/coach-snapshot.js';
 import { readCoachResponse } from '../../lib/ai/adapters/coach-responses.js';
 // @ts-ignore
@@ -63,7 +64,18 @@ function formatSnapshotHistoryTime(snapshot) {
  * Execute parsed actions asynchronously (non-blocking)
  */
-async function executeActions(actions, userId, snapshotId, conversationId, signal, auth, offerRules) {
+async function executeActions(actions, userId, snapshotId, conversationId, signal, auth, offerRules, currentSnapshot) {
   const results = { saved: 0, errors: [], memos: [] };
 
+  if (actions.coachSnapshotRefresh?.length) {
+    signal?.throwIfAborted();
+    if (actions.coachSnapshotRefresh.length !== 1) {
+      results.errors.push('Coach snapshot refresh: request one device capture per turn.');
+    } else {
+      const validation = validateAction('REFRESH_COACH_SNAPSHOT', actions.coachSnapshotRefresh[0]);
+      if (validation.ok) results.coach_snapshot_refresh = { requested: true, reason: validation.data.reason };
+      else results.errors.push(`Coach snapshot refresh: ${validation.errors.map(error => error.message).join('; ')}`);
+    }
+  }
+
   // Save user notes (with validation)
   for (const note of actions.notes) {
@@ -263,5 +275,5 @@ async function executeActions(actions, userId, snapshotId, conversationId, signa
 
       // Get city/state from snapshot context (events need location)
-      const snapshot = snapshotId ? await rideshareCoachDAL.getHeaderSnapshot(snapshotId) : null;
+      const snapshot = currentSnapshot ?? (snapshotId ? await rideshareCoachDAL.getHeaderSnapshot(snapshotId) : null);
       const city = event.city || snapshot?.city;
       const state = event.state || snapshot?.state;
@@ -621,16 +633,21 @@ router.get('/context/:snapshotId', requireAuth, requireSnapshotOwnership, async
 
   try {
+    const coachSnapshotId = req.query.coachSnapshotId ??
+      (req.snapshot?.permissions?.context_kind === 'coach' ? snapshotId : null);
+    const coachSnapshot = coachSnapshotId != null ? await readOwnedCoachSnapshot(req.auth, coachSnapshotId) : null;
+    const sourceSnapshotId = req.snapshot?.permissions?.context_kind === 'coach' || coachSnapshotId === snapshotId ? null : snapshotId;
     if (req.query.summary === '1') {
-      const [snapshot, strategy, briefing, offerHistory] = await Promise.all([
-        rideshareCoachDAL.getHeaderSnapshot(snapshotId),
-        rideshareCoachDAL.getLatestStrategy(snapshotId),
-        rideshareCoachDAL.getComprehensiveBriefing(snapshotId),
+      const [sourceSnapshot, strategy, briefing, offerHistory] = await Promise.all([
+        sourceSnapshotId ? rideshareCoachDAL.getHeaderSnapshot(sourceSnapshotId) : null,
+        sourceSnapshotId ? rideshareCoachDAL.getLatestStrategy(sourceSnapshotId) : null,
+        sourceSnapshotId ? rideshareCoachDAL.getComprehensiveBriefing(sourceSnapshotId) : null,
         rideshareCoachDAL.getOfferHistory(req.auth.userId, 20),
       ]);
       res.setHeader('Cache-Control', 'no-store');
-      return res.json(getCoachContextProgress({ snapshot, strategy, briefing, offerHistory }));
+      return res.json({ ...getCoachContextProgress({ snapshot: coachSnapshot ?? sourceSnapshot, sourceSnapshot, strategy, briefing, offerHistory }),
+        ...(coachSnapshot && { coach_snapshot_id: coachSnapshot.snapshot_id, source_snapshot_id: sourceSnapshotId }) });
     }
     // Use CoachDAL for read-only access
-    const context = await rideshareCoachDAL.getCompleteContext(snapshotId, null, req.auth.userId);
+    const context = await rideshareCoachDAL.getCompleteContext(sourceSnapshotId, null, req.auth.userId, { coachSnapshot });
     
     res.json({
@@ -638,4 +655,6 @@ router.get('/context/:snapshotId', requireAuth, requireSnapshotOwnership, async
       status: context.status,
       snapshot: context.snapshot,
+      source_snapshot: context.sourceSnapshot ?? null,
+      saved_context_source: context.savedContextSource ?? null,
       strategy: context.strategy,
       briefing: context.briefing,
@@ -647,6 +666,6 @@ router.get('/context/:snapshotId', requireAuth, requireSnapshotOwnership, async
   } catch (error) {
     console.error('[coach] Context fetch failed:', error.message);
-    res.status(500).json({
-      error: 'CONTEXT_FETCH_FAILED',
+    res.status(error.status || 500).json({
+      error: error.code || 'CONTEXT_FETCH_FAILED',
       message: error.message,
       snapshot_id: snapshotId
@@ -663,5 +682,5 @@ router.post('/', requireAuth, async (req, res) => {
   const body = req.body && typeof req.body === 'object' ? req.body : {};
   const answerOnly = body.answerOnly === true;
-  const { userId, message, threadHistory = [], snapshotId: rawSnapshotId, strategyId: rawStrategyId, strategy, blocks, attachments = [], conversationId: clientConversationId, snapshot: clientSnapshot } = body;
+  const { userId, message, threadHistory = [], snapshotId: rawSnapshotId, coachSnapshotId, strategyId: rawStrategyId, strategy, blocks, attachments = [], conversationId: clientConversationId, snapshot: clientSnapshot } = body;
   // 2026-09-10 (CodeQL type-confusion class): these reach `.slice()` before the try block
   // below; a non-string body value ({}/number) threw synchronously and hung the request.
@@ -672,4 +691,7 @@ router.post('/', requireAuth, async (req, res) => {
     return res.status(400).json({ error: 'message required' });
   }
+  if (coachSnapshotId != null && (typeof coachSnapshotId !== 'string' || !UUID_RE.test(coachSnapshotId))) {
+    return res.status(400).json({ error: 'coachSnapshotId must be a UUID' });
+  }
 
   const validAttachment = attachment => attachment && typeof attachment === 'object'
@@ -713,4 +735,9 @@ router.post('/', requireAuth, async (req, res) => {
 
   try {
+    // This read validates explicit purpose, owner and live session. A rejected
+    // Coach identity must stop before provider calls or conversation writes.
+    let coachSnapshot = coachSnapshotId != null ? await readOwnedCoachSnapshot(req.auth, coachSnapshotId) : null;
+    let coachContextRequested = coachSnapshotId != null;
+    if (coachSnapshot) userTimezone = coachSnapshot.timezone || null;
     // Use CoachDAL for full schema read access with ALL tables
     let contextInfo = '';
@@ -722,6 +749,6 @@ router.post('/', requireAuth, async (req, res) => {
 
     try {
-      // PRIORITY: Use the snapshotId provided by the UI (always current)
-      // The UI has the authoritative snapshot ID from the current location
+      // The source ID identifies saved guidance and the conversation context.
+      // Current Coach location is independently supplied and verified above.
       if (snapshotId) activeSnapshotId = snapshotId;
       
@@ -736,5 +763,5 @@ router.post('/', requireAuth, async (req, res) => {
           console.log('[COACH] Resolved strategy_id to snapshot_id:', activeSnapshotId);
         }
-      } else {
+      } else if (!coachSnapshot) {
         // 2026-03-17: SECURITY FIX (F-6) — Use authenticated userId, not body userId.
         // Previously req.body.userId was used as fallback, allowing any authenticated
@@ -743,5 +770,5 @@ router.post('/', requireAuth, async (req, res) => {
           .select({ snapshot_id: snapshots.snapshot_id })
           .from(snapshots)
-          .where(eq(snapshots.user_id, authUserId))
+          .where(sql`${snapshots.user_id} = ${authUserId} AND COALESCE(${snapshots.permissions}->>'context_kind', '') <> 'coach'`)
           .orderBy(desc(snapshots.created_at))
           .limit(1);
@@ -759,10 +786,19 @@ router.post('/', requireAuth, async (req, res) => {
         const owned = await verifySnapshotOwnership(activeSnapshotId, authUserId);
         if (!owned.ok) return res.status(owned.status).json(owned.body);
+        if (owned.snapshot?.permissions?.context_kind === 'coach') {
+          coachContextRequested = true;
+          coachSnapshot ??= await readOwnedCoachSnapshot(req.auth, activeSnapshotId);
+          activeSnapshotId = null;
+        }
       }
 
       // Get COMPLETE context using CoachDAL (full schema access)
       // Pass authenticated user ID for driver profile lookup (in case snapshot has different/null user_id)
-      if (activeSnapshotId) {
-        fullContext = await rideshareCoachDAL.getCompleteContext(activeSnapshotId, null, authUserId !== 'anonymous' ? authUserId : null);
+      if (activeSnapshotId || coachSnapshot) {
+        fullContext = await rideshareCoachDAL.getCompleteContext(activeSnapshotId, null, authUserId, { coachSnapshot });
+        if (coachContextRequested && (!fullContext?.snapshot || fullContext.status === 'error' ||
+            fullContext.snapshot.snapshot_id !== coachSnapshot?.snapshot_id)) {
+          throw Object.assign(new Error('Coach location context could not be read.'), { status: 503, code: 'coach_context_unavailable' });
+        }
         contextInfo = rideshareCoachDAL.formatContextForPrompt(fullContext)
           + formatCoachSourceContext(fullContext.snapshot, fullContext.briefing, fullContext);
@@ -837,4 +873,5 @@ router.post('/', requireAuth, async (req, res) => {
       }
     } catch (err) {
+      if (coachContextRequested || coachSnapshot || err.name === 'MainRunAdmissionError') throw err;
       console.warn('[COACH] Could not fetch context:', err.message);
       contextInfo = '\n\nContext temporarily unavailable';
@@ -879,5 +916,6 @@ router.post('/', requireAuth, async (req, res) => {
             city: fullContext.snapshot.city,
             state: fullContext.snapshot.state,
-            country: fullContext.snapshot.country
+            country: fullContext.snapshot.country,
+            ...(coachSnapshot && { coach_snapshot_id: coachSnapshot.snapshot_id })
           } : null,
           time_context: {
@@ -907,4 +945,12 @@ You are much more than just a rideshare assistant. You're a frontier AI model wi
 **Your Capabilities:**
 
+**Independent Coach location:**
+- Activating Coach attempts one fresh device GPS and Google capture without running the MAIN pipeline. A failed capture remains explicitly unavailable or historical; do not assume activation succeeded without a supplied observation.
+- Your Coach snapshot records GPS, location, timezone, weather and air at its capture time. It is independent of Strategy and Briefing; refreshing it does not regenerate either.
+- When location-dependent advice needs a newer observation, the driver says they moved, or the snapshot is missing/stale for the question, request one device capture: \`[REFRESH_COACH_SNAPSHOT: {"reason":"Why current location is needed"}]\`.
+- Supply only the reason, never coordinates. The app attempts GPS and Google capture after this reply completes. Say that a refresh was requested, not that it succeeded, and do not invent the new location or current incidents while capture is pending.
+- After a successful requested capture, the app may run one answer-only continuation of the driver's original question using that verified Coach observation. Use your own web search to check current incidents or destination facts when needed. That continuation must not request another refresh or replay any action. Unrelated questions do not require capture.
+- Saved Briefing, Strategy and venue records retain their original source location and timestamps. Do not treat older or different-city evidence as newly verified local conditions.
+
 👁️ **Vision & Image Analysis:**
 - Analyze screenshots of apps (Uber, Lyft, earnings, maps, heatmaps)
@@ -1266,5 +1312,5 @@ Full transparency. Maximum insight.
     try {
       const { callModelStream } = await import('../../lib/ai/adapters/index.js');
-      if (answerOnly) systemPrompt += '\n\nANSWER-ONLY RECONCILIATION: Read current records and answer the latest continued or corrected request. Do not emit action tags, save notes, learn tips, or change any data. Do not repeat earlier actions. If a new or changed action is needed, explain its current confirmed state and ask for a fresh confirmation. Conversation history is still recorded.';
+      if (answerOnly) systemPrompt += '\n\nANSWER-ONLY RECONCILIATION: Read current records and answer the latest continued or corrected request. Use web search when the question needs current incident or destination verification; a new GPS observation alone does not verify an accident. Do not request another Coach snapshot refresh, emit action tags, save notes, learn tips, or change any data. Do not repeat earlier actions. If a new or changed action is needed, explain its current confirmed state and ask for a fresh confirmation. Conversation history is still recorded.';
       const roleConfig = getRoleConfig('AI_COACH');
       let totalText = '';
@@ -1314,5 +1360,5 @@ Full transparency. Maximum insight.
           // DB writes are sub-50ms each; minor latency is worth guaranteed feedback.
           try {
-            actionsResult = await executeActions(actions, authUserId, activeSnapshotId, conversationId, ac.signal, req.auth, fullContext?.offerRules);
+            actionsResult = await executeActions(actions, authUserId, activeSnapshotId, conversationId, ac.signal, req.auth, fullContext?.offerRules, fullContext?.snapshot);
             if (actionsResult.saved > 0) {
               console.log(`[COACH] Executed ${actionsResult.saved} actions`);
@@ -1377,5 +1423,6 @@ Full transparency. Maximum insight.
                 city: fullContext.snapshot.city,
                 state: fullContext.snapshot.state,
-                country: fullContext.snapshot.country
+                country: fullContext.snapshot.country,
+                ...(coachSnapshot && { coach_snapshot_id: coachSnapshot.snapshot_id })
               } : null
             });
@@ -1414,5 +1461,5 @@ Full transparency. Maximum insight.
     
     if (!res.headersSent) {
-      return res.status(500).json({ error: error.message });
+      return res.status(error.status || 500).json({ error: error.code || error.message, message: error.message });
     } else {
       res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
```

## server/lib/ai/rideshare-coach-dal.js

```diff
diff --git a/tmp/astra-coach-snapshot-context-before-20261012/rideshare-coach-dal.js b/server/lib/ai/rideshare-coach-dal.js
index 8d8f4176..68a72caf 100644
--- a/tmp/astra-coach-snapshot-context-before-20261012/rideshare-coach-dal.js
+++ b/server/lib/ai/rideshare-coach-dal.js
@@ -74,5 +74,6 @@ function weatherTemperature(weather) {
  * 
  * Entry Point: strategy_id (visible on UI)
- * Access Pattern: strategy_id → snapshot_id → user_id + session_id → ALL tables
+ * Saved guidance uses its original snapshot_id. An independently verified Coach
+ * snapshot can supply current location without moving that saved guidance.
  * 
  * Access contract:
@@ -80,5 +81,5 @@ function weatherTemperature(weather) {
  * - Full read access to entire schema (no mutations)
  * - Null-safe reads (missing data returns null, not errors)
- * - Temporal alignment: Trust snapshot day/time as ground truth
+ * - Temporal alignment: preserve observation times and source identities
  */
 // 2026-09-11 (desktop-coach-review item 4, verified in the current tree): the DATA ACCESS
@@ -160,11 +161,11 @@ export class RideshareCoachDAL {
    * @returns {Promise<Object|null>} Snapshot context or null
    */
-  async getHeaderSnapshot(snapshotId) {
+  async getHeaderSnapshot(snapshotId, savedSnapshot = null) {
     try {
-      const [snap] = await db
+      const snap = savedSnapshot ?? (await db
         .select()
         .from(snapshots)
         .where(eq(snapshots.snapshot_id, snapshotId))
-        .limit(1);
+        .limit(1))[0];
 
       if (!snap) return null;
@@ -816,5 +817,5 @@ export class RideshareCoachDAL {
    * @returns {Promise<Object>} Complete coach context with full schema access
    */
-  async getCompleteContext(snapshotId, strategyId, authenticatedUserId = null) {
+  async getCompleteContext(snapshotId, strategyId, authenticatedUserId = null, { coachSnapshot = null } = {}) {
     try {
       // Resolve strategy_id to snapshot_id if needed
@@ -840,5 +841,5 @@ export class RideshareCoachDAL {
       // Fetch all schema data in parallel (first batch)
       const [
-        snapshot,
+        sourceSnapshot,
         strategy,
         briefing,
@@ -848,12 +849,28 @@ export class RideshareCoachDAL {
         driverActions
       ] = await Promise.all([
-        this.getHeaderSnapshot(activeSnapshotId),
-        this.getLatestStrategy(activeSnapshotId),
-        this.getComprehensiveBriefing(activeSnapshotId),
-        this.getSmartBlocks(activeSnapshotId),
-        this.getFeedback(activeSnapshotId),
-        this.getVenueData(activeSnapshotId),
-        this.getActions(activeSnapshotId),
+        activeSnapshotId ? this.getHeaderSnapshot(activeSnapshotId) : null,
+        activeSnapshotId ? this.getLatestStrategy(activeSnapshotId) : null,
+        activeSnapshotId ? this.getComprehensiveBriefing(activeSnapshotId) : { exists: false, source_state: 'missing', status: null, source_record: null },
+        activeSnapshotId ? this.getSmartBlocks(activeSnapshotId) : [],
+        activeSnapshotId ? this.getFeedback(activeSnapshotId) : { venue_feedback: [], strategy_feedback: [] },
+        activeSnapshotId ? this.getVenueData(activeSnapshotId) : [],
+        activeSnapshotId ? this.getActions(activeSnapshotId) : [],
       ]);
+      // Only the authenticated route supplies this independently verified row.
+      // All saved guidance above remains scoped to its original source ID.
+      const snapshot = coachSnapshot
+        ? await this.getHeaderSnapshot(coachSnapshot.snapshot_id, coachSnapshot) : sourceSnapshot;
+      const savedContextSource = coachSnapshot ? {
+        source_state: sourceSnapshot ? 'historical_saved_context' : 'unavailable',
+        snapshot_id: sourceSnapshot?.snapshot_id ?? null,
+        coach_snapshot_id: coachSnapshot.snapshot_id,
+        observed_at: contextTimestamp(sourceSnapshot?.created_at),
+        briefing_generated_at: contextTimestamp(briefing?.generated_at),
+        briefing_generation_token: briefing?.source_record?.generation_token ?? null,
+        location: sourceSnapshot ? { city: sourceSnapshot.city, state: sourceSnapshot.state, country: sourceSnapshot.country, timezone: sourceSnapshot.timezone } : null,
+        geography_matches: sourceSnapshot ? ['city', 'state', 'country'].every(field =>
+          typeof sourceSnapshot[field] === 'string' && typeof snapshot[field] === 'string' &&
+          sourceSnapshot[field].trim().toLowerCase() === snapshot[field].trim().toLowerCase()) : null,
+      } : null;
 
       // Fetch market intelligence, user notes, and driver profile (depends on snapshot for city/state/user_id)
@@ -904,4 +921,5 @@ export class RideshareCoachDAL {
       const context = {
         snapshot,
+        ...(coachSnapshot && { sourceSnapshot, savedContextSource }),
         strategy,
         briefing,
@@ -920,5 +938,5 @@ export class RideshareCoachDAL {
         coachMemos,               // 2026-05-26: Coach's own prior memos about this driver
         coachSystemNotes,         // 2026-05-26: Coach's system-level observations for this driver
-        status: this._determineStatus(snapshot, strategy, briefing, smartBlocks),
+        status: coachSnapshot ? 'coach_context' : this._determineStatus(snapshot, strategy, briefing, smartBlocks),
       };
       return { ...context, progress: getCoachContextProgress(context) };
@@ -1103,4 +1121,5 @@ export class RideshareCoachDAL {
       if (snapshot.is_weekend) prompt += ` [WEEKEND]`;
       prompt += `\n🌍 Timezone: ${snapshot.timezone}`;
+      prompt += `\n   Observation captured: ${contextTimestamp(snapshot.created_at) || 'unknown time'}; this is not continuous tracking.`;
 
       // Weather
@@ -1120,8 +1139,13 @@ export class RideshareCoachDAL {
       }
 
+      if (context.savedContextSource) {
+        prompt += `\n\n=== HISTORICAL SAVED GUIDANCE SOURCE ===\n${JSON.stringify(context.savedContextSource)}`;
+        prompt += '\nThe following saved Briefing, Strategy and venue data belong to that original source, not the current Coach observation. Different geography does not establish local conditions here. Saved venue distance/drive time describe the old origin; do not reuse them as current travel estimates.';
+      }
+
       // Airport Conditions - now in briefings.airport_conditions (not snapshot)
       // 2026-01-14: airport_context dropped from snapshots, get from briefing if passed
       if (briefing?.airport_conditions?.airports && briefing.airport_conditions.airports.length > 0) {
-        prompt += `\n\n✈️  AIRPORT CONDITIONS (30-mile radius)`;
+        prompt += `\n\n✈️  SAVED AIRPORT CONDITIONS (source's 30-mile radius)`;
         briefing.airport_conditions.airports.slice(0, 3).forEach(a => {
           prompt += `\n   ${a.name || 'Unknown'} (${a.code || 'N/A'}): ${a.distance_miles?.toFixed(1) || 'N/A'}mi`;
@@ -1134,5 +1158,5 @@ export class RideshareCoachDAL {
       // errorMarker/failed sections never claim a holiday)
       if (briefing?.holiday?.is_holiday === true && !briefing.holiday._generationFailed) {
-        prompt += `\n\n🎉 SPECIAL DATE: ${briefing.holiday.holiday} (surge likely)`;
+        prompt += `\n\n🎉 SAVED SOURCE SPECIAL DATE: ${briefing.holiday.holiday}`;
       }
     }
@@ -1150,7 +1174,7 @@ export class RideshareCoachDAL {
     // ========== COMPREHENSIVE BRIEFING (API Data + Perplexity + GPT-5) ==========
     if (briefing && Object.keys(briefing).length > 0) {
-      // REAL-TIME API DATA
+      // Saved API observations retain the Briefing's original generation time.
       if (briefing.weather_current) {
-        prompt += `\n\n🌤️  REAL-TIME WEATHER (from Google Weather API)`;
+        prompt += `\n\n🌤️  SAVED BRIEFING WEATHER (from Google Weather API)`;
         const w = briefing.weather_current;
         prompt += `\n   Current: ${weatherTemperature(w)}`;
@@ -1169,5 +1193,5 @@ export class RideshareCoachDAL {
 
       if (briefing.traffic_conditions) {
-        prompt += `\n\nREAL-TIME TRAFFIC CONDITIONS`;
+        prompt += `\n\nSAVED BRIEFING TRAFFIC CONDITIONS`;
         prompt += `\n   Level: ${briefing.traffic_conditions.congestionLevel || 'N/A'}`;
         prompt += `\n   Summary: ${briefing.traffic_conditions.summary || 'N/A'}`;
@@ -1202,5 +1226,5 @@ export class RideshareCoachDAL {
     // ========== SMART BLOCKS (Location Recommendations) ==========
     if (smartBlocks && smartBlocks.length > 0) {
-      prompt += `\n\n📍 RECOMMENDED LOCATIONS (Top ${Math.min(smartBlocks.length, 6)})`;
+      prompt += `\n\n📍 SAVED RECOMMENDED LOCATIONS (Top ${Math.min(smartBlocks.length, 6)})`;
       smartBlocks.slice(0, 6).forEach((block, i) => {
         prompt += `\n   ${i + 1}. ${block.name}`;
```

## server/lib/ai/coach-source-context.js

```diff
diff --git a/tmp/astra-coach-snapshot-context-before-20261012/coach-source-context.js b/server/lib/ai/coach-source-context.js
index 9c1aa6d0..4f4ccf6b 100644
--- a/tmp/astra-coach-snapshot-context-before-20261012/coach-source-context.js
+++ b/server/lib/ai/coach-source-context.js
@@ -27,9 +27,11 @@ function navigationContext(context) {
 }
 
-function schoolCalendarContext(snapshot, briefing) {
+function schoolCalendarContext(snapshot, briefing, savedContextSource = null) {
   const timezone = typeof snapshot?.timezone === 'string' ? snapshot.timezone : null;
   let localDate = null;
   try { localDate = getLocalDateString(new Date(), timezone); } catch { /* No timezone fallback. */ }
-  const source = { source_state: 'derived_from_saved_dates', local_date: localDate, timezone };
+  const source = { source_state: 'derived_from_saved_dates', local_date: localDate, timezone,
+    ...(savedContextSource && { source_snapshot_id: savedContextSource.snapshot_id,
+      source_location: savedContextSource.location, geography_matches: savedContextSource.geography_matches }) };
   const unavailable = (status, reason) => ({ ...source, status, reason, items: null });
   if (briefing?.source_state === 'read_failed' || briefing?.status === 'read_failed') {
@@ -83,7 +85,15 @@ are separate; a saved strategy is not automatically current advice. Do not wait
 for Strategy to finish to discuss available evidence, but identify missing or
 failed inputs and avoid claiming that generation succeeded.
+When saved_context_source is supplied, snapshot is the separate Coach location
+observation. source_snapshot, Briefing, Strategy and destinations retain their
+original IDs, geography and timestamps as historical context. They were not
+regenerated by refreshing Coach. A different source city does not establish
+conditions in the Coach location. Use the Coach snapshot for current geography,
+weather, air and timezone; its capture time still limits freshness.
 A Strategy is current only when its saved strategy_source receipt matches the
 supplied Briefing generation. A newer updated_at caused by venue progress cannot
 establish that match. Treat unverified or superseded text as historical context.
+A matching receipt proves source lineage, not present-day relevance or suitability
+for a different Coach location; saved_context_source remains historical.
 Stored offer decisions belong to the Offer Analyzer. Discuss their evidence and
 longitudinal patterns; never OCR a new offer or issue a new ACCEPT/REJECT/CANCEL
@@ -104,4 +114,6 @@ rate columns or mixed-history averages as verified full-trip profitability.
 school_calendar_context classifies saved calendar dates for local_date, not a fresh lookup;
 reopening_today means students return today, not currently closed. Raw records remain historical evidence.
+Its geography_matches field must not be ignored: false or unknown cannot establish
+closures near the current Coach location, even when dates match today.
 navigation_context contains directions URLs built from saved Smart Block destination evidence.
 Copy a matching directions_url exactly. It is not a fresh place, opening-hours or route verification;
@@ -109,6 +121,10 @@ missing destinations stay unavailable. Venue websites and research sources are s
 ${JSON.stringify({
     snapshot: snapshotRecord,
+    ...(context.savedContextSource && {
+      source_snapshot: context.sourceSnapshot?.source_record ?? context.sourceSnapshot ?? null,
+      saved_context_source: context.savedContextSource,
+    }),
     briefing: record,
-    school_calendar_context: schoolCalendarContext(snapshotRecord, record),
+    school_calendar_context: schoolCalendarContext(snapshotRecord, record, context.savedContextSource),
     navigation_context: navigationContext(context),
     strategy: context.strategy ?? null,
```

## docs/architecture/RIDESHARE_COACH.md

```diff
diff --git a/tmp/astra-coach-snapshot-context-before-20261012/RIDESHARE_COACH.md b/docs/architecture/RIDESHARE_COACH.md
index 4085140d..d3216876 100644
--- a/tmp/astra-coach-snapshot-context-before-20261012/RIDESHARE_COACH.md
+++ b/docs/architecture/RIDESHARE_COACH.md
@@ -6,6 +6,6 @@ repository and synthetic regression results; it is not a deployment, microphone,
 provider-availability or live-database certification.
 
-October 12 source update: the settings action and client receipt path below add
-Melody's requested Offer Analyzer tuning. This is a repository contract; the
+October 12 source update: the settings action, independent Coach snapshot and
+client receipt paths below implement Melody's requested behavior. This is a repository contract; the
 historical test counts at the end remain scoped to their dated review.
 
@@ -25,4 +25,5 @@ Coach must not run a second live offer analyzer or silently tune between turns.
 | `POST /api/chat` | [chat.js](../../server/api/chat/chat.js), authenticated canonical brain and action executor. Body `userId` is not authorization. |
 | `GET /api/chat/context/:snapshotId` | Same router, snapshot ownership required. `summary=1` returns source progress and timestamps without a model call. |
+| `GET/POST /api/coach/snapshot` | [Independent capture](../../server/lib/location/coach-snapshot.js), authenticated current-session GPS and Google observation. It does not change MAIN pointers or generate Briefing/Strategy. |
 | `POST /api/chat/voice-turns` | Same router, authenticated capture of live transcripts; validates bounded turns and snapshot ownership. |
 | `/api/coach/{notes,memos,schema,validate}` | [rideshare-coach/index.js](../../server/api/rideshare-coach/index.js) mounts authenticated note CRUD, memo receipts, schema metadata and validation. |
@@ -41,5 +42,5 @@ entry points, not two executors for one generated action.
 
 1. [useCoachChat](../../client/src/hooks/coach/useCoachChat.ts) admits one request
-   synchronously, posts message/history/attachments and snapshot/strategy IDs,
+   synchronously, posts message/history/attachments, saved source snapshot/strategy IDs and a separate `coachSnapshotId`,
    and fences asynchronous results when identity, snapshot or component changes.
    [useCanonicalVoiceSend](../../client/src/hooks/coach/useCanonicalVoiceSend.ts)
@@ -48,13 +49,15 @@ entry points, not two executors for one generated action.
 2. `POST /api/chat` checks authentication and request shape before writes/provider
    use. Conversation IDs are UUIDs; histories and attachment arrays are validated.
-   Snapshot resolution is explicit snapshot ID, then strategy ID resolution, then
-   latest snapshot owned by the authenticated user. Supplied IDs pass ownership
-   checks before context loads.
+   Saved source resolution is explicit snapshot ID, then strategy ID resolution.
+   Without an independent Coach observation, the legacy fallback selects the latest
+   owned non-Coach snapshot. An explicit Coach ID is verified separately for owner,
+   live session, purpose and complete source receipts; rejected IDs never fall back.
 3. [RideshareCoachDAL.getCompleteContext](../../server/lib/ai/rideshare-coach-dal.js)
-   reads seven snapshot-scoped branches concurrently: snapshot, Strategy,
-   Briefing, Smart Blocks, feedback, venue data and actions. Once the snapshot is
-   available, it reads owner profile/active primary vehicle, notes, recent offers,
+   reads saved source branches concurrently: snapshot, Strategy, Briefing, Smart
+   Blocks, feedback, venue data and actions. A verified independent Coach row
+   supplies current location/time/weather/air; saved guidance retains its original
+   ID and source snapshot. Once location is available, it reads owner profile/active primary vehicle, notes, recent offers,
    historical Coach decisions, prior memos/system notes, longitudinal patterns,
-   and market intelligence. `getOfferRules` rereads current saved owner rules.
+   and market intelligence for the current Coach city. `getOfferRules` rereads current saved owner rules.
 4. `formatContextForPrompt` supplies readable summaries. Snapshot wind retains
    its measured unit; Briefing numeric temperature/wind, display units and zero
@@ -62,4 +65,6 @@ entry points, not two executors for one generated action.
    includes complete saved snapshot/Briefing/Strategy/offer/rules/profile/vehicle
    records as data, with explicit provenance and missing/failed-state cautions.
+   `source_snapshot` and `saved_context_source` identify older guidance separately;
+   different-city data and old route distances do not establish current conditions.
    Strategy is read independently of Briefing; a Briefing read failure must not
    erase saved Strategy. A current Strategy requires its source receipt to match
@@ -67,6 +72,7 @@ entry points, not two executors for one generated action.
 5. An owned saved snapshot's timezone supersedes the browser copy. A missing or
    invalid timezone on that saved row returns `TIMEZONE_REQUIRED`. The existing
-   no-saved-snapshot branch can use the browser timezone hint, but has no verified
-   saved location context. This review did not introduce before-GPS coaching.
+   no-saved-snapshot legacy branch can use the browser timezone hint, but has no
+   verified saved location context. A failed independent Coach context read cannot
+   use that fallback or client-supplied Strategy.
 6. The route adds snapshot history, zone intelligence and applicable operator
    context, saves the user's message, and builds the prompt plus conversation
@@ -134,4 +140,38 @@ Planner prompts. See [Offer Analyzer](OFFER_ANALYZER.md#15-coach-integration).
 | `COACH_MEMO` | `coach_memos` primary receipt, plus a best-effort workspace inbox append |
 | `UPDATE_OFFER_RULES` | Owner's existing `offer_rulesets` row through the same canonical writer as the Offer Analyzer editor |
+| `REFRESH_COACH_SNAPSHOT` | No server action write: requests one client GPS/Google capture after a completed response |
+
+### Independent Coach snapshot
+
+Activating Coach attempts one fresh device capture. Later, the driver can refresh
+it or Coach can request a refresh when the driver has moved or a question needs
+new location evidence. The existing deterministic collector supplies GPS, Google
+geocoding/timezone/weather/air and source receipts. Each completed observation is
+an immutable `snapshots` row with `permissions.context_kind = 'coach'`, bound to
+the current authenticated user and session. No schema change, MAIN admission,
+MAIN pointer replacement, Briefing generation or Strategy generation is involved.
+
+`coachSnapshotId` is separate from the existing conversation/saved-source
+`snapshotId`. New observation IDs do not reset the conversation. Current Coach
+geography drives market lookup and the clock; saved Briefing, Strategy, Schools
+and destinations retain their original geography, IDs, generation receipts and
+timestamps. Schools dates are classified using the current Coach local date,
+with an explicit geography-match field; old-city calendars do not prove nearby
+closures. Progress timestamps carry each source's own timezone. The observation
+time is the GPS receipt, not the time the UI read it.
+
+`REFRESH_COACH_SNAPSHOT` accepts only one nonempty reason, with no coordinates.
+A completed non-answer-only turn returns
+`actions_result.coach_snapshot_refresh = { requested: true, reason }` and does not
+increment the saved-action count. Interrupted, invalid and answer-only requests
+cannot trigger capture. The model must describe the pending request honestly;
+only the later device/provider receipt establishes a refreshed observation.
+
+After a successful model-requested capture, one bounded answer-only continuation
+answers the original question using the new Coach ID. It may use web search for
+current accident or destination evidence; GPS/weather alone do not verify an
+incident. It cannot request another refresh or replay writes. Capture failure
+remains visible and does not start that continuation. This never enters MAIN.
+See the [preserved prior contract](removals/2026-10-12-coach-snapshot-context.md).
 
 ### User-directed Offer Analyzer tuning
```

## Additional replaced source statements

The earlier progress fields used collection time and carried no per-source timezone:

```js
    snapshot: { state: !snapshot ? 'missing' : snapshotReadiness.ready ? 'complete' : 'partial', observed_at: contextTimestamp(snapshot?.created_at || snapshot?.iso_timestamp) },
    strategy: { state: strategyContextState(strategy, briefing), created_at: contextTimestamp(strategy?.created_at), updated_at: contextTimestamp(strategy?.updated_at || strategy?.strategy_timestamp) },
    briefing: { state: briefingState, generated_at: contextTimestamp(briefing?.generated_at), updated_at: contextTimestamp(briefing?.source_record?.updated_at) },
```

The preceding Coach definition is retained verbatim:

```markdown
| **Coach** | The independent assistant using owned saved context, conversation and longitudinal evidence. It can explain scenarios and tune existing Offer Analyzer controls when the driver asks, using saved offer evidence and canonical validated, versioned rules writes. Confirmed changes require a durable receipt; advice alone does not authorize a write. It preserves earlier decisions and outcomes, does not issue a fresh live Offer Analyzer decision, and does not start Strategy automatically. | [Coach contract](docs/architecture/RIDESHARE_COACH.md#user-directed-offer-analyzer-tuning) |
```

## Snapshot introduction corrected during release review

The canonical `SNAPSHOT.md` introduction still defined every observation as an
admitted MAIN capture. Its replacement distinguishes prepared MAIN evidence from
independent Coach observations and directs readers to the current lifecycle maps.
The September 29 lifecycle detail remains labeled as historical. Removed text:

```text
A snapshot is the driver's saved point-in-time location and measured current
environment for **one explicit MAIN admission**. It is deterministic source
material for downstream work, not a model-generated summary or a browser
cache. Guidance must not mix an old session, a new GPS callback and another
run's weather or preferences.
```

