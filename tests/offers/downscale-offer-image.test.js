// tests/offers/downscale-offer-image.test.js
// 2026-08-14 (todo #43 <3s target): the pre-model screenshot downscale.
// Contract under test: big images shrink to <=820px JPEG, small images pass
// through untouched, and ANY failure fails OPEN (original proceeds) — the
// downscale is an optimization, never a gate.
import sharp from 'sharp';
import { downscaleOfferImage } from '../../server/lib/offers/downscale-offer-image.js';

// Synthesizes a screenshot-shaped PNG big enough to cross the 250KB skip
// threshold. Deterministic xorshift noise (Math.imul keeps it in 32-bit int
// land) — real noise compresses poorly, so the PNG reliably lands ~MB-scale.
async function makeBigScreenshot() {
  const width = 1290; // iPhone Pro screenshot width
  const height = 800;
  const raw = Buffer.alloc(width * height * 3);
  let s = 0x2f6e2b1;
  for (let i = 0; i < raw.length; i++) {
    s = Math.imul(s, 1103515245) + 12345 | 0;
    raw[i] = (s >>> 16) & 0xff;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe('downscaleOfferImage', () => {
  test('downscales a large screenshot to <=820px JPEG and shrinks it', async () => {
    const big = await makeBigScreenshot();
    expect(big.length).toBeGreaterThan(250 * 1024); // must actually cross the threshold

    const out = await downscaleOfferImage(big, 'image/png');
    expect(out.downscaled).toBe(true);
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.buffer.length).toBeLessThan(big.length);

    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBeLessThanOrEqual(820);
  });

  test('passes small images through untouched (below the re-encode threshold)', async () => {
    const small = await sharp({
      create: { width: 400, height: 800, channels: 3, background: { r: 40, g: 40, b: 40 } },
    }).jpeg().toBuffer();

    const out = await downscaleOfferImage(small, 'image/jpeg');
    expect(out.downscaled).toBe(false);
    expect(out.buffer).toBe(small); // same Buffer identity — no re-encode
    expect(out.mimeType).toBe('image/jpeg');
  });

  test('fails OPEN on undecodable bytes — original proceeds to the model', async () => {
    const garbage = Buffer.alloc(300 * 1024, 0x42); // over threshold, not an image
    const out = await downscaleOfferImage(garbage, 'image/jpeg');
    expect(out.downscaled).toBe(false);
    expect(out.buffer).toBe(garbage);
    expect(out.mimeType).toBe('image/jpeg');
  });
});
