import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { solve, prepareContext, pointInPolygon } from '../shared/solver.ts';
import type { Dataset, Evidence, ImageStar, SolveParams } from '../shared/types.ts';

function load(name = 'synthetic-standard'): Dataset {
  const raw = JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
  return {
    id: 'ds-rules',
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

function truePairFor(imageId: string) {
  return { imageId, catalogId: imageId.replace('img', 'cat') };
}

describe('residual boundary inclusion', () => {
  it('accepts residuals exactly on the tolerance boundary (inclusive)', () => {
    const ds = load();
    const tight = solve(ds, { ...PARAMS, tolerancePx: 0.05 });
    expect(tight.candidates[0].matches.every((m) => m.residualPx <= 0.05 + 1e-9)).toBe(true);
    const generous = solve(ds, { ...PARAMS, tolerancePx: 0.5 });
    const top = generous.candidates[0];
    const maxResidual = Math.max(...top.matches.map((m) => m.residualPx));
    const atBoundary = solve(ds, { ...PARAMS, tolerancePx: maxResidual });
    expect(atBoundary.candidates[0].inlierCount).toBe(top.inlierCount);
    const justBelow = solve(ds, { ...PARAMS, tolerancePx: Math.max(0, maxResidual - 1e-9) });
    expect(justBelow.candidates[0].inlierCount).toBeLessThanOrEqual(top.inlierCount);
  });
});

describe('underdetermined reporting', () => {
  it('flags sparse geometry as underdetermined', () => {
    const ds = load('synthetic-sparse');
    const res = solve(ds, { ...PARAMS, fovMinDeg: 5, fovMaxDeg: 40 });
    expect(res.status).toBe('underdetermined');
    expect(res.underdeterminedReason).toMatch(/fov|seed|inlier|quad/i);
  });

  it('refuses to solve with fewer than 3 locks and explains the missing constraint', () => {
    const ds = load();
    const first = ds.imageStars.find((s) => s.id.startsWith('img-'))!;
    ds.evidence = [{
      id: 'ev-1', kind: 'lock', createdAt: '1970-01-01T00:00:00.000Z',
      pair: truePairFor(first.id),
    } as Evidence];
    const res = solve(ds, PARAMS);
    expect(res.status).toBe('underdetermined');
    expect(res.underdeterminedReason).toMatch(/3 non-collinear/);
  });

  it('reports collinear locks as rotation/scale degeneracy', () => {
    const ds = load();
    const cats = ds.catalogStars;
    const collinear: ImageStar[] = [
      { id: 'l1', x: 100, y: 500, flux: 5000 },
      { id: 'l2', x: 300, y: 500, flux: 5000 },
      { id: 'l3', x: 500, y: 500, flux: 5000 },
    ];
    ds.imageStars = [...ds.imageStars, ...collinear];
    ds.evidence = ['l1', 'l2', 'l3'].map((id, i) => ({
      id: `ev-${i}`, kind: 'lock' as const, createdAt: '1970-01-01T00:00:00.000Z',
      pair: { imageId: id, catalogId: cats[i].id },
    }));
    const res = solve(ds, PARAMS);
    expect(res.status).toBe('underdetermined');
    expect(res.underdeterminedReason).toMatch(/collinear/i);
  });
});

describe('evidence immutability', () => {
  it('masks remove stars from the active set but keeps the raw list intact', () => {
    const ds = load();
    const before = ds.imageStars.length;
    const saturatedCount = ds.imageStars.filter((s) => s.saturated).length;
    ds.evidence = [{
      id: 'ev-mask', kind: 'mask-star', createdAt: '1970-01-01T00:00:00.000Z',
      starId: ds.imageStars.find((s) => !s.saturated)!.id, reason: 'satellite trail',
    }];
    const prepared = prepareContext(ds);
    expect(prepared.activeImages).toHaveLength(before - saturatedCount - 1);
    expect(ds.imageStars).toHaveLength(before);
  });

  it('mask-region uses a point-in-polygon rule', () => {
    expect(pointInPolygon(10, 10, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }])).toBe(true);
    expect(pointInPolygon(30, 10, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }])).toBe(false);
  });

  it('three non-collinear locks drive the solve', () => {
    const ds = load();
    const ids = ['img-001', 'img-002', 'img-003'];
    ds.evidence = ids.map((id, i) => ({
      id: `ev-lock-${i}`, kind: 'lock' as const, createdAt: '1970-01-01T00:00:00.000Z',
      pair: truePairFor(id),
    }));
    const res = solve(ds, { ...PARAMS, allowMirror: false });
    expect(res.status).toBe('ok');
    expect(res.candidates[0].inlierCount).toBeGreaterThanOrEqual(20);
  });
});


describe('insufficient data fixture', () => {
  it('reports underdetermined with fewer than 4 active image stars', () => {
    const ds = load('synthetic-underdetermined');
    const res = solve(ds, PARAMS);
    expect(res.status).toBe('underdetermined');
    expect(res.candidates).toHaveLength(0);
    expect(res.underdeterminedReason).toMatch(/fewer than 4 active image stars/);
  });
});
