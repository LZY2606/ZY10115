import { describe, expect, it } from 'vitest';
import { projectToTangent, tangentToRaDec } from '../shared/projection.ts';
import { wrap360 } from '../shared/angle.ts';
import { raDecToPixel, pixelToRaDec } from '../shared/model.ts';
import type { TransformModel } from '../shared/types.ts';

const model: TransformModel = {
  a: 1.5e-5, b: -4e-6, c: -1.1e-5 * 500 + 4e-6 * 500,
  d: 4e-6, e: 1.5e-5, f: -4e-6 * 500 - 1.5e-5 * 500,
  coeffP: [], coeffQ: [], ra0: 120, dec0: 30, order: 1,
  scaleArcsecPerPx: 1.5e-5 * 180 / Math.PI * 3600, rotationDeg: 14.93, mirror: false, fovDiagDeg: 1,
};
const box = { cx: 500, cy: 500, scale: 700 };

describe('gnomonic projection round trip', () => {
  it('is identity at the tangent point and invertible nearby', () => {
    const t = projectToTangent(120, 30, 120, 30);
    expect(t.xi).toBeCloseTo(0, 12);
    expect(t.eta).toBeCloseTo(0, 12);
    for (const [ra, dec] of [[120.4, 30.2], [119.7, 29.6], [120.1, 30.5]] as const) {
      const p = projectToTangent(ra, dec, 120, 30);
      const back = tangentToRaDec(p.xi, p.eta, 120, 30);
      expect(back.ra).toBeCloseTo(ra, 8);
      expect(back.dec).toBeCloseTo(dec, 8);
    }
  });

  it('pixel -> sky -> pixel closes for the affine model', () => {
    for (const [x, y] of [[200, 300], [800, 120], [512, 512]] as const) {
      const sky = pixelToRaDec(model, x, y, box);
      const px = raDecToPixel(model, sky.ra, sky.dec, box);
      expect(px.x).toBeCloseTo(x, 5);
      expect(px.y).toBeCloseTo(y, 5);
      expect(wrap360(sky.ra)).toBeGreaterThanOrEqual(0);
    }
  });
});
