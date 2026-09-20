export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;
export const ARCSEC_PER_DEG = 3600;

export function wrap360(deg: number): number {
  let v = deg % 360;
  if (v < 0) v += 360;
  if (v === 360) v = 0;
  return v;
}

export function wrap180(deg: number): number {
  let v = ((deg + 180) % 360 + 360) % 360 - 180;
  if (v === -180) v = 180;
  return v;
}

export function meanAngularDeg(anglesDeg: number[]): number {
  if (anglesDeg.length === 0) return NaN;
  let sx = 0;
  let sy = 0;
  for (const a of anglesDeg) {
    const r = a * RAD;
    sx += Math.cos(r);
    sy += Math.sin(r);
  }
  if (sx === 0 && sy === 0) return NaN;
  return wrap360(Math.atan2(sy, sx) * DEG);
}

export function angularDistanceDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const [a1, b1, a2, b2] = [ra1 * RAD, dec1 * RAD, ra2 * RAD, dec2 * RAD];
  const cd1 = Math.cos(b1);
  const cd2 = Math.cos(b2);
  const cosSigma = Math.min(
    1,
    Math.max(-1, Math.sin(b1) * Math.sin(b2) + cd1 * cd2 * Math.cos(a1 - a2)),
  );
  return Math.acos(cosSigma) * DEG;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function raDecToVec(ra: number, dec: number): Vec3 {
  const a = ra * RAD;
  const d = dec * RAD;
  const cd = Math.cos(d);
  return { x: cd * Math.cos(a), y: cd * Math.sin(a), z: Math.sin(d) };
}

export function vecToRaDec(v: Vec3): { ra: number; dec: number } {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  const z = Math.min(1, Math.max(-1, v.z / n));
  const dec = Math.asin(z) * DEG;
  const ra = wrap360(Math.atan2(v.y, v.x) * DEG);
  return { ra, dec };
}

export function normalizeAngleDiff(a: number, b: number): number {
  return wrap180(a - b);
}
