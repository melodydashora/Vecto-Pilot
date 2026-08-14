// server/lib/offers/downscale-offer-image.js
// 2026-08-14 (todo #43 <3s target): shrink offer screenshots before the model
// call. Live payloads run 900KB-1.3MB base64 (offer_intelligence raw_text size
// markers); the offer card is fully legible at ~820px width, and Gemini tiles
// images at 768px internally anyway — bytes past that are pure upload latency.
// Measured on this host: 376KB JPEG → 207KB in 76ms; PNG screenshots shrink more.
//
// Fail-open BY DESIGN: downscale is an optimization, never a gate — on any
// sharp error the ORIGINAL image proceeds to the model (loud warn). This is the
// missing-OPTIONAL-data arm of the no-fallbacks rule: we omit the optimization,
// we never fabricate or drop the real payload.
import sharp from 'sharp';

const TARGET_WIDTH = 820;
const JPEG_QUALITY = 80;
const SKIP_BELOW_BYTES = 250 * 1024; // already small — re-encode not worth 50-80ms

/**
 * @param {Buffer} buffer - raw image bytes
 * @param {string} mimeType - incoming mime type
 * @returns {Promise<{buffer: Buffer, mimeType: string, downscaled: boolean}>}
 */
export async function downscaleOfferImage(buffer, mimeType) {
  if (!buffer || buffer.length < SKIP_BELOW_BYTES) {
    return { buffer, mimeType, downscaled: false };
  }
  try {
    const out = await sharp(buffer)
      .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    // A re-encode that GREW the payload keeps the original.
    if (out.length >= buffer.length) {
      return { buffer, mimeType, downscaled: false };
    }
    return { buffer: out, mimeType: 'image/jpeg', downscaled: true };
  } catch (err) {
    console.warn(`[HOOKS] Image downscale failed (${err.message}) — sending original ${Math.round(buffer.length / 1024)}KB`);
    return { buffer, mimeType, downscaled: false };
  }
}
