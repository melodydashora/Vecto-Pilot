# Vecto Pilot™ Global Testing Report

**Generated:** 2025-10-24T02:32:37.010Z
**Test Locations:** 7
**Successful:** 0

---

## Paris, France - Charles de Gaulle Airport Area

**Coordinates:** `49.0097, 2.5479`
**Expected City:** Roissy-en-France
**Timezone:** Europe/Paris

### ❌ Error

```
Snapshot creation failed
```

<details>
<summary>Error Details</summary>

```json
{
  "status": 500,
  "data": {
    "ok": false,
    "error": "snapshot_failed",
    "message": "Failed query: insert into \"strategies\" (\"id\", \"snapshot_id\", \"correlation_id\", \"strategy\", \"status\", \"error_code\", \"error_message\", \"attempt\", \"latency_ms\", \"tokens\", \"next_retry_at\", \"created_at\", \"updated_at\", \"model_name\", \"model_params\", \"prompt_version\", \"strategy_for_now\") values (default, $1, default, default, $2, default, default, $3, default, default, default, $4, $5, default, default, default, default) on conflict (\"snapshot_id\") do update set \"attempt\" = \"strategies\".\"attempt\" + 1, \"updated_at\" = $6\nparams: c7b05513-400f-4833-816c-b5e9b88f2eaf,pending,1,2025-10-24T02:32:18.293Z,2025-10-24T02:32:18.293Z,2025-10-24T02:32:18.293Z",
    "req_id": "6797bcd8-07c2-4c20-b31c-ce6db8367a98"
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
    "x-req-id": "6797bcd8-07c2-4c20-b31c-ce6db8367a98",
    "content-type": "application/json; charset=utf-8",
    "content-length": "791",
    "etag": "W/\"317-aUQsP1PeGjapfZhkjHLtMJb/Hw0\"",
    "date": "Fri, 24 Oct 2025 02:32:18 GMT",
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
Snapshot creation failed
```

<details>
<summary>Error Details</summary>

```json
{
  "status": 500,
  "data": {
    "ok": false,
    "error": "snapshot_failed",
    "message": "Failed query: insert into \"strategies\" (\"id\", \"snapshot_id\", \"correlation_id\", \"strategy\", \"status\", \"error_code\", \"error_message\", \"attempt\", \"latency_ms\", \"tokens\", \"next_retry_at\", \"created_at\", \"updated_at\", \"model_name\", \"model_params\", \"prompt_version\", \"strategy_for_now\") values (default, $1, default, default, $2, default, default, $3, default, default, default, $4, $5, default, default, default, default) on conflict (\"snapshot_id\") do update set \"attempt\" = \"strategies\".\"attempt\" + 1, \"updated_at\" = $6\nparams: 98d4a820-8af4-4bc0-99ed-74ac026d16c9,pending,1,2025-10-24T02:32:21.444Z,2025-10-24T02:32:21.444Z,2025-10-24T02:32:21.444Z",
    "req_id": "e92867a9-b2dc-497e-8616-cb9f7a491c2a"
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
    "x-req-id": "e92867a9-b2dc-497e-8616-cb9f7a491c2a",
    "content-type": "application/json; charset=utf-8",
    "content-length": "791",
    "etag": "W/\"317-ewYwFNGKTTBwlkJNiYzD3PkVlxQ\"",
    "date": "Fri, 24 Oct 2025 02:32:21 GMT",
    "connection": "keep-alive",
    "keep-alive": "timeout=5"
  }
}
```
</details>

## Sydney, Australia - CBD

**Coordinates:** `-33.8688, 151.2093`
**Expected City:** Sydney
**Timezone:** Australia/Sydney

### ❌ Error

```
Snapshot creation failed
```

<details>
<summary>Error Details</summary>

```json
{
  "status": 500,
  "data": {
    "ok": false,
    "error": "snapshot_failed",
    "message": "Failed query: insert into \"strategies\" (\"id\", \"snapshot_id\", \"correlation_id\", \"strategy\", \"status\", \"error_code\", \"error_message\", \"attempt\", \"latency_ms\", \"tokens\", \"next_retry_at\", \"created_at\", \"updated_at\", \"model_name\", \"model_params\", \"prompt_version\", \"strategy_for_now\") values (default, $1, default, default, $2, default, default, $3, default, default, default, $4, $5, default, default, default, default) on conflict (\"snapshot_id\") do update set \"attempt\" = \"strategies\".\"attempt\" + 1, \"updated_at\" = $6\nparams: 281ecd39-6cb5-439b-b6e4-e6f5e59d8754,pending,1,2025-10-24T02:32:24.524Z,2025-10-24T02:32:24.524Z,2025-10-24T02:32:24.524Z",
    "req_id": "9a262a56-eea8-4efa-b4b8-633850ca0d85"
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
    "x-req-id": "9a262a56-eea8-4efa-b4b8-633850ca0d85",
    "content-type": "application/json; charset=utf-8",
    "content-length": "791",
    "etag": "W/\"317-xIokDQLoUTE01glLarOs/2hYYIU\"",
    "date": "Fri, 24 Oct 2025 02:32:24 GMT",
    "connection": "keep-alive",
    "keep-alive": "timeout=5"
  }
}
```
</details>

## São Paulo, Brazil - Paulista Avenue

**Coordinates:** `-23.5617, -46.6561`
**Expected City:** São Paulo
**Timezone:** America/Sao_Paulo

### ❌ Error

```
Snapshot creation failed
```

<details>
<summary>Error Details</summary>

```json
{
  "status": 500,
  "data": {
    "ok": false,
    "error": "snapshot_failed",
    "message": "Failed query: insert into \"strategies\" (\"id\", \"snapshot_id\", \"correlation_id\", \"strategy\", \"status\", \"error_code\", \"error_message\", \"attempt\", \"latency_ms\", \"tokens\", \"next_retry_at\", \"created_at\", \"updated_at\", \"model_name\", \"model_params\", \"prompt_version\", \"strategy_for_now\") values (default, $1, default, default, $2, default, default, $3, default, default, default, $4, $5, default, default, default, default) on conflict (\"snapshot_id\") do update set \"attempt\" = \"strategies\".\"attempt\" + 1, \"updated_at\" = $6\nparams: dc9fad0d-a735-45f3-867a-4ddb41282409,pending,1,2025-10-24T02:32:27.590Z,2025-10-24T02:32:27.590Z,2025-10-24T02:32:27.590Z",
    "req_id": "f4d99977-5f84-4dfc-b7cb-7e4bcbe62925"
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
    "x-req-id": "f4d99977-5f84-4dfc-b7cb-7e4bcbe62925",
    "content-type": "application/json; charset=utf-8",
    "content-length": "791",
    "etag": "W/\"317-gIkQmZTtPkYtLc2qt1V+DEDRiIU\"",
    "date": "Fri, 24 Oct 2025 02:32:27 GMT",
    "connection": "keep-alive",
    "keep-alive": "timeout=5"
  }
}
```
</details>

## Dubai, UAE - Downtown/Burj Khalifa

**Coordinates:** `25.1972, 55.2744`
**Expected City:** Dubai
**Timezone:** Asia/Dubai

### ❌ Error

```
Snapshot creation failed
```

<details>
<summary>Error Details</summary>

```json
{
  "status": 500,
  "data": {
    "ok": false,
    "error": "snapshot_failed",
    "message": "Failed query: insert into \"strategies\" (\"id\", \"snapshot_id\", \"correlation_id\", \"strategy\", \"status\", \"error_code\", \"error_message\", \"attempt\", \"latency_ms\", \"tokens\", \"next_retry_at\", \"created_at\", \"updated_at\", \"model_name\", \"model_params\", \"prompt_version\", \"strategy_for_now\") values (default, $1, default, default, $2, default, default, $3, default, default, default, $4, $5, default, default, default, default) on conflict (\"snapshot_id\") do update set \"attempt\" = \"strategies\".\"attempt\" + 1, \"updated_at\" = $6\nparams: a7464f42-649c-4c5e-a1ff-68d5bb789b4c,pending,1,2025-10-24T02:32:30.684Z,2025-10-24T02:32:30.684Z,2025-10-24T02:32:30.684Z",
    "req_id": "373157c1-a90e-41a3-b60c-b453312ae2cd"
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
    "x-req-id": "373157c1-a90e-41a3-b60c-b453312ae2cd",
    "content-type": "application/json; charset=utf-8",
    "content-length": "791",
    "etag": "W/\"317-Gs+/cD3VfTRutcmIyXT73GknnyY\"",
    "date": "Fri, 24 Oct 2025 02:32:30 GMT",
    "connection": "keep-alive",
    "keep-alive": "timeout=5"
  }
}
```
</details>

## Mumbai, India - International Airport

**Coordinates:** `19.0896, 72.8656`
**Expected City:** Mumbai
**Timezone:** Asia/Kolkata

### ❌ Error

```
Snapshot creation failed
```

<details>
<summary>Error Details</summary>

```json
{
  "status": 500,
  "data": {
    "ok": false,
    "error": "snapshot_failed",
    "message": "Failed query: insert into \"strategies\" (\"id\", \"snapshot_id\", \"correlation_id\", \"strategy\", \"status\", \"error_code\", \"error_message\", \"attempt\", \"latency_ms\", \"tokens\", \"next_retry_at\", \"created_at\", \"updated_at\", \"model_name\", \"model_params\", \"prompt_version\", \"strategy_for_now\") values (default, $1, default, default, $2, default, default, $3, default, default, default, $4, $5, default, default, default, default) on conflict (\"snapshot_id\") do update set \"attempt\" = \"strategies\".\"attempt\" + 1, \"updated_at\" = $6\nparams: 975fcd72-e49e-41bb-8b82-f37662c7d9a4,pending,1,2025-10-24T02:32:33.789Z,2025-10-24T02:32:33.789Z,2025-10-24T02:32:33.789Z",
    "req_id": "63a1672c-1643-4412-805d-2a4c07eb73b4"
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
    "x-req-id": "63a1672c-1643-4412-805d-2a4c07eb73b4",
    "content-type": "application/json; charset=utf-8",
    "content-length": "791",
    "etag": "W/\"317-f5Fq+O0w255uFuKLt66VPxq+jVs\"",
    "date": "Fri, 24 Oct 2025 02:32:33 GMT",
    "connection": "keep-alive",
    "keep-alive": "timeout=5"
  }
}
```
</details>

## London, UK - Heathrow Airport

**Coordinates:** `51.47, -0.4543`
**Expected City:** Hounslow
**Timezone:** Europe/London

### ❌ Error

```
Snapshot creation failed
```

<details>
<summary>Error Details</summary>

```json
{
  "status": 500,
  "data": {
    "ok": false,
    "error": "snapshot_failed",
    "message": "Failed query: insert into \"strategies\" (\"id\", \"snapshot_id\", \"correlation_id\", \"strategy\", \"status\", \"error_code\", \"error_message\", \"attempt\", \"latency_ms\", \"tokens\", \"next_retry_at\", \"created_at\", \"updated_at\", \"model_name\", \"model_params\", \"prompt_version\", \"strategy_for_now\") values (default, $1, default, default, $2, default, default, $3, default, default, default, $4, $5, default, default, default, default) on conflict (\"snapshot_id\") do update set \"attempt\" = \"strategies\".\"attempt\" + 1, \"updated_at\" = $6\nparams: 99742d27-cfad-4ea0-be1b-0f3708c8ea3b,pending,1,2025-10-24T02:32:36.963Z,2025-10-24T02:32:36.963Z,2025-10-24T02:32:36.963Z",
    "req_id": "b979d523-dc48-4e1e-b52e-23374af32a07"
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
    "x-req-id": "b979d523-dc48-4e1e-b52e-23374af32a07",
    "content-type": "application/json; charset=utf-8",
    "content-length": "791",
    "etag": "W/\"317-2rkCdsrPA+8PfefcBvTW0OGFaUU\"",
    "date": "Fri, 24 Oct 2025 02:32:37 GMT",
    "connection": "keep-alive",
    "keep-alive": "timeout=5"
  }
}
```
</details>

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

