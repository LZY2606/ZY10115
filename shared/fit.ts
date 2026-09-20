import type { Pair, TransformModel } from './types.ts';
import type { XY } from './quad.ts';
import { lstsq } from './linalg.ts';
import {
  basisCount,
  distortionBasis,
  describeLinear,
  normalizePixel,
} from './model.ts';

export interface PixelBox {
  cx: number;
  cy: number;
  scale: number;
}

export function pixelBoxFrom(points: Array<{ x: number; y: number }>): PixelBox {
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
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = Math.max(1e-9, Math.hypot(maxX - minX, maxY - minY) * 0.55);
  return { cx, cy, scale };
}

export function designRow(x: number, y: number, order: number, box: PixelBox): number[] {
  const { u, v } = normalizePixel(x, y, box);
  const row = [x, y, 1];
  if (order >= 2) {
    for (const [i, j] of distortionBasis(order)) {
      row.push(Math.pow(u, i) * Math.pow(v, j));
    }
  }
  return row;
}

export function paramNames(order: number): string[] {
  const names = ['a', 'b', 'c'];
  for (const [i, j] of distortionBasis(order)) names.push(`p${i}${j}`);
  return names;
}

export interface FitOutcome {
  model: Omit<TransformModel, 'ra0' | 'dec0' | 'fovDiagDeg'>;
  ATA: number[][];
  residualSigma: number;
  singular: boolean;
}

export function fitPlane(
  image: XY[],
  tangent: XY[],
  order: number,
  box: PixelBox,
  weights?: number[],
): FitOutcome {
  const nParams = 3 + basisCount(order);
  const rowsX = image.map((p) => designRow(p.x, p.y, order, box));
  const xi = tangent.map((p) => p.x);
  const eta = tangent.map((p) => p.y);
  const fitXi = lstsq(rowsX, xi, nParams, weights);
  const fitEta = lstsq(rowsX, eta, nParams, weights);
  let residualVar = 0;
  let count = 0;
  for (let r = 0; r < image.length; r++) {
    const w = weights ? weights[r] : 1;
    if (w <= 0) continue;
    const row = rowsX[r];
    let ex = xi[r];
    let ey = eta[r];
    for (let k = 0; k < nParams; k++) {
      ex -= fitXi.coeff[k] * row[k];
      ey -= fitEta.coeff[k] * row[k];
    }
    residualVar += w * (ex * ex + ey * ey);
    count += 1;
  }
  const residualSigma = count > 0 ? Math.sqrt(residualVar / Math.max(1, count)) : 0;
  const nPoly = basisCount(order);
  const model = {
    a: fitXi.coeff[0],
    b: fitXi.coeff[1],
    c: fitXi.coeff[2],
    d: fitEta.coeff[0],
    e: fitEta.coeff[1],
    f: fitEta.coeff[2],
    coeffP: fitXi.coeff.slice(3, 3 + nPoly),
    coeffQ: fitEta.coeff.slice(3, 3 + nPoly),
    order,
    ...describeLinear(fitXi.coeff[0], fitXi.coeff[1], fitEta.coeff[0], fitEta.coeff[1]),
  };
  return {
    model,
    ATA: fitXi.ATA,
    residualSigma,
    singular: fitXi.singular || fitEta.singular,
  };
}

export function fovDiagDeg(model: Pick<TransformModel, 'scaleArcsecPerPx'>, spanPx: number): number {
  return (model.scaleArcsecPerPx * spanPx) / 3600;
}

export function correlationMatrix(ATA: number[][]): number[][] {
  const n = ATA.length;
  const corr = Array.from({ length: n }, () => new Array(n).fill(0));
  const d = new Array(n).fill(0).map((_, i) => Math.sqrt(Math.abs(ATA[i][i])));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) corr[i][j] = 1;
      else if (d[i] > 1e-15 && d[j] > 1e-15) corr[i][j] = ATA[i][j] / (d[i] * d[j]);
      else corr[i][j] = 0;
    }
  }
  return corr;
}

