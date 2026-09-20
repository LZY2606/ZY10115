import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackend } from '../server/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'platesolve-'));
const dbPath = join(dir, 'it.sqlite');
const fixedNow = (() => {
  let counter = 0;
  return () => `2000-01-01T00:00:${String(counter++).padStart(2, '0')}.000Z`;
})();
const backend = createBackend(dbPath, fixedNow);
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => backend.handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function json(path: string, init?: RequestInit) {
  const res = await fetch(base + path, {
    headers: { 'content-type': 'application/json' },
    ...init,
    body: init?.body,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data, text };
}

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/synthetic-standard.json', import.meta.url), 'utf8'),
);
const params = {
  fovMinDeg: 0.2, fovMaxDeg: 5, maxRotationDeg: 180, allowMirror: true,
  distortionOrder: 1, tolerancePx: 2, mismatchCost: 0.5, topK: 3,
};

describe('end-to-end API', () => {
  let datasetId = '';
  let requestHash = '';

  it('health responds', async () => {
    const { status, data } = await json('/api/health');
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('creates a dataset and deduplicates identical content', async () => {
    const first = await json('/api/datasets', {
      method: 'POST',
      body: JSON.stringify({ name: 'it', imageStars: fixture.imageStars, catalogStars: fixture.catalogStars }),
    });
    expect(first.status).toBe(201);
    datasetId = first.data.dataset.id;
    const second = await json('/api/datasets', {
      method: 'POST',
      body: JSON.stringify({ name: 'it', imageStars: fixture.imageStars, catalogStars: fixture.catalogStars }),
    });
    expect(second.status).toBe(200);
    expect(second.data.reused).toBe(true);
  });

  it('rejects ra out of range', async () => {
    const bad = await json('/api/datasets', {
      method: 'POST',
      body: JSON.stringify({
        imageStars: [{ id: 'x', x: 0, y: 0, flux: 1 }],
        catalogStars: [{ id: 'c', ra: 400, dec: 0 }],
      }),
    });
    expect(bad.status).toBe(400);
  });

  it('solves, caches by request hash, and returns identical result on resubmit', async () => {
    const first = await json(`/api/datasets/${datasetId}/solves`, { method: 'POST', body: JSON.stringify({ params }) });
    expect(first.status).toBe(201);
    expect(first.data.cached).toBe(false);
    expect(first.data.result.status).toBe('ok');
    expect(first.data.result.candidates[0].model.mirror).toBe(false);
    expect(first.data.result.candidates[0].model.rotationDeg).toBeCloseTo(15, 1);
    requestHash = first.data.result.requestHash;
    const second = await json(`/api/datasets/${datasetId}/solves`, { method: 'POST', body: JSON.stringify({ params }) });
    expect(second.status).toBe(200);
    expect(second.data.cached).toBe(true);
    expect(second.data.result.requestHash).toBe(requestHash);
  });

  it('different params produce a different hash and a new solve', async () => {
    const other = await json(`/api/datasets/${datasetId}/solves`, {
      method: 'POST',
      body: JSON.stringify({ params: { ...params, tolerancePx: 1 } }),
    });
    expect(other.data.result.requestHash).not.toBe(requestHash);
  });

  it('appends lock evidence without mutating stars and influences the next solve hash', async () => {
    const before = (await json(`/api/datasets/${datasetId}`)).data.imageStars.length;
    const ev = await json(`/api/datasets/${datasetId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'lock', pair: { imageId: 'img-001', catalogId: 'cat-001' } }),
    });
    expect(ev.status).toBe(201);
    const after = (await json(`/api/datasets/${datasetId}`)).data.imageStars.length;
    expect(after).toBe(before);
    const sameParamsHitCache = await json(`/api/datasets/${datasetId}/solves`, { method: 'POST', body: JSON.stringify({ params }) });
    expect(sameParamsHitCache.data.cached).toBe(true);
    const solveRes = await json(`/api/datasets/${datasetId}/solves`, { method: 'POST', body: JSON.stringify({ params: { ...params, mismatchCost: 0.75 } }) });
    expect(solveRes.data.cached).toBe(false);
    expect(solveRes.data.result.status).toBe('underdetermined');
    expect(solveRes.data.result.underdeterminedReason).toMatch(/3 non-collinear/);
    expect(solveRes.data.result.evidenceSummary.find((e: { kind: string }) => e.kind === 'lock').count).toBe(1);
  });

  it('replays under explicit rules version without caching', async () => {
    const clean = await json('/api/datasets', {
      method: 'POST',
      body: JSON.stringify({ name: 'replay-copy', imageStars: fixture.imageStars, catalogStars: fixture.catalogStars }),
    });
    for (const imageId of ['img-001', 'img-002', 'img-003']) {
      await json(`/api/datasets/${clean.data.dataset.id}/evidence`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'lock', pair: { imageId, catalogId: imageId.replace('img', 'cat') } }),
      });
    }
    const replay = await json(`/api/datasets/${clean.data.dataset.id}/replay`, {
      method: 'POST',
      body: JSON.stringify({ rulesVersion: '2025.1', params }),
    });
    expect(replay.status).toBe(200);
    expect(replay.data.result.status).toBe('ok');
    expect(replay.data.result.candidates[0].model.scaleArcsecPerPx).toBeCloseTo(3.2, 1);
    const unknown = await json(`/api/datasets/${clean.data.dataset.id}/replay`, {
      method: 'POST',
      body: JSON.stringify({ rulesVersion: '1999.9', params }),
    });
    expect(unknown.status).toBe(400);
  });

  it('exports per-pair residual CSV', async () => {
    const res = await fetch(base + `/api/solves/${requestHash}/export`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.split('\n')[0]).toContain('residual_px');
    expect(text).toContain('cat-');
  });

  it('404s for missing solve and dataset', async () => {
    expect((await json('/api/solves/deadbeef')).status).toBe(404);
    expect((await json('/api/datasets/no-such-thing')).status).toBe(404);
  });
});
