// Pixel -> tangent-plane transform model.
//
// Model: polynomial in normalized pixel coordinates
//   xn = (x - cx) / norm, yn = (y - cy) / norm
// of total degree `order` (order 0 and 1 both mean the affine/similarity
// block only; order >= 2 adds distortion terms). u and v (xi, eta in
// arcsec) are fit independently, so the fit is a plain linear least squares.
import { leastSquares, invertMatrix, correlationFromCovariance } from './linalg.js';
import { RAD2DEG } from './angles.js';

/** Polynomial term exponents (i, j) for xn^i * yn^j at the given order. */
export function polynomialTerms(order) {
  const degree = Math.max(1, order | 0);
  const terms = [];
  for (let total = 0; total <= degree; total++) {
    for (let i = total; i >= 0; i--) {
      terms.push([i, total - i]);
    }
  }
  return terms; // [0,0],[1,0],[0,1],[2,0],[1,1],[0,2],...
}

/** Minimum correspondences needed to constrain the model at `order`. */
export function minCorrespondences(order) {
  return polynomialTerms(order).length;
}

function designRow(xn, yn, terms) {
  return terms.map(([i, j]) => Math.pow(xn, i) * Math.pow(yn, j));
}

/**
 * Fit the transform from correspondences:
 *   [{ x, y, xi, eta }]  (pixels -> tangent arcsec)
 * norm: normalization scale in pixels (e.g. half the image diagonal).
 * Returns null when the normal matrix is rank deficient.
 */
export function fitTransform(correspondences, order, norm, center = { x: 0, y: 0 }) {
  const terms = polynomialTerms(order);
  const rows = [];
  const tu = [];
  const tv = [];
  for (const c of correspondences) {
    const xn = (c.x - center.x) / norm;
    const yn = (c.y - center.y) / norm;
    rows.push(designRow(xn, yn, terms));
    tu.push(c.xi);
    tv.push(c.eta);
  }
  const fitU = leastSquares(rows, tu);
  const fitV = leastSquares(rows, tv);
  const nTerms = terms.length;
  if (fitU.rank < nTerms || fitV.rank < nTerms) {
    return { ok: false, rank: Math.min(fitU.rank, fitV.rank), nTerms };
  }
  const coeffsU = fitU.p;
  const coeffsV = fitV.p;

  function apply(x, y) {
    const xn = (x - center.x) / norm;
    const yn = (y - center.y) / norm;
    const row = designRow(xn, yn, terms);
    let xi = 0; let eta = 0;
    for (let k = 0; k < row.length; k++) { xi += row[k] * coeffsU[k]; eta += row[k] * coeffsV[k]; }
    return { xi, eta };
  }

  // Linear block: dxi = (c10 xn + c01 yn), in pixel units divide by norm.
  const a1 = coeffsU[1] / norm; const a2 = coeffsU[2] / norm;
  const b1 = coeffsV[1] / norm; const b2 = coeffsV[2] / norm;
  const det = a1 * b2 - a2 * b1;
  const parity = det < 0 ? -1 : 1;
  const scale = Math.sqrt(Math.abs(det)); // arcsec per pixel
  const rotationDeg = Math.atan2(b1, a1) * RAD2DEG;

  // Parameter covariance ~ sigma^2 (M^T M)^-1; report correlation, which is
  // sigma-independent, so no noise estimate is needed.
  const cov = invertMatrix(fitU.normalMatrix);
  const correlation = cov ? correlationFromCovariance(cov) : null;

  return {
    ok: true,
    order,
    terms,
    coeffsU,
    coeffsV,
    norm,
    center,
    apply,
    scale,
    parity,
    rotationDeg,
    correlation,
    termLabels: terms.map(([i, j]) => `x^${i}y^${j}`),
  };
}

/**
 * Approximate inverse of a fitted model (tangent arcsec -> pixels) via
 * Newton iteration on the linear block. Good to sub-milli-pixel for the
 * low-order distortions used here.
 */
export function invertModel(model) {
  const norm = model.norm;
  // Jacobian is taken with respect to normalized pixel coordinates.
  const a1 = model.coeffsU[1]; const a2 = model.coeffsU[2];
  const b1 = model.coeffsV[1]; const b2 = model.coeffsV[2];
  const det = a1 * b2 - a2 * b1;
  const ia1 = b2 / det; const ia2 = -a2 / det;
  const ib1 = -b1 / det; const ib2 = a1 / det;
  const u0 = model.coeffsU[0]; const v0 = model.coeffsV[0];
  const cx = model.center.x; const cy = model.center.y;
  return function applyInverse(xi, eta) {
    // Start from the affine inverse (in normalized coords).
    let xn = ia1 * (xi - u0) + ia2 * (eta - v0);
    let yn = ib1 * (xi - u0) + ib2 * (eta - v0);
    for (let iter = 0; iter < 8; iter++) {
      const p = model.apply(cx + xn * norm, cy + yn * norm);
      const ex = xi - p.xi; const ey = eta - p.eta;
      if (Math.abs(ex) + Math.abs(ey) < 1e-9) break;
      xn += ia1 * ex + ia2 * ey;
      yn += ib1 * ex + ib2 * ey;
    }
    return { x: cx + xn * norm, y: cy + yn * norm };
  };
}
