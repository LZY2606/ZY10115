import type { TransformModel } from './types.ts';
import { DEG, wrap360, angularDistanceDeg } from './angle.ts';
import { projectToTangent, tangentToRaDec } from './projection.ts';

export interface PixelBox {
  cx: number;
  cy: number;
  scale: number;
}

export function distortionBasis(order: number): Array<[number, number]> {
  if (order <= 1) return [];
  const terms: Array<[number, number]> = [];
  for (let i = 0; i <= order; i++) {
    for (let j = 0; j <= order - i; j++) {
      const deg = i + j;
      if (deg >= 2 && deg <= order) terms.push([i, j]);
    }
  }
  terms.sort((a, b) => a[0] + a[1] - b[0] - b[1] || a[0] - b[0] || a[1] - b[1]);
  return terms;
}

export function basisCount(order: number): number {
  return distortionBasis(order).length;
}

export function normalizePixel(x: number, y: number, box: PixelBox): { u: number; v: number } {
  return { u: (x - box.cx) / box.scale, v: (y - box.cy) / box.scale };
}

export function evalPoly(coeff: number[], u: number, v: number, order: number): number {
  const basis = distortionBasis(order);
  let s = 0;
  for (let k = 0; k < basis.length; k++) {
    const [i, j] = basis[k];
    s += coeff[k] * Math.pow(u, i) * Math.pow(v, j);
  }
  return s;
}

export function pixelToTan(model: TransformModel, x: number, y: number, box: PixelBox) {
  const { u, v } = normalizePixel(x, y, box);
  const xi = model.a * x + model.b * y + model.c + evalPoly(model.coeffP, u, v, model.order);
  const eta = model.d * x + model.e * y + model.f + evalPoly(model.coeffQ, u, v, model.order);
  return { xi, eta };
}

export function pixelToRaDec(model: TransformModel, x: number, y: number, box: PixelBox) {
  const { xi, eta } = pixelToTan(model, x, y, box);
  return tangentToRaDec(xi, eta, model.ra0, model.dec0);
}

export function tanToPixel(model: TransformModel, xi: number, eta: number, box: PixelBox): { x: number; y: number } {
  const det = model.a * model.e - model.b * model.d;
  let x = 0;
  let y = 0;
  if (model.order <= 1) {
    const px = (model.e * (xi - model.c) - model.b * (eta - model.f)) / det;
    const py = (-model.d * (xi - model.c) + model.a * (eta - model.f)) / det;
    return { x: px, y: py };
  }
  for (let iter = 0; iter < 12; iter++) {
    const { u, v } = normalizePixel(x, y, box);
    const pp = evalPoly(model.coeffP, u, v, model.order);
    const pq = evalPoly(model.coeffQ, u, v, model.order);
    const rx = model.a * x + model.b * y + model.c + pp - xi;
    const ry = model.d * x + model.e * y + model.f + pq - eta;
    const epsP = 1e-7 * box.scale;
    const u0 = (x - box.cx) / box.scale;
    const v0 = (y - box.cy) / box.scale;
    const dPPx = (polyAt(model, x + epsP, y, box, true) - pp) / epsP;
    const dPPy = (polyAt(model, x, y + epsP, box, true) - pp) / epsP;
    const dPQx = (polyAt(model, x + epsP, y, box, false) - pq) / epsP;
    const dPQy = (polyAt(model, x, y + epsP, box, false) - pq) / epsP;
    void u0;
    void v0;
    const j11 = model.a + dPPx;
    const j12 = model.b + dPPy;
    const j21 = model.d + dPQx;
    const j22 = model.e + dPQy;
    const jd = j11 * j22 - j12 * j21;
    if (Math.abs(jd) < 1e-18) break;
    const dx = (j22 * rx - j12 * ry) / jd;
    const dy = (-j21 * rx + j11 * ry) / jd;
    x -= dx;
    y -= dy;
    if (Math.hypot(dx, dy) < 1e-10) break;
  }
  return { x, y };
}

function polyAt(model: TransformModel, x: number, y: number, box: PixelBox, whichP: boolean): number {
  const { u, v } = normalizePixel(x, y, box);
  return evalPoly(whichP ? model.coeffP : model.coeffQ, u, v, model.order);
}

export function describeLinear(a: number, b: number, d: number, e: number): {
  scaleArcsecPerPx: number;
  rotationDeg: number;
  mirror: boolean;
} {
  const s1 = Math.hypot(a, b);
  const s2 = Math.hypot(d, e);
  const scaleRadPerPx = (s1 + s2) / 2;
  const det = a * e - b * d;
  const mirror = det < 0;
  let rot: number;
  if (!mirror) {
    rot = Math.atan2(-b, a) * DEG;
  } else {
    rot = Math.atan2(b, a) * DEG;
  }
  return { scaleArcsecPerPx: scaleRadPerPx * DEG * 3600, rotationDeg: wrap360(rot), mirror };
}


export function raDecToPixel(model: TransformModel, ra: number, dec: number, box: PixelBox): { x: number; y: number } {
  const t = projectToTangent(ra, dec, model.ra0, model.dec0);
  return tanToPixel(model, t.xi, t.eta, box);
}
