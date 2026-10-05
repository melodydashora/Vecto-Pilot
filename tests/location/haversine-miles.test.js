import { describe, expect, test } from '@jest/globals';
import { haversineMiles } from '../../server/lib/location/geo.js';

describe('shared event and home distance contract', () => {
  test.each([
    [null, 0, 0, 0], [0, null, 0, 0], [0, 0, null, 0], [0, 0, 0, null],
    [undefined, 0, 0, 0], [0, undefined, 0, 0], [0, 0, undefined, 0], [0, 0, 0, undefined],
  ])('missing coordinate (%s, %s, %s, %s) is excluded by a finite radius', (...coordinates) => {
    const distance = haversineMiles(...coordinates);
    expect(distance).toBe(Infinity);
    expect(distance <= 60).toBe(false);
  });

  test('zero coordinates are real locations, including a driver already at the venue', () => {
    expect(haversineMiles(0, 0, 0, 0)).toBe(0);
    expect(haversineMiles(0, 0, 0, 1)).toBeCloseTo(69.093418985531, 10);
    expect(haversineMiles(0, 0, 1, 0)).toBeCloseTo(69.093418985531, 10);
  });

  test('crossing the antimeridian takes the short arc in either direction', () => {
    expect(haversineMiles(0, 179.9, 0, -179.9)).toBeCloseTo(13.818683797106, 10);
    expect(haversineMiles(0, -179.9, 0, 179.9)).toBeCloseTo(13.818683797106, 10);
  });

  test.each([15, 60])('points just inside and outside the %s-mile caller boundary remain distinct', radius => {
    // On the equator, longitude in radians is arc length divided by radius.
    const longitudeForMiles = miles => miles / 3958.7613 * 180 / Math.PI;
    const inside = haversineMiles(0, 0, 0, longitudeForMiles(radius - 0.000001));
    const outside = haversineMiles(0, 0, 0, longitudeForMiles(radius + 0.000001));
    expect(inside).toBeCloseTo(radius - 0.000001, 10);
    expect(outside).toBeCloseTo(radius + 0.000001, 10);
    expect(inside <= radius).toBe(true);
    expect(outside <= radius).toBe(false);
  });

  test('a half-circle uses the established mile radius', () => {
    expect(haversineMiles(0, 0, 0, 180)).toBeCloseTo(12436.81541739558, 8);
  });
});
