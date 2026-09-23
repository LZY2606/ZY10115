// Gnomonic (tangent-plane) projection, the standard TAN convention used by
// WCS. Tangent coordinates are returned in arcseconds so residuals and
// tolerances share one unit everywhere.
import { DEG2RAD, RAD2DEG, ARCSEC_PER_DEG, wrap360 } from './angles.js';

export function makeProjection(centerRaDeg, centerDecDeg) {
  const ra0 = centerRaDeg * DEG2RAD;
  const dec0 = centerDecDeg * DEG2RAD;
  const sinDec0 = Math.sin(dec0);
  const cosDec0 = Math.cos(dec0);

  function project(raDeg, decDeg) {
    const ra = raDeg * DEG2RAD;
    const dec = decDeg * DEG2RAD;
    const sinDec = Math.sin(dec);
    const cosDec = Math.cos(dec);
    const dRa = ra - ra0;
    const cosC = sinDec0 * sinDec + cosDec0 * cosDec * Math.cos(dRa);
    // xi east, eta north, in arcsec
    const xi = (cosDec * Math.sin(dRa)) / cosC * RAD2DEG * ARCSEC_PER_DEG;
    const eta = ((cosDec0 * sinDec - sinDec0 * cosDec * Math.cos(dRa)) / cosC) * RAD2DEG * ARCSEC_PER_DEG;
    return { xi, eta };
  }

  function deproject(xiArcsec, etaArcsec) {
    const xi = (xiArcsec / ARCSEC_PER_DEG) * DEG2RAD;
    const eta = (etaArcsec / ARCSEC_PER_DEG) * DEG2RAD;
    const rho = Math.hypot(xi, eta);
    const c = Math.atan(rho);
    const sinC = Math.sin(c);
    const cosC = Math.cos(c);
    let dec; let ra;
    if (rho === 0) {
      dec = dec0; ra = ra0;
    } else {
      dec = Math.asin(cosC * sinDec0 + (eta * sinC * cosDec0) / rho);
      ra = ra0 + Math.atan2(xi * sinC, rho * cosDec0 * cosC - eta * sinDec0 * sinC);
    }
    return { ra: wrap360(ra * RAD2DEG), dec: dec * RAD2DEG };
  }

  return { center: { ra: centerRaDeg, dec: centerDecDeg }, project, deproject };
}
