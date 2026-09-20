import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { solve, computeRequestHash } from '../shared/solver.ts';
import type { Dataset, SolveParams } from '../shared/types.ts';

function load(name: string): Dataset {
  const raw = JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
  return {
    id: 'ds-test',
    name: raw.name,
    createdAt: '1970-01-01T00:00:00.000Z',
    imageStars: raw.imageStars,
    catalogStars: raw.catalogStars,
    evidence: [],
  };
}

const PARAMS: SolveParams = {
  fovMinDeg: 0.2,
  fovMaxDeg: 5,
  maxRotationDeg: 180,
  allowMirror: true,
  distortionOrder: 1,
  tolerancePx: 2,
  mismatchCost: 0.5,
  topK: 5,
};

describe('solver determinism', () => {
  it('is insensitive to input ordering', () => {
    const a = load('synthetic-standard');
    const b = load('synthetic-standard');
    b.imageStars = [...a.imageStars].reverse();
    b.catalogStars = [...a.catalogStars].reverse();
    const ra = solve(a, PARAMS);
    const rb = solve(b, PARAMS);
    expect(ra.requestHash).toBe(rb.requestHash);
    expect(ra.candidates.map((c) => c.signature)).toEqual(rb.candidates.map((c) => c.signature));
    expect(ra.candidates[0].model.rotationDeg).toBeCloseTo(15, 1);
  });

  it('does not depend on the local timezone (createdAt is excluded from hash)', () => {
    const ds = load('synthetic-standard');
    const h1 = computeRequestHash(ds.id, PARAMS);
    ds.createdAt = '2099-12-31T23:59:59+09:00';
    const h2 = computeRequestHash(ds.id, PARAMS);
    expect(h1).toBe(h2);
  });

  it('distinguishes mirror candidates from ordinary rotation', () => {
    const mirror = load('synthetic-mirror');
    const res = solve(mirror, PARAMS);
    expect(res.status).toBe('ok');
    expect(res.candidates[0].model.mirror).toBe(true);
    const standard = load('synthetic-standard');
    const res2 = solve(standard, PARAMS);
    expect(res2.candidates[0].model.mirror).toBe(false);
  });

  it('handles the RA 0/360 seam', () => {
    const ds = load('synthetic-ra-seam');
    const res = solve(ds, PARAMS);
    expect(res.status).toBe('ok');
    expect(res.candidates[0].inlierCount).toBeGreaterThanOrEqual(18);
    expect(res.candidates[0].model.scaleArcsecPerPx).toBeCloseTo(4.1, 1);
  });
});
