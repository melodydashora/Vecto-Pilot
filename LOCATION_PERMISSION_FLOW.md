# Location Permission Flow - Implementation Guide

## Overview
This document explains how Vecto Pilot handles location permissions and GPS requests across browser sessions.

## Key Implementation Details

### 1. Permission States

**Browser Permission States:**
- `granted` - User has allowed location access
- `prompt` - User hasn't decided yet (browser will show dialog)
- `denied` - User has blocked location access

### 2. Fresh Location Requests

**Critical Configuration:**
```javascript
// client/src/hooks/useGeoPosition.ts
navigator.geolocation.getCurrentPosition(
  successCallback,
  errorCallback,
  {
    enableHighAccuracy: true,  // Request most precise GPS
    timeout: 7000,             // 7-second timeout
    maximumAge: 0              // CRITICAL: Always request fresh location
  }
);
```

**Why `maximumAge: 0` is Critical:**
- Forces browser to request fresh GPS coordinates
- Ensures permission prompt appears if not yet granted
- Prevents using stale cached location data
- Required for location refresh to work properly

### 3. Browser Reopen Behavior

**What Happens When User Reopens Browser:**

```typescript
// On component mount (useGeoPosition hook)
useEffect(() => {
  if (isFirstMount && !hasLoadedOnce) {
    setTimeout(() => {
      fetchPosition(); // Requests fresh location
    }, 100);
  }
}, []);
```

**Behavior by Permission State:**
- **Permission already granted:** Location fetched immediately (no dialog)
- **Permission "prompt":** Browser shows permission dialog
- **Permission denied:** Error shown with helpful message

### 4. Session & Identity Persistence

**localStorage Keys:**
```typescript
vecto_user_id       // Persists forever
vecto_device_id     // Persists forever
vecto_session_id    // Persists for 30 minutes
```

**Important:** Browser location permission is **separate** from these IDs. A user can have the same user_id but different permission states.

### 5. Abort Controller (Race Condition Prevention)

**When GPS coordinates update:**
```javascript
// 1. GPS coordinates received
if (coords) {
  // 2. Clear old strategy
  localStorage.removeItem('vecto_persistent_strategy');
  
  // 3. Abort stale enrichment requests
  enrichmentControllerRef.current?.abort();
  
  // 4. Create new AbortController
  enrichmentControllerRef.current = new AbortController();
  
  // 5. Start fresh enrichment (weather, city, air quality)
  Promise.all([
    fetch('/api/location/resolve', { signal }),
    fetch('/api/location/weather', { signal }),
    fetch('/api/location/airquality', { signal })
  ]);
}
```

**What Gets Aborted:**
- ❌ **NOT GPS request** (already completed)
- ✅ Weather API calls from previous location
- ✅ City resolution API calls from previous location
- ✅ Air quality API calls from previous location

**Why This Matters:**
Prevents race condition where:
1. User at Location A → enrichment starts
2. User moves to Location B → new enrichment starts
3. Location A enrichment completes **after** Location B
4. Result: User sees wrong data ❌

With abort:
1. User at Location A → enrichment starts
2. User moves to Location B → Location A aborted ✅
3. Only Location B data completes
4. Result: User sees correct current location ✅

## Testing Guide

### Test 1: Fresh Browser Session
```bash
# Clear all localStorage
localStorage.clear();
location.reload();

# Expected:
# - New user_id, device_id, session_id generated
# - Location permission dialog appears (if not previously granted)
# - GPS coordinates requested with maximumAge: 0
```

### Test 2: Browser Reopen (Permission Already Granted)
```bash
# Close browser completely, reopen
# Expected:
# - Same user_id, device_id persisted
# - New session_id (if >30min elapsed)
# - NO permission dialog (permission already granted)
# - Fresh GPS coordinates fetched (maximumAge: 0)
```

### Test 3: Force Fresh Session (DEV Button)
```javascript
// Click "Trash" icon in header (DEV mode only)
// Expected:
// - All localStorage cleared
// - Page reloads
// - New identities generated
// - Permission dialog appears
```

## Common Issues

### Issue: "Permission dialog not appearing"
**Cause:** Permission already granted in previous session
**Solution:** This is normal! Location is still being fetched fresh.
**Verify:** Check console for `"✅ Browser geolocation success:"`

### Issue: "Location not updating on refresh"
**Cause:** Cached location data (maximumAge > 0)
**Solution:** Verify `maximumAge: 0` in getCurrentPosition options

### Issue: "Abort error in console"
**Cause:** Enrichment requests aborted when new location arrives
**Solution:** This is intentional! Prevents stale data race conditions.

## Developer Tools

### DEV Mode Button (Trash Icon)
- **Location:** GlobalHeader component (top right)
- **Visibility:** Only shown when `import.meta.env.DEV === true`
- **Action:** Clears all localStorage and reloads
- **Use Case:** Simulate brand new user opening app

### Console Debugging
```javascript
// Check permission status
navigator.permissions.query({ name: 'geolocation' })
  .then(status => console.log('Permission:', status.state));

// Check stored IDs
console.log('User ID:', localStorage.getItem('vecto_user_id'));
console.log('Device ID:', localStorage.getItem('vecto_device_id'));
console.log('Session ID:', localStorage.getItem('vecto_session_id'));

// Force fresh location request
navigator.geolocation.getCurrentPosition(
  pos => console.log('✅ Position:', pos.coords),
  err => console.error('❌ Error:', err),
  { maximumAge: 0, enableHighAccuracy: true }
);
```

## Summary

✅ **Location permission is requested:**
- On first app load (if not yet granted)
- On browser reopen (if permission state = "prompt")
- On manual refresh (maximumAge: 0 ensures fresh request)

✅ **Abort controller is working correctly:**
- Only aborts enrichment API calls (weather, city, air)
- Does NOT abort GPS request
- Prevents stale data race conditions

✅ **Fresh location data guaranteed:**
- `maximumAge: 0` forces fresh GPS coordinates
- No cached location reuse
- Permission dialog appears when needed
