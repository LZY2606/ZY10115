import { RAD, raDecToVec, vecToRaDec } from './angle.ts';

export interface TanPoint {
  xi: number;
  eta: number;
}

function basis(ra0Deg: number, dec0Deg: number) {
  const a0 = ra0Deg * RAD;
  const d0 = dec0Deg * RAD;
  const northX = -Math.sin(d0) * Math.cos(a0);
  const northY = -Math.sin(d0) * Math.sin(a0);
  const northZ = Math.cos(d0);
  const eastX = -Math.sin(a0);
  const eastY = Math.cos(a0);
  const eastZ = 0;
  const cx = Math.cos(d0) * Math.cos(a0);
  const cy = Math.cos(d0) * Math.sin(a0);
  const cz = Math.sin(d0);
  return { a0: 0, d0: 0, northX, northY, northZ, eastX, eastY, eastZ, cx, cy, cz };
}

export function projectToTangent(
  ra: number,
  dec: number,
  ra0: number,
  dec0: number,
): TanPoint {
  const b = basis(ra0, dec0);
  const v = raDecToVec(ra, dec);
  const cosc = v.x * b.cx + v.y * b.cy + v.z * b.cz;
  if (cosc <= 1e-12) return { xi: NaN, eta: NaN };
  const east = v.x * b.eastX + v.y * b.eastY;
  const north = v.x * b.northX + v.y * b.northY + v.z * b.northZ;
  return { xi: east / cosc, eta: -north / cosc };
}

export function tangentToRaDec(
  xi: number,
  eta: number,
  ra0: number,
  dec0: number,
): { ra: number; dec: number } {
  const b = basis(ra0, dec0);
  const southX = -b.northX;
  const southY = -b.northY;
  const southZ = -b.northZ;
  const rho = Math.hypot(xi, eta);
  if (rho < 1e-15) {
    return vecToRaDec({ x: b.cx, y: b.cy, z: b.cz });
  }
  const c = Math.atan(rho);
  const sc = Math.sin(c);
  const cc = Math.cos(c);
  const ex = (xi / rho) * sc;
  const ey = (eta / rho) * sc;
  const vx = cc * b.cx + ex * b.eastX + ey * southX;
  const vy = cc * b.cy + ex * b.eastY + ey * southY;
  const vz = cc * b.cz + ex * b.eastZ + ey * southZ;
  return vecToRaDec({ x: vx, y: vy, z: vz });
}
