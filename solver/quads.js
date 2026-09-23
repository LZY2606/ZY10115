// Scale/rotation/translation-invariant quad hashing (astrometry.net style).
//
// For 4 points, take the most separated pair (A, B) and map the plane with a
// similarity so A -> (0,0), B -> (1,0). The images of the remaining two
// points (canonical order: sorted by x, then y) form the hash
// [Cx, Cy, Dx, Dy]. A mirror reflection conjugates the hash (Cy, Dy change
// sign), so mirrored candidates are found by querying the conjugated,
// re-canonicalized hash -- and are reported with parity = -1, never mixed
// with plain rotations.

function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }

/** Complex division: (p - a) / (b - a) for 2-vectors. */
function normalize(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const denom = dx * dx + dy * dy;
  const ex = p[0] - a[0];
  const ey = p[1] - a[1];
  return [(ex * dx + ey * dy) / denom, (ey * dx - ex * dy) / denom];
}

function canonicalize(p, q) {
  // Deterministic order: smaller x first, then smaller y.
  if (p[0] < q[0] || (p[0] === q[0] && p[1] <= q[1])) return [p, q];
  return [q, p];
}

/**
 * Hash 4 points (each [x, y]). Returns
 * { hash: [Cx, Cy, Dx, Dy], indices: [iA, iB, iC, iD] } or null when the
 * quad is degenerate (a remainder point too close to A or B).
 */
export function hashQuad(points) {
  // Most distant pair.
  let best = -1; let iA = 0; let iB = 1;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const d = sub(points[i], points[j]);
      const dist2 = d[0] * d[0] + d[1] * d[1];
      if (dist2 > best) { best = dist2; iA = i; iB = j; }
    }
  }
  if (best <= 0) return null;
  const rest = [];
  for (let i = 0; i < 4; i++) if (i !== iA && i !== iB) rest.push(i);
  const a = points[iA];
  const b = points[iB];
  const p = normalize(points[rest[0]], a, b);
  const q = normalize(points[rest[1]], a, b);
  // Reject near-degenerate quads: remainder points must sit well off A and B.
  for (const r of [p, q]) {
    const d0 = r[0] * r[0] + r[1] * r[1];
    const d1 = (r[0] - 1) * (r[0] - 1) + r[1] * r[1];
    if (d0 < 0.02 || d1 < 0.02) return null;
  }
  const [c, d] = canonicalize(p, q);
  const iC = (p === c) ? rest[0] : rest[1];
  const iD = (p === c) ? rest[1] : rest[0];
  return { hash: [c[0], c[1], d[0], d[1]], indices: [iA, iB, iC, iD] };
}

/** Mirrored variant of a hash: conjugate then re-canonicalize. */
export function mirrorHash(hash) {
  const p = [hash[0], -hash[1]];
  const q = [hash[2], -hash[3]];
  const [c, d] = canonicalize(p, q);
  return [c[0], c[1], d[0], d[1]];
}

/** Enumerate all usable quads over points: [{x, y, ...}] (id-stable order). */
export function enumerateQuads(points) {
  const pts = points.map((p) => [p.x, p.y]);
  const quads = [];
  const n = points.length;
  for (let i = 0; i < n - 3; i++)
    for (let j = i + 1; j < n - 2; j++)
      for (let k = j + 1; k < n - 1; k++)
        for (let l = k + 1; l < n; l++) {
          const combo = [i, j, k, l];
          const h = hashQuad(combo.map((m) => pts[m]));
          // members: point indices ordered as [A, B, C, D] of the hash frame.
          if (h) quads.push({ hash: h.hash, members: h.indices.map((idx) => combo[idx]) });
        }
  return quads;
}

/** Squared distance between two hashes. */
export function hashDistance2(h1, h2) {
  let s = 0;
  for (let i = 0; i < 4; i++) { const d = h1[i] - h2[i]; s += d * d; }
  return s;
}
