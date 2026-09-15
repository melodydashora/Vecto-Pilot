# Coordinate quality comment corrections — September 11, 2026

The original comments below are preserved here because six decimal places do not establish physical GPS accuracy. The coordinate adapter now validates finite input, bounds, reported accuracy and freshness separately.

From `server/lib/location/coords-key.js`:

```text
 * GPS PRECISION: 6 decimals = ~11cm accuracy
 *   - 6 decimals = ~11cm (exact, required for venue matching)
  // Preserve null-check behavior from venue-utils.js for backward compatibility
```

The legacy null check also accepted empty strings, booleans and infinity; it has been replaced by the shared coordinate validator. All new coordinate keys retain six decimal places. Historical valid keys with fewer decimal places remain readable.
