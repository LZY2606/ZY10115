// Minimal dense linear algebra for small least-squares problems.
// Deterministic: fixed pivot rules, no randomness, no dates.

/**
 * Solve A x = b with Gaussian elimination and partial pivoting.
 * Returns { x, rank } or null when a pivot is exactly zero at some step
 * (rank-deficient within numerical tolerance).
 */
export function solveLinear(matrixA, vectorB) {
  const n = matrixA.length;
  const a = matrixA.map((row, i) => [...row, vectorB[i]]);
  const x = new Array(n).fill(0);
  let rank = 0;
  for (let col = 0; col < n; col++) {
    let pivotRow = -1;
    let pivotAbs = 1e-300;
    for (let row = col; row < n; row++) {
      const v = Math.abs(a[row][col]);
      if (v > pivotAbs) { pivotAbs = v; pivotRow = row; }
    }
    if (pivotRow < 0 || pivotAbs <= 1e-12) {
      x[col] = 0;
      continue; // singular column: leave as 0, rank stays short
    }
    rank++;
    [a[col], a[pivotRow]] = [a[pivotRow], a[col]];
    const pivot = a[col][col];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = a[row][col] / pivot;
      if (f === 0) continue;
      for (let k = col; k <= n; k++) a[row][k] -= f * a[col][k];
    }
  }
  for (let col = 0; col < n; col++) {
    const pivot = a[col][col];
    x[col] = Math.abs(pivot) <= 1e-12 ? 0 : a[col][n] / pivot;
  }
  return { x, rank };
}

/** Normal equations M^T M p = M^T y. Returns { p, rank, normalMatrix, rhs }. */
export function leastSquares(designRows, targets) {
  const n = designRows[0].length;
  const mtm = Array.from({ length: n }, () => new Array(n).fill(0));
  const mty = new Array(n).fill(0);
  for (let r = 0; r < designRows.length; r++) {
    const row = designRows[r];
    const t = targets[r];
    for (let i = 0; i < n; i++) {
      mty[i] += row[i] * t;
      for (let j = i; j < n; j++) mtm[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) mtm[i][j] = mtm[j][i];
  const { x, rank } = solveLinear(mtm, mty);
  return { p: x, rank, normalMatrix: mtm, rhs: mty };
}

/** Inverse of a small dense matrix via Gauss-Jordan; null if singular. */
export function invertMatrix(matrix) {
  const n = matrix.length;
  const a = matrix.map((row, i) => {
    const r = [...row];
    for (let k = 0; k < n; k++) r.push(i === k ? 1 : 0);
    return r;
  });
  for (let col = 0; col < n; col++) {
    let pivotRow = -1; let pivotAbs = 1e-300;
    for (let row = col; row < n; row++) {
      const v = Math.abs(a[row][col]);
      if (v > pivotAbs) { pivotAbs = v; pivotRow = row; }
    }
    if (pivotRow < 0 || pivotAbs <= 1e-12) return null;
    [a[col], a[pivotRow]] = [a[pivotRow], a[col]];
    const pivot = a[col][col];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = a[row][col] / pivot;
      if (f === 0) continue;
      for (let k = col; k < 2 * n; k++) a[row][k] -= f * a[col][k];
    }
  }
  const inv = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    const pivot = a[i][i];
    for (let k = 0; k < n; k++) inv[i][k] = a[i][n + k] / pivot;
  }
  return inv;
}

/** Correlation matrix from a covariance matrix. */
export function correlationFromCovariance(cov) {
  const n = cov.length;
  const out = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const d = Math.sqrt(Math.abs(cov[i][i] * cov[j][j]));
      out[i][j] = d === 0 ? 0 : cov[i][j] / d;
    }
  }
  return out;
}
