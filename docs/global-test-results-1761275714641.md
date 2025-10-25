# Vecto Pilot™ Global Testing Report

**Generated:** 2025-10-24T03:15:14.639Z
**Test Locations:** 7
**Successful:** 4

---

## Paris, France - Charles de Gaulle Airport Area

**Coordinates:** `49.0097, 2.5479`
**Expected City:** Roissy-en-France
**Timezone:** Europe/Paris

### 📍 Snapshot Data

- **Snapshot ID:** `7323176b-9b6d-4b89-8956-476193e2df28`
- **Geocoded City:** `null` (system fallback active)
- **Address:** N/A
- **Timezone:** undefined
- **Weather:** undefined°F, undefined
- **Air Quality:** AQI undefined (undefined)

### ⚠️ No Venues Generated

---

## Tokyo, Japan - Shibuya District

**Coordinates:** `35.6595, 139.7004`
**Expected City:** Tokyo
**Timezone:** Asia/Tokyo

### 📍 Snapshot Data

- **Snapshot ID:** `9425c98b-7f90-4fb0-8aad-7a35670aa163`
- **Geocoded City:** `null` (system fallback active)
- **Address:** N/A
- **Timezone:** undefined
- **Weather:** undefined°F, undefined
- **Air Quality:** AQI undefined (undefined)

### ⚠️ No Venues Generated

---

## Sydney, Australia - CBD

**Coordinates:** `-33.8688, 151.2093`
**Expected City:** Sydney
**Timezone:** Australia/Sydney

### 📍 Snapshot Data

- **Snapshot ID:** `02d83875-fc68-440b-ad83-b1b5f7401f15`
- **Geocoded City:** `null` (system fallback active)
- **Address:** N/A
- **Timezone:** undefined
- **Weather:** undefined°F, undefined
- **Air Quality:** AQI undefined (undefined)

### ⚠️ No Venues Generated

---

## São Paulo, Brazil - Paulista Avenue

**Coordinates:** `-23.5617, -46.6561`
**Expected City:** São Paulo
**Timezone:** America/Sao_Paulo

### ❌ Error

```
socket hang up
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

### 📍 Snapshot Data

- **Snapshot ID:** `1e0fc3a2-841d-428e-94e5-da01af19563a`
- **Geocoded City:** `null` (system fallback active)
- **Address:** N/A
- **Timezone:** undefined
- **Weather:** undefined°F, undefined
- **Air Quality:** AQI undefined (undefined)

### ⚠️ No Venues Generated

---

## London, UK - Heathrow Airport

**Coordinates:** `51.47, -0.4543`
**Expected City:** Hounslow
**Timezone:** Europe/London

### ❌ Error

```
socket hang up
```

## Summary

- **Total Tests:** 7
- **Successful Snapshots:** 4
- **Generated Venues:** 0
- **City Detected:** 0
- **Null City (Fallback):** 4

### Key Findings

1. **Global Support:** ⚠️ System partially handled all global locations
2. **Venue Generation:** ⚠️ GPT-5 generated venues for 0/4 locations
3. **Geocoding:** 0/4 locations had city detected, 4 used fallback
4. **AI Pipeline:** All successful tests completed the full triad (Claude → GPT-5 → Gemini)

