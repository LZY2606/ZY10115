// Angle helpers. All public angles are degrees unless suffixed otherwise.
// RA is always handled through unit vectors or wrapped differences so the
// 0/360 seam never leaks into arithmetic.

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const ARCSEC_PER_DEG = 3600;

/** Wrap an angle in degrees to [0, 360). */
export function wrap360(deg) {
  let r = deg % 360;
  if (r < 0) r += 360;
  // Snap float noise at the seam so 360 - 1e-15 displays as 0.
  if (r >= 360 - 1e-9) return 0;
  return r;
}

/** Signed smallest difference a-b in degrees, in (-180, 180]. Seam-safe. */
export function deltaDeg(a, b) {
  let d = wrap360(a) - wrap360(b);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Unit vector on the sphere for ra/dec in degrees. */
export function radecToVec(raDeg, decDeg) {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}

/** ra/dec in degrees from a unit vector (norm need not be 1). */
export function vecToRadec(v) {
  const [x, y, z] = v;
  const r = Math.hypot(x, y, z);
  if (r === 0) return null;
  return {
    ra: wrap360(Math.atan2(y, x) * RAD2DEG),
    dec: Math.asin(z / r) * RAD2DEG,
  };
}

/**
 * Seam-safe mean of ra/dec samples via unit-vector averaging.
 * Never averages RA arithmetically, so a field straddling 0/360 is fine.
 * Returns null when the vectors cancel (no well-defined mean direction).
 */
export function meanRadec(points) {
  let sx = 0, sy = 0, sz = 0;
  for (const p of points) {
    const v = radecToVec(p.ra, p.dec);
    sx += v[0]; sy += v[1]; sz += v[2];
  }
  return vecToRadec([sx, sy, sz]);
}

/** Great-circle angular separation in degrees. */
export function angularSeparationDeg(a, b) {
  const va = radecToVec(a.ra, a.dec);
  const vb = radecToVec(b.ra, b.dec);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  return Math.acos(dot) * RAD2DEG;
}
