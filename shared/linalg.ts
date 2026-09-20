export function solveLinear(A: number[][], b: number[]): { x: number[]; singular: boolean; rcond: number } {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  const colScale = new Array(n).fill(0).map((_, c) => {
    let s = 0;
    for (let r = 0; r < n; r++) s = Math.max(s, Math.abs(M[r][c]));
    return s || 1;
  });
  for (let k = 0; k < n; k++) {
    let piv = k;
    let best = -1;
    for (let r = k; r < n; r++) {
      const v = Math.abs(M[r][k]) / colScale[k];
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-12) return { x: new Array(n).fill(0), singular: true, rcond: best };
    if (piv !== k) {
      const tmp = M[k];
      M[k] = M[piv];
      M[piv] = tmp;
    }
    const pivot = M[k][k];
    for (let r = k + 1; r < n; r++) {
      const factor = M[r][k] / pivot;
      if (factor === 0) continue;
      M[r][k] = 0;
      for (let c = k + 1; c <= n; c++) M[r][c] -= factor * M[k][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return { x, singular: false, rcond: bestOfDiag(M, colScale) };
}

function bestOfDiag(M: number[][], scale: number[]): number {
  let r = Infinity;
  for (let i = 0; i < M.length; i++) r = Math.min(r, Math.abs(M[i][i]) / scale[i]);
  return r;
}

export function lstsq(
  rowsX: number[][],
  y: number[],
  nParams: number,
  weights?: number[],
): { coeff: number[]; ATA: number[][]; singular: boolean } {
  const ATA = Array.from({ length: nParams }, () => new Array(nParams).fill(0));
  const ATy = new Array(nParams).fill(0);
  for (let r = 0; r < rowsX.length; r++) {
    const w = weights ? weights[r] : 1;
    if (w <= 0) continue;
    const xr = rowsX[r];
    const yr = y[r];
    for (let i = 0; i < nParams; i++) {
      ATy[i] += w * xr[i] * yr;
      for (let j = i; j < nParams; j++) {
        const v = w * xr[i] * xr[j];
        ATA[i][j] += v;
        if (j !== i) ATA[j][i] += v;
      }
    }
  }
  const solved = solveLinear(ATA, ATy);
  return { coeff: solved.x, ATA, singular: solved.singular };
}
