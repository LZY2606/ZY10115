import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Store } from './store.ts';
import type { Evidence, SolveParams } from '../shared/types.ts';
import { stableStringify, shortHash } from '../shared/hash.ts';
import { detectAndParse } from '../shared/parse.ts';

interface RouteCtx {
  store: Store;
  body: unknown;
  params: Record<string, string>;
}

type Handler = (ctx: RouteCtx) => ResponseValue | Promise<ResponseValue>;
type ResponseValue = { status?: number; data?: unknown; csv?: { filename: string; content: string } };

export function createApiHandler(store: Store, now: () => string = () => new Date().toISOString()) {
  const routes: Array<{ method: string; pattern: RegExp; keys: string[]; handler: Handler }> = [
    { method: 'GET', pattern: /^\/api\/health$/, keys: [], handler: () => ({ data: { ok: true } }) },
    { method: 'GET', pattern: /^\/api\/datasets$/, keys: [], handler: ({ store: s }) => ({ data: s.listDatasets() }) },
    { method: 'POST', pattern: /^\/api\/datasets$/, keys: [], handler: createDataset },
    { method: 'GET', pattern: /^\/api\/datasets\/([^/]+)$/, keys: ['id'], handler: getDataset },
    { method: 'POST', pattern: /^\/api\/datasets\/([^/]+)\/evidence$/, keys: ['id'], handler: addEvidence },
    { method: 'GET', pattern: /^\/api\/datasets\/([^/]+)\/solves$/, keys: ['id'], handler: listSolves },
    { method: 'POST', pattern: /^\/api\/datasets\/([^/]+)\/solves$/, keys: ['id'], handler: runSolve },
    { method: 'POST', pattern: /^\/api\/datasets\/([^/]+)\/replay$/, keys: ['id'], handler: replaySolve },
    { method: 'GET', pattern: /^\/api\/solves\/([^/]+)$/, keys: ['hash'], handler: getSolve },
    { method: 'GET', pattern: /^\/api\/solves\/([^/]+)\/export$/, keys: ['hash'], handler: exportSolve },
  ];

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/api/')) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;
      const routeParams: Record<string, string> = {};
      route.keys.forEach((key, i) => {
        routeParams[key] = decodeURIComponent(match[i + 1]);
      });
      let body: unknown;
      if (req.method === 'POST') {
        try {
          body = await readJson(req);
        } catch (err) {
          return sendJson(res, 400, { error: (err as Error).message });
        }
      }
      try {
        const out = await route.handler({ store, body, params: routeParams });
        if (out.csv) {
          res.statusCode = out.status ?? 200;
          res.setHeader('content-type', 'text/csv; charset=utf-8');
          res.setHeader('content-disposition', `attachment; filename="${out.csv.filename}"`);
          res.end(out.csv.content);
          return;
        }
        return sendJson(res, out.status ?? 200, out.data ?? null);
      } catch (err) {
        const message = (err as Error).message;
        const code = message.startsWith('dataset not found') || message.startsWith('solve not found') ? 404 : 400;
        return sendJson(res, code, { error: message });
      }
    }
    sendJson(res, 404, { error: 'no such API route' });
  };

  function createDataset({ body }: RouteCtx): ResponseValue {
    const b = (body ?? {}) as { name?: string; imageStars?: unknown; catalogStars?: unknown; imageText?: string; imageFilename?: string; catalogText?: string; catalogFilename?: string };
    let imageStars = b.imageStars;
    let catalogStars = b.catalogStars;
    if (typeof b.imageText === 'string') {
      const parsed = detectAndParse(b.imageText, b.imageFilename ?? 'image.csv');
      imageStars = parsed.imageStars ?? imageStars;
      catalogStars = parsed.catalogStars ?? catalogStars;
    }
    if (typeof b.catalogText === 'string') {
      const parsed = detectAndParse(b.catalogText, b.catalogFilename ?? 'catalog.csv');
      catalogStars = parsed.catalogStars ?? catalogStars;
      imageStars = parsed.imageStars ?? imageStars;
    }
    if (!Array.isArray(imageStars) || !Array.isArray(catalogStars) || imageStars.length === 0) {
      throw new Error('dataset requires non-empty imageStars and catalogStars arrays (or CSV text)');
    }
    validateImageStars(imageStars);
    validateCatalogStars(catalogStars);
    const id = 'ds-' + shortHash(stableStringify({ imageStars, catalogStars }));
    const name = b.name || id;
    const existing = store.getDataset(id);
    if (existing) return { status: 200, data: { dataset: existing, reused: true } };
    const dataset = store.createDataset(id, name, imageStars, catalogStars, now());
    return { status: 201, data: { dataset, reused: false } };
  }

  function getDataset({ store: s, params }: RouteCtx): ResponseValue {
    const dataset = s.getDataset(params.id);
    if (!dataset) throw new Error(`dataset not found: ${params.id}`);
    return { data: dataset };
  }

  function addEvidence({ store: s, params, body }: RouteCtx): ResponseValue {
    const b = body as Partial<Evidence>;
    if (!b.kind || !['lock', 'mask-saturated', 'mask-star', 'mask-region'].includes(b.kind)) {
      throw new Error('evidence.kind must be lock, mask-saturated, mask-star or mask-region');
    }
    const dataset = s.getDataset(params.id);
    if (!dataset) throw new Error(`dataset not found: ${params.id}`);
    if (b.kind === 'lock' && (!b.pair || !b.pair.imageId || !b.pair.catalogId)) {
      throw new Error('lock evidence requires pair.imageId and pair.catalogId');
    }
    if (b.kind === 'mask-star' && !b.starId) throw new Error('mask-star evidence requires starId');
    if (b.kind === 'mask-region' && (!Array.isArray(b.polygon) || b.polygon.length < 3)) {
      throw new Error('mask-region evidence requires a polygon with >= 3 points');
    }
    const payload: Evidence = {
      id: 'ev-' + shortHash(stableStringify({ dataset: params.id, body: b })),
      createdAt: now(),
      kind: b.kind,
      pair: b.pair,
      starId: b.starId,
      reason: b.reason,
      polygon: b.polygon,
    };
    try {
      s.addEvidence(params.id, payload);
    } catch (err) {
      if (String((err as Error).message).includes('UNIQUE')) {
        return { status: 200, data: { evidence: payload, reused: true } };
      }
      throw err;
    }
    return { status: 201, data: { evidence: payload, reused: false } };
  }

  function listSolves({ store: s, params }: RouteCtx): ResponseValue {
    if (!s.getDataset(params.id)) throw new Error(`dataset not found: ${params.id}`);
    return { data: s.listSolves(params.id) };
  }

  function runSolve({ store: s, params, body }: RouteCtx): ResponseValue {
    const b = (body ?? {}) as { params?: SolveParams };
    const solveParams = validateParams(b.params);
    const { result, cached } = s.runSolve(params.id, solveParams, now);
    return { status: cached ? 200 : 201, data: { result, cached } };
  }

  function replaySolve({ store: s, params, body }: RouteCtx): ResponseValue {
    const b = (body ?? {}) as { rulesVersion?: string; params?: SolveParams };
    const solveParams = validateParams(b.params);
    const result = s.replaySolve(params.id, b.rulesVersion ?? '2025.1', solveParams);
    return { data: { result } };
  }

  function getSolve({ store: s, params }: RouteCtx): ResponseValue {
    const result = s.getSolve(params.hash);
    if (!result) throw new Error(`solve not found: ${params.hash}`);
    return { data: result };
  }

  function exportSolve({ store: s, params }: RouteCtx): ResponseValue {
    const result = s.getSolve(params.hash);
    if (!result) throw new Error(`solve not found: ${params.hash}`);
    const lines = [
      'rank,signature,status,inliers,cost,rms_px,max_residual_px,rotation_deg,mirror,scale_arcsec_per_px,fov_diag_deg,ra0,dec0,image_id,catalog_id,residual_px,angular_arcsec',
    ];
    for (const c of result.candidates) {
      if (c.matches.length === 0) {
        lines.push(csvRow([c.rank, c.signature, c.status, c.inlierCount, c.cost, c.rmsPx, c.maxResidualPx, c.model.rotationDeg, c.model.mirror, c.model.scaleArcsecPerPx, c.model.fovDiagDeg, c.model.ra0, c.model.dec0]));
      }
      for (const m of c.matches) {
        lines.push(
          csvRow([
            c.rank,
            c.signature,
            c.status,
            c.inlierCount,
            c.cost,
            c.rmsPx,
            c.maxResidualPx,
            c.model.rotationDeg,
            c.model.mirror,
            c.model.scaleArcsecPerPx,
            c.model.fovDiagDeg,
            c.model.ra0,
            c.model.dec0,
            m.imageId,
            m.catalogId,
            m.residualPx,
            m.angularArcsec,
          ]),
        );
      }
    }
    return { csv: { filename: `solve-${params.hash}.csv`, content: lines.join('\n') + '\n' } };
  }
}


function validateParams(p: SolveParams | undefined): SolveParams {
  if (!p || typeof p !== 'object') throw new Error('body.params is required');
  const out: SolveParams = {
    fovMinDeg: Number(p.fovMinDeg),
    fovMaxDeg: Number(p.fovMaxDeg),
    maxRotationDeg: Number(p.maxRotationDeg),
    allowMirror: Boolean(p.allowMirror),
    distortionOrder: Number(p.distortionOrder) as 0 | 1 | 2 | 3,
    tolerancePx: Number(p.tolerancePx),
    mismatchCost: Number(p.mismatchCost),
    topK: Number(p.topK),
  };
  if (![0, 1, 2, 3].includes(out.distortionOrder)) throw new Error('distortionOrder must be 0, 1, 2 or 3');
  if (Object.values(out).some((v) => typeof v === 'number' && !Number.isFinite(v))) {
    throw new Error('all numeric params must be finite numbers');
  }
  return out;
}

function validateImageStars(stars: unknown[]): asserts stars {
  for (const s of stars as Array<Record<string, unknown>>) {
    if (typeof s.id !== 'string' || !Number.isFinite(Number(s.x)) || !Number.isFinite(Number(s.y))) {
      throw new Error('each image star requires string id and finite x/y');
    }
    if ((stars as Array<Record<string, unknown>>).filter((o) => o.id === s.id).length > 1) {
      throw new Error(`duplicate image star id: ${String(s.id)}`);
    }
  }
}

function validateCatalogStars(stars: unknown[]): asserts stars {
  const ids = new Set<string>();
  for (const s of stars as Array<Record<string, unknown>>) {
    if (typeof s.id !== 'string' || !Number.isFinite(Number(s.ra)) || !Number.isFinite(Number(s.dec))) {
      throw new Error('each catalog star requires string id and finite ra/dec');
    }
    const ra = Number(s.ra);
    if (ra < 0 || ra >= 360) throw new Error(`ra out of [0,360): ${s.id}`);
    const dec = Number(s.dec);
    if (dec < -90 || dec > 90) throw new Error(`dec out of [-90,90]: ${s.id}`);
    if (ids.has(s.id)) throw new Error(`duplicate catalog star id: ${s.id}`);
    ids.add(s.id);
  }
}

function csvRow(values: Array<string | number | boolean>): string {
  return values
    .map((v) => {
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    })
    .join(',');
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
