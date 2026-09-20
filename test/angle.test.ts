import { describe, expect, it } from 'vitest';
import { wrap180, wrap360, meanAngularDeg, angularDistanceDeg } from '../shared/angle.ts';

describe('angle wrapping', () => {
  it('wraps 360 and negative values into [0,360)', () => {
    expect(wrap360(360)).toBe(0);
    expect(wrap360(-0.001)).toBeCloseTo(359.999, 6);
    expect(wrap360(720 + 15)).toBeCloseTo(15, 9);
  });

  it('wrap180 stays in (-180,180]', () => {
    expect(wrap180(181)).toBeCloseTo(-179, 9);
    expect(wrap180(-181)).toBeCloseTo(179, 9);
    expect(wrap180(-180)).toBeCloseTo(180, 9);
  });

  it('vector mean crosses the RA seam instead of arithmetic mean', () => {
    expect(meanAngularDeg([359, 1])).toBeCloseTo(0, 9);
    expect(meanAngularDeg([350, 10])).toBeCloseTo(0, 9);
    expect(meanAngularDeg([10, 20])).toBeCloseTo(15, 9);
  });

  it('seam-crossing angular distance is the short arc', () => {
    expect(angularDistanceDeg(359.5, 0, 0.5, 0)).toBeCloseTo(1, 6);
  });
});
