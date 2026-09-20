import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { Store } from '../server/store.ts';
import type { SolveParams } from '../shared/types.ts';

const dir = mkdtempSync(join(tmpdir(), 'platesolve-store-'));
const fixture = JSON.parse(readFileSync(new URL('../fixtures/synthetic-standard.json', import.meta.url), 'utf8'));
const params: SolveParams = {
  fovMinDeg: 0.2, fovMaxDeg: 5, maxRotationDeg: 180, allowMirror: true,
  distortionOrder: 1, tolerancePx: 2, mismatchCost: 0.5, topK: 3,
};

let store: Store;
beforeEach(() => {
  const dbPath = join(dir, `db-${Math.random().toString(36).slice(2)}.sqlite`);
  store = new Store(dbPath);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('store idempotence', () => {
  it('caches identical solve requests and ignores timestamp in identity', () => {
    let ticks = 0;
    const clock = () => `2010-05-0${1 + (ticks++ % 9)}T08:00:00.000Z`;
    store.createDataset('ds-1', 'd', fixture.imageStars, fixture.catalogStars, clock());
    const first = store.runSolve('ds-1', params, clock);
    expect(first.cached).toBe(false);
    const second = store.runSolve('ds-1', params, clock);
    expect(second.cached).toBe(true);
    expect(second.result.requestHash).toBe(first.result.requestHash);
    expect(second.result.candidates[0].model.rotationDeg).toBeCloseTo(15, 1);
  });

  it('different tolerance gives a different hash', () => {
    store.createDataset('ds-2', 'd', fixture.imageStars, fixture.catalogStars, 't');
    const a = store.runSolve('ds-2', params, () => 't');
    const b = store.runSolve('ds-2', { ...params, tolerancePx: 0.8 }, () => 't');
    expect(a.result.requestHash).not.toBe(b.result.requestHash);
  });

  it('replay computes without persisting a new solve row', () => {
    store.createDataset('ds-3', 'd', fixture.imageStars, fixture.catalogStars, 't');
    const replayed = store.replaySolve('ds-3', '2025.1', params);
    expect(replayed.candidates[0].model.scaleArcsecPerPx).toBeCloseTo(3.2, 2);
    expect(store.listSolves('ds-3')).toHaveLength(0);
  });
});
