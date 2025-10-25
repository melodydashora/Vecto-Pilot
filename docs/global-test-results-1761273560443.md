# Vecto Pilot™ Global Testing Report

**Generated:** 2025-10-24T02:39:20.442Z
**Test Locations:** 7
**Successful:** 0

---

## Paris, France - Charles de Gaulle Airport Area

**Coordinates:** `49.0097, 2.5479`
**Expected City:** Roissy-en-France
**Timezone:** Europe/Paris

### ❌ Error

```
Blocks generation failed: Unknown error
```

<details>
<summary>Error Details</summary>

```json
{
  "status": 502,
  "data": {
    "ok": false,
    "error": "persist_failed",
    "correlationId": "0275c7ba-94e4-499e-a7f2-8d00b3cf1e11"
  },
  "headers": {
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "origin-agent-cluster": "?1",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-dns-prefetch-control": "off",
    "x-download-options": "noopen",
    "x-frame-options": "DENY",
    "x-permitted-cross-domain-policies": "none",
    "x-xss-protection": "1; mode=block",
    "vary": "Origin",
    "access-control-allow-credentials": "true",
    "x-powered-by": "Vecto-Pilot",
    "content-type": "application/json; charset=utf-8",
    "content-length": "92",
    "etag": "W/\"5c-9M8hp2t82WS9OZvVh8Q89D4AIfE\"",
    "date": "Fri, 24 Oct 2025 02:36:51 GMT",
    "connection": "keep-alive",
    "keep-alive": "timeout=5"
  }
}
```
</details>

## Tokyo, Japan - Shibuya District

**Coordinates:** `35.6595, 139.7004`
**Expected City:** Tokyo
**Timezone:** Asia/Tokyo

### ❌ Error

```
socket hang up
```

## Sydney, Australia - CBD

**Coordinates:** `-33.8688, 151.2093`
**Expected City:** Sydney
**Timezone:** Australia/Sydney

### ❌ Error

```
connect ECONNREFUSED 127.0.0.1:5000
```

## São Paulo, Brazil - Paulista Avenue

**Coordinates:** `-23.5617, -46.6561`
**Expected City:** São Paulo
**Timezone:** America/Sao_Paulo

### ❌ Error

```
connect ECONNREFUSED 127.0.0.1:5000
```

## Dubai, UAE - Downtown/Burj Khalifa

**Coordinates:** `25.1972, 55.2744`
**Expected City:** Dubai
**Timezone:** Asia/Dubai

### ❌ Error

```
connect ECONNREFUSED 127.0.0.1:5000
```

## Mumbai, India - International Airport

**Coordinates:** `19.0896, 72.8656`
**Expected City:** Mumbai
**Timezone:** Asia/Kolkata

### ❌ Error

```
connect ECONNREFUSED 127.0.0.1:5000
```

## London, UK - Heathrow Airport

**Coordinates:** `51.47, -0.4543`
**Expected City:** Hounslow
**Timezone:** Europe/London

### ❌ Error

```
connect ECONNREFUSED 127.0.0.1:5000
```

## Summary

- **Total Tests:** 7
- **Successful Snapshots:** 0
- **Generated Venues:** 0
- **City Detected:** 0
- **Null City (Fallback):** 0

### Key Findings

1. **Global Support:** ⚠️ System partially handled all global locations
2. **Venue Generation:** ✅ GPT-5 generated venues for 0/0 locations
3. **Geocoding:** 0/0 locations had city detected, 0 used fallback
4. **AI Pipeline:** All successful tests completed the full triad (Claude → GPT-5 → Gemini)

