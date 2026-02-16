# Offer Analysis — `server/lib/offers/`

**Last Updated:** 2026-02-16

## Purpose

Server-side pre-parsing for ride offer OCR text from Siri Shortcuts. Extracts structured data (price, miles, times, product type, surge) via regex BEFORE sending to LLM.

## Architecture

```
Raw OCR text → parseOfferText() → PreParsedOffer → injected into LLM prompt
                                                         ↓
                                               AI decides ACCEPT/REJECT
                                               (focuses on addresses + destination quality)
```

## Files

| File | Purpose |
|------|---------|
| `parse-offer-text.js` | OCR text pre-parser + voice $/mile formatting |

## Key Functions

| Function | Purpose |
|----------|---------|
| `parseOfferText(rawText)` | Main pre-parser — returns all extracted fields |
| `formatPerMileForVoice(perMile)` | Converts $/mile to spoken English for Siri TTS |
| `extractPrice(text)` | Extracts primary ride price |
| `extractTimeDistancePairs(text)` | Extracts pickup/ride time+distance pairs |
| `extractProductType(text)` | Detects UberX/Priority/XL/Lyft etc. |
| `extractSurge(text)` | Detects surge/priority bonus |

## Why Pre-Parse?

1. **Deterministic** — same text always produces same numbers (regex vs LLM math)
2. **Fast** — <1ms execution, no I/O
3. **Reliable** — LLM sometimes calculates $/mile wrong
4. **Testable** — pure functions with no dependencies

## Parse Confidence Levels

| Level | Meaning |
|-------|---------|
| `full` | Price AND both pickup+ride time/distance extracted |
| `partial` | Price extracted but missing one time/distance pair |
| `minimal` | Price not extracted (garbled OCR, non-offer screenshot) |

## Related Files

| File | Relationship |
|------|--------------|
| `server/api/hooks/analyze-offer.js` | Primary consumer — calls parseOfferText before LLM |
| `server/lib/ai/coach-dal.js` | Reads offer history from intercepted_signals |
| `server/api/coach/schema.js` | Coach schema awareness of intercepted_signals |
| `shared/schema.js` | intercepted_signals table definition |
