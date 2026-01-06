> **Last Verified:** 2026-01-06

# Uber Research Findings (`platform-data/uber/research-findings/`)

## Purpose

AI-generated market research and intelligence findings for Uber markets. These files contain raw research data that feeds into the market intelligence features.

## Files

| File | Size | Purpose |
|------|------|---------|
| `gemini-findings.txt` | ~29KB | Market analysis from Gemini AI |
| `gemini-sample-code.txt` | ~33KB | Strategy code samples from Gemini |
| `gpt-market-city-findings.txt` | ~38KB | City-level market analysis from GPT |
| `research-intel.txt` | ~57KB | Consolidated research intelligence |

## Data Categories

### Market Intelligence
- Honey holes (high-demand areas)
- Danger zones (safety concerns)
- Dead zones (low demand)
- Peak time patterns

### Strategy Patterns
- Ant strategy (volume-focused)
- Sniper strategy (high-value focused)
- Market-specific adaptations

### City Coverage
- Market boundaries
- Airport procedures
- Special event patterns
- Local regulations

## Usage

These files are processed by:
- `server/scripts/parse-market-research.js` - Parser script
- `server/api/intelligence/` - Intelligence API endpoints
- `server/lib/venue/` - Venue enrichment

## Format

Plain text with structured sections. Example:

```
### Dallas, TX
**Honey Holes:**
- Deep Ellum (weekend nights, surge 2.0x+)
- Uptown (after-work, Thu-Sat)

**Danger Zones:**
- South Dallas late night
```

## See Also

- [`../README.md`](../README.md) - Uber platform data
- [`../../README.md`](../../README.md) - Platform data overview
- [`/server/api/intelligence/`](/server/api/intelligence/README.md) - Intelligence API
