import type {
  Candidate,
  Dataset,
  Evidence,
  ImageStar,
  CatalogStar,
  MatchedPair,
  Pair,
  RejectedStar,
  SolveParams,
  SolveResult,
  TransformModel,
} from './types.ts';
import { CURRENT_RULES_VERSION } from './rules.ts';
import { meanAngularDeg, angularDistanceDeg, wrap180 } from './angle.ts';
import { projectToTangent } from './projection.ts';
import { alignQuads, buildQuads, catalogProjected, selectBrightImage, type XY } from './quad.ts';
import {
  correlationMatrix,
  designRow,
  fitPlane,
  fovDiagDeg,
  paramNames,
  pixelBoxFrom,
  type PixelBox,
} from './fit.ts';
import { basisCount, pixelToRaDec, pixelToTan } from './model.ts';
import { stableStringify, sha256Hex, shortHash } from './hash.ts';

const IMAGE_QUAD_CAP = 24;
const CATALOG_QUAD_CAP = 24;
const MAX_PROPOSALS_PER_IMAGE_QUAD = 6;
const MAX_PROPOSALS_TOTAL = 1200;
const REFIT_ITERATIONS = 4;
const SEED_MATCH_RADIUS_PX = 6;
const AMBIGUOUS_COST_GAP = 1e-6;

export interface SolveContext {
  dataset: Dataset;
  params: SolveParams;
}

export function computeRequestHash(datasetId: string, params: SolveParams): string {
  return sha256Hex(
    stableStringify({
      rules: CURRENT_RULES_VERSION,
      datasetId,
      params,
    }),
  );
}

interface Prepared {
  dataset: Dataset;
  activeImages: ImageStar[];
  activeCatalog: CatalogStar[];
  locks: Pair[];
  masks: Evidence[];
  ra0: number;
  dec0: number;
  spanPx: number;
  box: PixelBox;
}

export function pointInPolygon(x: number, y: number, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function prepareContext(dataset: Dataset): Prepared {
  const masks = dataset.evidence.filter((e) => e.kind.startsWith('mask-'));
  const locks = dataset.evidence.filter((e) => e.kind === 'lock' && e.pair).map((e) => e.pair!);
  const masked = new Set<string>();
  for (const star of dataset.imageStars) {
    if (star.saturated) masked.add(star.id);
  }
  for (const ev of masks) {
    if (ev.kind === 'mask-star' && ev.starId) masked.add(ev.starId);
    if (ev.kind === 'mask-saturated') {
      for (const star of dataset.imageStars) if (star.saturated) masked.add(star.id);
    }
    if (ev.kind === 'mask-region' && ev.polygon) {
      for (const star of dataset.imageStars) {
        if (pointInPolygon(star.x, star.y, ev.polygon)) masked.add(star.id);
      }
    }
  }
  const activeImages = dataset.imageStars
    .filter((s) => !masked.has(s.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const activeCatalog = [...dataset.catalogStars].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const activeCatalogIds = new Set(activeCatalog.map((s) => s.id));
  const validLocks = locks.filter(
    (p) =>
      dataset.imageStars.some((s) => s.id === p.imageId) &&
      activeCatalogIds.has(p.catalogId) &&
      !masked.has(p.imageId),
  );
  const lockedRa = validLocks
    .map((p) => dataset.catalogStars.find((c) => c.id === p.catalogId)!.ra)
    .filter((ra) => Number.isFinite(ra));
  const lockedDec = validLocks
    .map((p) => dataset.catalogStars.find((c) => c.id === p.catalogId)!.dec)
    .filter((dec) => Number.isFinite(dec));
  const ra0 = lockedRa.length >= 3 ? meanAngularDeg(lockedRa) : meanAngularDeg(activeCatalog.map((c) => c.ra));
  const dec0 =
    lockedDec.length >= 3
      ? lockedDec.reduce((a, b) => a + b, 0) / lockedDec.length
      : activeCatalog.reduce((a, c) => a + c.dec, 0) / Math.max(1, activeCatalog.length);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of activeImages) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
  }
  const spanPx = Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) : 0;
  const box = pixelBoxFrom(activeImages.length ? activeImages : dataset.imageStars);
  return { dataset, activeImages, activeCatalog, locks: validLocks, masks, ra0, dec0, spanPx, box };
}

interface Proposal {
  pairs: Pair[];
  mirror: boolean;
  seed: string;
  score: number;
  scaleRatio: number;
}

function uniquePairs(pairs: Pair[]): Pair[] {
  const seen = new Set<string>();
  const out: Pair[] = [];
  for (const p of pairs) {
    const key = `${p.imageId}|${p.catalogId}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

export function generateProposals(prepared: Prepared, params: SolveParams): Proposal[] {
  const { activeImages, activeCatalog, ra0, dec0, locks } = prepared;
  const span = Math.max(prepared.spanPx, 1);
  const minRadPerPx = (params.fovMinDeg / Math.SQRT2 / span) * (Math.PI / 180);
  const maxRadPerPx = (params.fovMaxDeg * Math.SQRT2 / span) * (Math.PI / 180);
  const proposals: Proposal[] = [];
  const seenProposal = new Set<string>();
  const pushProposal = (pairs: Pair[], mirror: boolean, seed: string, score: number, scaleRatio: number) => {
    const uniq = uniquePairs(pairs);
    if (uniq.length < 3) return;
    const sig = uniq
      .map((p) => `${p.imageId}:${p.catalogId}`)
      .sort()
      .join(';');
    const key = `${mirror ? 'M' : 'R'}#${sig}`;
    if (seenProposal.has(key)) return;
    seenProposal.add(key);
    proposals.push({ pairs: uniq, mirror, seed, score, scaleRatio });
  };

  const imageXY = selectBrightImage(activeImages, IMAGE_QUAD_CAP);
  const catXY = catalogProjected(activeCatalog, ra0, dec0, CATALOG_QUAD_CAP).filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  if (imageXY.length >= 4 && catXY.length >= 4) {
    const imageQuads = buildQuads(imageXY);
    const catQuads = buildQuads(catXY);
    const catByKey = new Map<string, Array<{ quad: (typeof catQuads)[number] }>>();
    for (const quad of catQuads) {
      for (const key of quad.keys) {
        const list = catByKey.get(key) ?? [];
        list.push({ quad });
        catByKey.set(key, list);
      }
    }
    const scoredSeeds: Array<{ iq: (typeof imageQuads)[number]; alignment: NonNullable<ReturnType<typeof alignQuads>> }> = [];
    for (const iq of imageQuads) {
      const candidateQuads: Array<(typeof catQuads)[number]> = [];
      for (const key of iq.keys) {
        for (const entry of catByKey.get(key) ?? []) candidateQuads.push(entry.quad);
      }
      candidateQuads.sort((a, b) => (a.ids.join() < b.ids.join() ? -1 : 1));
      let addedForThis = 0;
      for (const cq of candidateQuads) {
        if (addedForThis >= MAX_PROPOSALS_PER_IMAGE_QUAD) break;
        const alignment = alignQuads(iq, cq);
        if (!alignment) continue;
        if (alignment.mirror && !params.allowMirror) continue;
        const approxRadPerPx = alignment.scaleRatio;
        if (!(approxRadPerPx >= minRadPerPx * 0.4 && approxRadPerPx <= maxRadPerPx * 2.5)) continue;
        scoredSeeds.push({ iq, alignment });
        addedForThis += 1;
      }
    }
    scoredSeeds.sort((a, b) => b.alignment.score - a.alignment.score || a.iq.ids.join().localeCompare(b.iq.ids.join()));
    for (const seed of scoredSeeds.slice(0, MAX_PROPOSALS_TOTAL)) {
      pushProposal(seed.alignment.pairs, seed.alignment.mirror, `quad:${seed.iq.ids.join(',')}`, seed.alignment.score, seed.alignment.scaleRatio);
    }
  }

  if (locks.length >= 3) {
    pushProposal(
      locks,
      false,
      `lock:${locks.map((p) => `${p.imageId}-${p.catalogId}`).sort().join(',')}`,
      Infinity,
      Infinity,
    );
  }
  return proposals;
}

function pairsToPoints(pairs: Pair[], imageById: Map<string, ImageStar>, catalogTanById: Map<string, XY>) {
  const img: XY[] = [];
  const tan: XY[] = [];
  const usedPairs: Pair[] = [];
  for (const p of pairs) {
    const im = imageById.get(p.imageId);
    const ct = catalogTanById.get(p.catalogId);
    if (im && ct && Number.isFinite(ct.x) && Number.isFinite(ct.y)) {
      img.push({ id: im.id, x: im.x, y: im.y });
      tan.push(ct);
      usedPairs.push(p);
    }
  }
  return { img, tan, usedPairs };
}

function rotationGate(rotationDeg: number, maxRotationDeg: number): boolean {
  const dist = Math.min(rotationDeg, 360 - rotationDeg);
  return dist <= maxRotationDeg + 1e-9;
}

interface AssembledModel {
  model: TransformModel;
  ATA: number[][];
}

function assembleModel(
  img: XY[],
  tan: XY[],
  params: SolveParams,
  prepared: Prepared,
  weights?: number[],
): AssembledModel | null {
  if (img.length < 3) return null;
  const fit = fitPlane(img, tan, 1, prepared.box, weights);
  if (fit.singular || !Number.isFinite(fit.model.a)) return null;
  const fov = fovDiagDeg(fit.model, prepared.spanPx || 1);
  if (!(fov >= params.fovMinDeg - 1e-9 && fov <= params.fovMaxDeg + 1e-9)) return null;
  if (!rotationGate(fit.model.rotationDeg, params.maxRotationDeg)) return null;
  const model: TransformModel = {
    ...fit.model,
    order: 1,
    coeffP: [],
    coeffQ: [],
    ra0: prepared.ra0,
    dec0: prepared.dec0,
    fovDiagDeg: fov,
  };
  return { model, ATA: fit.ATA };
}

interface GreedyResult {
  pairs: Pair[];
  residuals: Map<string, number>;
  outlierPairs: Array<{ pair: Pair; residual: number }>;
}

function greedyMatch(
  model: TransformModel,
  prepared: Prepared,
  tolerancePx: number,
  forced: Pair[],
): GreedyResult {
  const catalogTan: Array<XY & { id: string }> = [];
  for (const cat of prepared.activeCatalog) {
    const t = projectToTangent(cat.ra, cat.dec, model.ra0, model.dec0);
    if (Number.isFinite(t.xi)) catalogTan.push({ id: cat.id, x: t.xi, y: t.eta });
  }
  const assignedImage = new Set<string>();
  const assignedCatalog = new Set<string>();
  const forcedMap = new Map<string, string>();
  for (const p of forced) {
    forcedMap.set(p.imageId, p.catalogId);
    assignedImage.add(p.imageId);
    assignedCatalog.add(p.catalogId);
  }
  const options: Array<{ imageId: string; catalogId: string; dist: number }> = [];
  for (const im of prepared.activeImages) {
    const predicted = pixelToTan(model, im.x, im.y, prepared.box);
    for (const ct of catalogTan) {
      const dist = modelScaleDistancePx(model, predicted, ct);
      if (dist <= tolerancePx) {
        options.push({ imageId: im.id, catalogId: ct.id, dist });
      }
    }
  }
  options.sort((a, b) => a.dist - b.dist || (a.imageId < b.imageId ? -1 : 1) || (a.catalogId < b.catalogId ? -1 : 1));
  const chosen = new Map<string, { catalogId: string; dist: number }>();
  for (const opt of options) {
    if (assignedImage.has(opt.imageId) || assignedCatalog.has(opt.catalogId)) continue;
    assignedImage.add(opt.imageId);
    assignedCatalog.add(opt.catalogId);
    chosen.set(opt.imageId, { catalogId: opt.catalogId, dist: opt.dist });
  }
  const pairs: Pair[] = [...forced];
  const residuals = new Map<string, number>();
  for (const [imageId, info] of chosen) {
    pairs.push({ imageId, catalogId: info.catalogId });
    residuals.set(imageId, info.dist);
  }
  for (const p of forced) {
    const im = prepared.activeImages.find((s) => s.id === p.imageId);
    const ct = catalogTan.find((c) => c.id === p.catalogId);
    if (im && ct) {
      const predicted = pixelToTan(model, im.x, im.y, prepared.box);
      residuals.set(p.imageId, modelScaleDistancePx(model, predicted, ct));
    }
  }
  const outlierPairs: Array<{ pair: Pair; residual: number }> = [];
  for (const p of forced) {
    const r = residuals.get(p.imageId) ?? Infinity;
    if (r > tolerancePx) outlierPairs.push({ pair: p, residual: r });
  }
  return { pairs, residuals, outlierPairs };
}

function radPerPx(model: TransformModel): number {
  return (model.scaleArcsecPerPx / 3600) * (Math.PI / 180);
}

function modelScaleDistancePx(
  model: TransformModel,
  predictedTan: { xi: number; eta: number },
  catalogTan: XY,
): number {
  return Math.hypot(predictedTan.xi - catalogTan.x, predictedTan.eta - catalogTan.y) / (radPerPx(model) || 1e-12);
}

interface Refined {
  model: TransformModel;
  ATA: number[][];
  inlierPairs: Pair[];
  outlierPairs: Pair[];
  residuals: Map<string, number>;
  rmsPx: number;
  maxResidualPx: number;
}

function refineProposal(proposal: Proposal, prepared: Prepared, params: SolveParams): Refined | null {
  const imageById = new Map(prepared.activeImages.map((s) => [s.id, s]));
  const catalogTanById = new Map<string, XY>();
  for (const cat of prepared.activeCatalog) {
    const t = projectToTangent(cat.ra, cat.dec, prepared.ra0, prepared.dec0);
    catalogTanById.set(cat.id, { id: cat.id, x: t.xi, y: t.eta });
  }
  let currentPairs = proposal.pairs;
  let assembled: AssembledModel | null = null;
  let lastMatch: GreedyResult | null = null;
  for (let iter = 0; iter < REFIT_ITERATIONS; iter++) {
    const pts = pairsToPoints(currentPairs, imageById, catalogTanById);
    assembled = assembleModel(pts.img, pts.tan, params, prepared);
    if (!assembled) return null;
    const match = greedyMatch(assembled.model, prepared, params.tolerancePx, prepared.locks);
    currentPairs = match.pairs;
    lastMatch = match;
  }
  if (!assembled || !lastMatch) return null;

  const lockSet = new Set(prepared.locks.map((p) => `${p.imageId}|${p.catalogId}`));
  const inlierPairs: Pair[] = [];
  const outlierPairs: Pair[] = [];
  let sumSq = 0;
  let maxRes = 0;
  for (const p of currentPairs) {
    const r = lastMatch.residuals.get(p.imageId) ?? 0;
    const isLock = lockSet.has(`${p.imageId}|${p.catalogId}`);
    if (r <= params.tolerancePx || isLock) {
      inlierPairs.push(p);
      sumSq += r * r;
      maxRes = Math.max(maxRes, r);
    } else {
      outlierPairs.push(p);
    }
  }
  const pts = pairsToPoints(inlierPairs, imageById, catalogTanById);
  const finalFit = fitPlane(pts.img, pts.tan, params.distortionOrder, prepared.box);
  if (finalFit.singular) return null;
  const fov = fovDiagDeg(finalFit.model, prepared.spanPx || 1);
  if (!(fov >= params.fovMinDeg - 1e-9 && fov <= params.fovMaxDeg + 1e-9)) return null;
  if (!rotationGate(finalFit.model.rotationDeg, params.maxRotationDeg)) return null;
  const model: TransformModel = { ...finalFit.model, ra0: prepared.ra0, dec0: prepared.dec0, fovDiagDeg: fov };

  const residuals = new Map<string, number>();
  let finalSq = 0;
  let finalMax = 0;
  const finalInlier: Pair[] = [];
  const finalOutlier: Pair[] = [];
  for (const p of inlierPairs) {
    const im = imageById.get(p.imageId);
    const ct = catalogTanById.get(p.catalogId);
    if (!im || !ct) continue;
    const pred = pixelToTan(model, im.x, im.y, prepared.box);
    const r = Math.hypot(pred.xi - ct.x, pred.eta - ct.y) / (radPerPx(model) || 1e-12);
    residuals.set(p.imageId, r);
    finalSq += r * r;
    finalMax = Math.max(finalMax, r);
    finalInlier.push(p);
  }
  for (const p of outlierPairs) finalOutlier.push(p);
  return {
    model,
    ATA: finalFit.ATA,
    inlierPairs: finalInlier,
    outlierPairs: finalOutlier,
    residuals,
    rmsPx: Math.sqrt(finalSq / Math.max(1, finalInlier.length)),
    maxResidualPx: finalMax,
  };
}

function buildCandidate(
  refined: Refined,
  prepared: Prepared,
  params: SolveParams,
  proposal: Proposal,
): Candidate {
  const imageById = new Map(prepared.activeImages.map((s) => [s.id, s]));
  const catalogById = new Map(prepared.activeCatalog.map((s) => [s.id, s]));
  const inlierImageIds = new Set(refined.inlierPairs.map((p) => p.imageId));
  const inlierCatalogIds = new Set(refined.inlierPairs.map((p) => p.catalogId));
  const outlierImageIds = new Set(refined.outlierPairs.map((p) => p.imageId));

  const matches: MatchedPair[] = refined.inlierPairs
    .map((p) => {
      const im = imageById.get(p.imageId)!;
      const cat = catalogById.get(p.catalogId)!;
      const pred = pixelToRaDec(refined.model, im.x, im.y, prepared.box);
      const residualPx = refined.residuals.get(p.imageId) ?? 0;
      const dRa = wrap180(pred.ra - cat.ra) * Math.cos((cat.dec * Math.PI) / 180);
      const dDec = pred.dec - cat.dec;
      return {
        imageId: p.imageId,
        catalogId: p.catalogId,
        dx: dRa * 3600,
        dy: dDec * 3600,
        residualPx,
        angularArcsec: angularDistanceDeg(pred.ra, pred.dec, cat.ra, cat.dec) * 3600,
      };
    })
    .sort((a, b) => a.imageId < b.imageId ? -1 : a.imageId > b.imageId ? 1 : 0);

  const rejected: RejectedStar[] = [];
  for (const im of prepared.activeImages) {
    if (inlierImageIds.has(im.id)) continue;
    if (outlierImageIds.has(im.id)) {
      rejected.push({ imageId: im.id, reason: 'outlier', detail: 'matched but exceeds tolerance', x: im.x, y: im.y });
    } else {
      rejected.push({ imageId: im.id, reason: 'unmatched-image', detail: 'no catalog star within tolerance', x: im.x, y: im.y });
    }
  }
  for (const cat of prepared.activeCatalog) {
    if (!inlierCatalogIds.has(cat.id)) {
      rejected.push({ catalogId: cat.id, reason: 'unmatched-catalog', detail: 'no image star maps to this catalog entry' });
    }
  }
  const maskedImageIds = new Set(
    prepared.dataset.imageStars.filter((s) => !prepared.activeImages.some((a) => a.id === s.id)).map((s) => s.id),
  );
  for (const id of maskedImageIds) {
    const im = prepared.dataset.imageStars.find((s) => s.id === id)!;
    rejected.push({ imageId: id, reason: 'masked', detail: 'excluded by evidence (saturation/manual/trajectory)', x: im.x, y: im.y });
  }

  const nMismatch = rejected.filter((r) => r.reason === 'unmatched-image' || r.reason === 'unmatched-catalog').length;
  const mismatchPenalty = nMismatch * params.mismatchCost;
  const rmsTerm = refined.rmsPx * refined.rmsPx;
  const cost = rmsTerm + mismatchPenalty;

  const names = [...paramNames(params.distortionOrder), ...paramNames(params.distortionOrder).map((n) => 'q' + n.slice(1))];
  const np = 3 + basisCount(params.distortionOrder);
  const block = refined.ATA;
  const size = np * 2;
  const fullATA = Array.from({ length: size }, (_, i) => new Array(size).fill(0));
  for (let i = 0; i < np; i++) {
    for (let j = 0; j < np; j++) {
      fullATA[i][j] = block[i][j];
      fullATA[np + i][np + j] = block[i][j];
    }
  }
  const correlation = correlationMatrix(fullATA);
  const signature = shortHash(
    refined.inlierPairs
      .map((p) => `${p.imageId}:${p.catalogId}`)
      .sort()
      .join(';'),
  );

  return {
    rank: 0,
    signature,
    status: 'ok',
    model: refined.model,
    matches,
    rejected: rejected.sort((a, b) => (a.imageId ?? a.catalogId!) < (b.imageId ?? b.catalogId!) ? -1 : 1),
    rmsPx: refined.rmsPx,
    maxResidualPx: refined.maxResidualPx,
    mismatchPenalty,
    cost,
    inlierCount: refined.inlierPairs.length,
    parameterCorrelation: correlation,
    parameterNames: names,
    quadSeeds: [proposal.seed],
  };
}

function validate(params: SolveParams): string | null {
  if (!(params.fovMinDeg > 0 && params.fovMaxDeg >= params.fovMinDeg)) return 'FOV range invalid (need 0 < fovMin <= fovMax)';
  if (params.maxRotationDeg < 0 || params.maxRotationDeg > 180) return 'maxRotationDeg must be within [0, 180]';
  if (params.tolerancePx <= 0) return 'tolerancePx must be positive';
  if (params.mismatchCost < 0) return 'mismatchCost must be non-negative';
  if (params.topK < 1) return 'topK must be >= 1';
  if (![0, 1, 2, 3].includes(params.distortionOrder)) return 'distortionOrder must be 0, 1, 2 or 3';
  return null;
}

function nonCollinear(pairs: Pair[], dataset: Dataset): boolean {
  if (pairs.length < 3) return false;
  const pts = pairs
    .map((p) => dataset.imageStars.find((s) => s.id === p.imageId))
    .filter((s): s is ImageStar => Boolean(s))
    .slice(0, 3);
  if (pts.length < 3) return false;
  const area = Math.abs(
    (pts[1].x - pts[0].x) * (pts[2].y - pts[0].y) -
    (pts[2].x - pts[0].x) * (pts[1].y - pts[0].y),
  );
  return area > 1e-9;
}

export function solve(dataset: Dataset, params: SolveParams): SolveResult {
  const prepared = prepareContext(dataset);
  const requestHash = computeRequestHash(dataset.id, params);
  const evidenceSummary = (['lock', 'mask-saturated', 'mask-star', 'mask-region'] as const).map((kind) => ({
    kind,
    count: dataset.evidence.filter((e) => e.kind === kind).length,
  }));
  const baseResult: Omit<SolveResult, 'status' | 'candidates' | 'underdeterminedReason'> = {
    requestHash,
    rulesVersion: CURRENT_RULES_VERSION,
    activeImageIds: prepared.activeImages.map((s) => s.id),
    activeCatalogIds: prepared.activeCatalog.map((s) => s.id),
    locks: prepared.locks,
    evidenceSummary,
    createdAt: new Date(0).toISOString(),
  };

  const invalid = validate(params);
  if (invalid) {
    return { ...baseResult, status: 'error', underdeterminedReason: invalid, candidates: [] };
  }
  if (prepared.activeImages.length < 4) {
    return {
      ...baseResult,
      status: 'underdetermined',
      underdeterminedReason: 'fewer than 4 active image stars: quad geometry cannot be seeded',
      candidates: [],
    };
  }
  if (prepared.activeCatalog.length < 4) {
    return {
      ...baseResult,
      status: 'underdetermined',
      underdeterminedReason: 'fewer than 4 active catalog stars: reference geometry unavailable',
      candidates: [],
    };
  }
  if (prepared.locks.length > 0 && prepared.locks.length < 3) {
    return {
      ...baseResult,
      status: 'underdetermined',
      underdeterminedReason: `${prepared.locks.length} locked pair(s): a 2-D transform needs 3 non-collinear correspondences`,
      candidates: [],
    };
  }
  if (prepared.locks.length >= 3 && !nonCollinear(prepared.locks, dataset)) {
    return {
      ...baseResult,
      status: 'underdetermined',
      underdeterminedReason: 'locked points are collinear: rotation and scale cannot be separated',
      candidates: [],
    };
  }

  const proposals = generateProposals(prepared, params);
  if (proposals.length === 0) {
    return {
      ...baseResult,
      status: 'underdetermined',
      underdeterminedReason: 'no geometrically consistent quad seed: FOV/rotation/mirror settings leave no alignment',
      candidates: [],
    };
  }

  const dedup = new Map<string, Candidate>();
  for (const proposal of proposals) {
    const refined = refineProposal(proposal, prepared, params);
    if (!refined) continue;
    const candidate = buildCandidate(refined, prepared, params, proposal);
    const existing = dedup.get(candidate.signature);
    if (!existing || candidate.cost < existing.cost) dedup.set(candidate.signature, candidate);
    else if (candidate.cost === existing.cost) existing.quadSeeds.push(...candidate.quadSeeds);
  }
  const candidates = Array.from(dedup.values());
  candidates.sort(
    (a, b) =>
      a.cost - b.cost ||
      b.inlierCount - a.inlierCount ||
      a.signature.localeCompare(b.signature),
  );

  if (candidates.length === 0) {
    return {
      ...baseResult,
      status: 'underdetermined',
      underdeterminedReason: 'all seed alignments failed FOV/rotation gates or singular fits: tighten or widen constraints',
      candidates: [],
    };
  }

  const top = candidates.slice(0, params.topK).map((c, i) => ({ ...c, rank: i + 1, quadSeeds: Array.from(new Set(c.quadSeeds)).sort() }));
  let status: SolveResult['status'] = 'ok';
  let reason: string | undefined;
  const minNeeded = params.distortionOrder >= 1 ? 4 : 3;
  if (top[0].inlierCount < minNeeded) {
    status = 'underdetermined';
    reason = `best candidate has ${top[0].inlierCount} inliers: ${minNeeded} correspondences needed at order ${params.distortionOrder}`;
  } else if (top.length >= 2 && top[1].cost - top[0].cost <= AMBIGUOUS_COST_GAP) {
    status = 'underdetermined';
    reason = `top candidates are indistinguishable (cost gap ${(top[1].cost - top[0].cost).toExponential(1)} <= ${AMBIGUOUS_COST_GAP}): add locks or mask artifacts`;
  }
  if (status === 'underdetermined') {
    for (const c of top) {
      c.status = 'underdetermined';
      c.underdeterminedReason = reason;
    }
  }
  return { ...baseResult, status, underdeterminedReason: reason, candidates: top };
}
