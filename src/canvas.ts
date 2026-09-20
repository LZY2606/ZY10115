import type { Candidate, Dataset } from '../shared/types.ts';
import type { PreparedView } from './state.ts';
import { raDecToPixel } from '../shared/model.ts';

export interface ViewOptions {
  showMatches: boolean;
  showResiduals: boolean;
  showRejected: boolean;
  showLabels: boolean;
  showCatalog: boolean;
  residualScale: number;
}

export function computeBounds(dataset: Dataset, activeImageIds: string[]) {
  const active = new Set(activeImageIds);
  const pts = dataset.imageStars.filter((s) => active.has(s.id));
  const use = pts.length >= 2 ? pts : dataset.imageStars;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of use) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 1000;
    maxY = 1000;
  }
  const pad = Math.max(20, 0.04 * Math.max(maxX - minX, maxY - minY));
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function renderScene(
  canvas: HTMLCanvasElement,
  dataset: Dataset,
  view: PreparedView,
  candidate: Candidate | null,
  opts: ViewOptions,
) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const bounds = computeBounds(dataset, view.activeImageIds);
  const scale = Math.min(
    rect.width / (bounds.maxX - bounds.minX),
    rect.height / (bounds.maxY - bounds.minY),
  );
  const tx = (x: number) => (x - bounds.minX) * scale;
  const ty = (y: number) => (y - bounds.minY) * scale;

  for (const region of view.maskRegions) {
    ctx.beginPath();
    region.polygon.forEach((p, i) => (i === 0 ? ctx.moveTo(tx(p.x), ty(p.y)) : ctx.lineTo(tx(p.x), ty(p.y))));
    ctx.closePath();
    ctx.fillStyle = 'rgba(248,81,73,0.10)';
    ctx.strokeStyle = 'rgba(248,81,73,0.55)';
    ctx.setLineDash([5, 4]);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const imageById = new Map(dataset.imageStars.map((s) => [s.id, s]));
  const activeIds = new Set(view.activeImageIds);
  const matchedIds = new Set(candidate?.matches.map((m) => m.imageId));
  const outlierIds = new Set(
    candidate?.rejected.filter((r) => r.reason === 'outlier').map((r) => r.imageId!),
  );
  const lockIds = new Set(view.locks.map((p) => p.imageId));

  for (const star of dataset.imageStars) {
    const x = tx(star.x);
    const y = ty(star.y);
    const r = Math.max(2, Math.min(6, 1.5 + Math.log10(1 + Math.max(0, star.flux)) * 0.9));
    if (!activeIds.has(star.id)) {
      ctx.strokeStyle = 'rgba(248,81,73,0.85)';
      ctx.fillStyle = 'rgba(248,81,73,0.25)';
      drawCross(ctx, x, y, r + 2);
      continue;
    }
    if (matchedIds.has(star.id)) {
      ctx.fillStyle = '#58a6ff';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (outlierIds.has(star.id) && opts.showRejected) {
      ctx.fillStyle = '#d29922';
      ctx.beginPath();
      ctx.arc(x, y, r + 1, 0, Math.PI * 2);
      ctx.fill();
    } else if (!matchedIds.has(star.id) && opts.showRejected) {
      ctx.fillStyle = 'rgba(139,152,167,0.65)';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.75, 0, Math.PI * 2);
      ctx.fill();
    } else if (!candidate) {
      ctx.fillStyle = '#c9d1d9';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (lockIds.has(star.id)) {
      ctx.strokeStyle = '#3fb950';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    if (star.saturated && activeIds.has(star.id)) {
      ctx.strokeStyle = '#f85149';
      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const catalogProjected = new Map<string, { x: number; y: number }>();
  if (candidate) {
    for (const catId of view.activeCatalogIds) {
      const star = dataset.catalogStars.find((c) => c.id === catId);
      if (!star) continue;
      const p = raDecToPixel(candidate.model, star.ra, star.dec, view.pixelBox);
      if (Number.isFinite(p.x)) catalogProjected.set(catId, p);
    }
  }

  if (candidate && opts.showCatalog) {
    const matchedCatalog = new Set(candidate.matches.map((m) => m.catalogId));
    ctx.lineWidth = 1;
    for (const [catId, p] of catalogProjected) {
      ctx.strokeStyle = matchedCatalog.has(catId) ? 'rgba(192,132,252,0.9)' : 'rgba(192,132,252,0.4)';
      ctx.strokeRect(tx(p.x) - 3, ty(p.y) - 3, 6, 6);
    }
  }

  if (candidate && opts.showMatches) {
    for (const m of candidate.matches) {
      const im = imageById.get(m.imageId);
      const p = catalogProjected.get(m.catalogId);
      if (!im || !p) continue;
      ctx.strokeStyle = 'rgba(88,166,255,0.55)';
      ctx.beginPath();
      ctx.moveTo(tx(im.x), ty(im.y));
      ctx.lineTo(tx(p.x), ty(p.y));
      ctx.stroke();
    }
  }

  if (candidate && opts.showResiduals) {
    for (const m of candidate.matches) {
      const im = imageById.get(m.imageId);
      const p = catalogProjected.get(m.catalogId);
      if (!im || !p) continue;
      const fromX = tx(im.x);
      const fromY = ty(im.y);
      const toX = tx(p.x);
      const toY = ty(p.y);
      const dx = toX - fromX;
      const dy = toY - fromY;
      const naturalLen = Math.hypot(dx, dy);
      const targetLen = Math.max(5, Math.min(80, m.residualPx * scale * opts.residualScale));
      const len = naturalLen || 1;
      const ex = fromX + (dx / len) * targetLen;
      const ey = fromY + (dy / len) * targetLen;
      ctx.strokeStyle = '#f0883e';
      ctx.fillStyle = '#f0883e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ex, ey, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1;
    }
  }

  if (opts.showLabels) {
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(230,237,243,0.7)';
    for (const star of dataset.imageStars) {
      if (!activeIds.has(star.id)) continue;
      ctx.fillText(star.id, tx(star.x) + 5, ty(star.y) - 5);
    }
  }
}

function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r);
  ctx.lineTo(x - r, y + r);
  ctx.stroke();
  ctx.lineWidth = 1;
}
