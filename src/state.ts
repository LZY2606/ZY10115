import type { Dataset, Evidence, Pair, SolveResult } from '../shared/types.ts';
import { pointInPolygon } from '../shared/solver.ts';
import type { PixelBox } from '../shared/fit.ts';

export interface PreparedView {
  activeImageIds: string[];
  activeCatalogIds: string[];
  locks: Pair[];
  maskRegions: Array<{ polygon: Array<{ x: number; y: number }>; reason?: string }>;
  pixelBox: PixelBox;
}

export function prepareView(dataset: Dataset, result: SolveResult | null): PreparedView {
  const activeImageIds = result
    ? result.activeImageIds
    : computeActiveImages(dataset).map((s) => s.id);
  const activeCatalogIds = result
    ? result.activeCatalogIds
    : [...dataset.catalogStars].map((s) => s.id);
  const locks = dataset.evidence.filter((e) => e.kind === 'lock' && e.pair).map((e) => e.pair!);
  const maskRegions = dataset.evidence
    .filter((e) => e.kind === 'mask-region' && e.polygon)
    .map((e) => ({ polygon: e.polygon!, reason: e.reason }));
  const activeStars = dataset.imageStars.filter((s) => activeImageIds.includes(s.id));
  const pixelBox = boxFrom(activeStars.length ? activeStars : dataset.imageStars);
  return { activeImageIds, activeCatalogIds, locks, maskRegions, pixelBox };
}

export function computeActiveImages(dataset: Dataset) {
  const masked = new Set<string>();
  for (const s of dataset.imageStars) if (s.saturated) masked.add(s.id);
  for (const ev of dataset.evidence) {
    if (ev.kind === 'mask-star' && ev.starId) masked.add(ev.starId);
    if (ev.kind === 'mask-region' && ev.polygon) {
      for (const s of dataset.imageStars) if (pointInPolygon(s.x, s.y, ev.polygon)) masked.add(s.id);
    }
  }
  return dataset.imageStars.filter((s) => !masked.has(s.id));
}

export function boxFrom(points: Array<{ x: number; y: number }>): PixelBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    scale: Math.max(1e-9, Math.hypot(maxX - minX, maxY - minY) * 0.55),
  };
}

export type { Evidence };
