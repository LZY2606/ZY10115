import type { ImageStar, CatalogStar, Pair } from './types.ts';
import { projectToTangent } from './projection.ts';

export interface XY {
  id: string;
  x: number;
  y: number;
}

export interface Quad {
  ids: [string, string, string, string];
  desc: Array<{ u: number; v: number }>;
  order: [number, number, number, number];
  keys: string[];
  bestLen: number;
}

const DESC_DIGITS = 3;
const ALIGN_RADIUS = 0.018;

function r3(n: number): number {
  return Number(n.toFixed(DESC_DIGITS));
}

export function quadDescriptor(chosen: XY[]): Quad {
  const pts = chosen.map((s) => ({ x: s.x, y: s.y }));
  let bestLen = -1;
  let ai = 0;
  let bi = 1;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const len = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (len > bestLen) {
        bestLen = len;
        ai = i;
        bi = j;
      }
    }
  }
  const A = pts[ai];
  const B = pts[bi];
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  const ex = (B.x - A.x) / bestLen;
  const ey = (B.y - A.y) / bestLen;
  const restIdx = [0, 1, 2, 3].filter((idx) => idx !== ai && idx !== bi);
  let ci = restIdx[0];
  let di = restIdx[1];
  const cCross = ex * (pts[ci].y - my) - ey * (pts[ci].x - mx);
  const dCross = ex * (pts[di].y - my) - ey * (pts[di].x - mx);
  if (cCross > dCross) {
    const t = ci;
    ci = di;
    di = t;
  }
  const order = [ci, di, ai, bi] as [number, number, number, number];
  const raw = order.map((idx) => {
    const dx = pts[idx].x - mx;
    const dy = pts[idx].y - my;
    return {
      u: (dx * ex + dy * ey) / bestLen,
      v: (-dx * ey + dy * ex) / bestLen,
    };
  });
  const variants = [
    raw,
    raw.map((p) => ({ u: -p.u, v: p.v })),
    raw.map((p) => ({ u: p.u, v: -p.v })),
    raw.map((p) => ({ u: -p.u, v: -p.v })),
  ];
  const keys = Array.from(
    new Set(
      variants.map(
        (variant) =>
          variant
            .map((p) => `${r3(p.u)},${r3(p.v)}`)
            .sort()
            .join('|'),
      ),
    ),
  ).sort();
  return {
    ids: [chosen[0].id, chosen[1].id, chosen[2].id, chosen[3].id],
    desc: raw,
    order,
    keys,
    bestLen,
  };
}

export function buildQuads(stars: XY[]): Quad[] {
  const quads: Quad[] = [];
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < stars.length; j++) {
      for (let k = j + 1; k < stars.length; k++) {
        for (let l = k + 1; l < stars.length; l++) {
          quads.push(quadDescriptor([stars[i], stars[j], stars[k], stars[l]]));
        }
      }
    }
  }
  return quads;
}

export interface QuadAlignment {
  pairs: Pair[];
  mirror: boolean;
  score: number;
  scaleRatio: number;
}

function matchDescIndices(
  a: Array<{ u: number; v: number }>,
  b: Array<{ u: number; v: number }>,
): { mapping: Array<[number, number]>; score: number } | null {
  const used = new Set<number>();
  const mapping: Array<[number, number]> = [];
  let score = 0;
  for (let ai = 0; ai < a.length; ai++) {
    let hit = -1;
    let bestD = ALIGN_RADIUS;
    for (let bi = 0; bi < b.length; bi++) {
      if (used.has(bi)) continue;
      const dist = Math.hypot(a[ai].u - b[bi].u, a[ai].v - b[bi].v);
      if (dist <= bestD) {
        bestD = dist;
        hit = bi;
      }
    }
    if (hit < 0) return null;
    used.add(hit);
    mapping.push([ai, hit]);
    score += 1 - bestD / ALIGN_RADIUS;
  }
  return { mapping, score };
}

export function alignQuads(iq: Quad, cq: Quad): QuadAlignment | null {
  const flips: Array<{ pts: Array<{ u: number; v: number }>; mirror: boolean }> = [
    { pts: cq.desc, mirror: false },
    { pts: cq.desc.map((p) => ({ u: -p.u, v: p.v })), mirror: true },
    { pts: cq.desc.map((p) => ({ u: p.u, v: -p.v })), mirror: true },
    { pts: cq.desc.map((p) => ({ u: -p.u, v: -p.v })), mirror: false },
  ];
  let best: QuadAlignment | null = null;
  for (const flip of flips) {
    const found = matchDescIndices(iq.desc, flip.pts);
    if (!found) continue;
    const pairs = found.mapping.map(([ii, ci]) => ({
      imageId: iq.ids[iq.order[ii]],
      catalogId: cq.ids[cq.order[ci]],
    }));
    if (!best || found.score > best.score) {
      best = { pairs, mirror: flip.mirror, score: found.score, scaleRatio: cq.bestLen / iq.bestLen };
    }
  }
  return best;
}

export function selectBrightImage(stars: ImageStar[], limit: number): XY[] {
  return [...stars]
    .sort((a, b) => b.flux - a.flux || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
}

export function selectBrightCatalog(stars: CatalogStar[], limit: number): XY[] {
  return [...stars]
    .sort((a, b) => a.mag - b.mag || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit)
    .map((s) => ({ id: s.id, x: 0, y: 0 }));
}

export function catalogProjected(stars: CatalogStar[], ra0: number, dec0: number, limit: number): XY[] {
  const bright = [...stars]
    .sort((a, b) => a.mag - b.mag || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
  return bright.map((s) => {
    const p = projectToTangent(s.ra, s.dec, ra0, dec0);
    return { id: s.id, x: p.xi, y: p.eta };
  });
}
