import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { wrap360 } from '../shared/angle.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'fixtures');
mkdirSync(outDir, { recursive: true });

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GenOpts {
  seed: number;
  ra0: number;
  dec0: number;
  rotationDeg: number;
  mirror: boolean;
  scaleArcsecPx: number;
  width: number;
  height: number;
  matched: number;
  streak: number;
  saturated: number;
  extraCatalog: number;
}

function genDataset(name: string, opts: GenOpts) {
  const rand = mulberry32(opts.seed);
  const cx = opts.width / 2;
  const cy = opts.height / 2;
  const halfW = opts.width / 2;
  const halfH = opts.height / 2;
  const s = (opts.scaleArcsecPx / 3600) * (Math.PI / 180);
  const theta = (opts.rotationDeg * Math.PI) / 180;
  let a = s * Math.cos(theta);
  let b = -s * Math.sin(theta);
  let d = s * Math.sin(theta);
  let e = s * Math.cos(theta);
  if (opts.mirror) {
    d = -d;
    e = -e;
  }
  const c = -a * cx - b * cy;
  const f = -d * cx - e * cy;

  const imageStars = [];
  const catalogStars = [];
  let n = 0;
  let guard = 0;
  while (n < opts.matched && guard < 100000) {
    guard += 1;
    const x = rand() * opts.width;
    const y = rand() * opts.height;
    if (Math.hypot(x - cx, y - cy) > Math.hypot(halfW, halfH)) continue;
    const xi = a * x + b * y + c;
    const eta = d * x + e * y + f;
    const rho = Math.hypot(xi, eta);
    if (rho > Math.tan((1.65 * Math.PI) / 180)) continue;
    const sky = raDecFromTangent(xi, eta, opts.ra0, opts.dec0);
    const jitterArcsec = (rand() - 0.5) * 0.6;
    const jitterRad = rand() * 2 * Math.PI;
    const ra = wrap360(sky.ra + (jitterArcsec / 3600 / Math.cos((sky.dec * Math.PI) / 180)) * Math.cos(jitterRad));
    const dec = sky.dec + (jitterArcsec / 3600) * Math.sin(jitterRad);
    const id = `img-${String(n + 1).padStart(3, '0')}`;
    const catId = `cat-${String(n + 1).padStart(3, '0')}`;
    imageStars.push({ id, x: Number(x.toFixed(3)), y: Number(y.toFixed(3)), flux: Math.round(1000 + rand() * 60000) });
    catalogStars.push({ id: catId, ra: Number(ra.toFixed(7)), dec: Number(dec.toFixed(7)), mag: Number((6 + rand() * 7).toFixed(2)) });
    n += 1;
  }

  for (let i = 0; i < opts.extraCatalog; i++) {
    const ang = rand() * 2 * Math.PI;
    const rad = (1.85 + rand() * 0.4) * (Math.PI / 180);
    const xi = Math.cos(ang) * rad;
    const eta = Math.sin(ang) * rad;
    const sky = raDecFromTangent(xi, eta, opts.ra0, opts.dec0);
    catalogStars.push({
      id: `cat-x-${String(i + 1).padStart(2, '0')}`,
      ra: Number(wrap360(sky.ra).toFixed(7)),
      dec: Number(sky.dec.toFixed(7)),
      mag: Number((7 + rand() * 5).toFixed(2)),
    });
  }

  for (let i = 0; i < opts.streak; i++) {
    const t = (i + 0.5) / opts.streak;
    const x = 120 + t * 820;
    const y = 180 + t * 40 + (rand() - 0.5) * 30;
    imageStars.push({ id: `streak-${i + 1}`, x: Number(x.toFixed(3)), y: Number(y.toFixed(3)), flux: Math.round(800 + rand() * 1200) });
  }

  for (let i = 0; i < opts.saturated; i++) {
    const x = 150 + rand() * 700;
    const y = 150 + rand() * 700;
    imageStars.push({
      id: `sat-${i + 1}`,
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
      flux: 65535,
      saturated: true,
    });
  }

  return {
    name,
    imageStars: imageStars.sort((p: { id: string }, q: { id: string }) => (p.id < q.id ? -1 : 1)),
    catalogStars: catalogStars.sort((p: { id: string }, q: { id: string }) => (p.id < q.id ? -1 : 1)),
    truth: {
      ra0: opts.ra0,
      dec0: opts.dec0,
      rotationDeg: opts.rotationDeg,
      mirror: opts.mirror,
      scaleArcsecPx: opts.scaleArcsecPx,
      width: opts.width,
      height: opts.height,
    },
  };
}

function raDecFromTangent(xi: number, eta: number, ra0: number, dec0: number) {
  return tangentToRaDecLocal(xi, eta, ra0, dec0);
}

function tangentToRaDecLocal(xi: number, eta: number, ra0Deg: number, dec0Deg: number) {
  const d0 = (dec0Deg * Math.PI) / 180;
  const a0 = (ra0Deg * Math.PI) / 180;
  const rho = Math.hypot(xi, eta);
  const cc = 1 / Math.sqrt(1 + rho * rho);
  const sc = rho * cc;
  const fx = rho > 1e-15 ? (xi / rho) * sc : 0;
  const fy = rho > 1e-15 ? (eta / rho) * sc : 0;
  const northX = -Math.sin(d0) * Math.cos(a0);
  const northY = -Math.sin(d0) * Math.sin(a0);
  const northZ = Math.cos(d0);
  const eastX = -Math.sin(a0);
  const eastY = Math.cos(a0);
  const cx0 = Math.cos(d0) * Math.cos(a0);
  const cy0 = Math.cos(d0) * Math.sin(a0);
  const cz0 = Math.sin(d0);
  const vx = cc * cx0 + fx * eastX + fy * -northX;
  const vy = cc * cy0 + fx * eastY + fy * -northY;
  const vz = cc * cz0 + fy * -northZ;
  const dec = (Math.asin(Math.max(-1, Math.min(1, vz))) * 180) / Math.PI;
  const ra = wrap360((Math.atan2(vy, vx) * 180) / Math.PI);
  return { ra, dec };
}

const datasets = [
  genDataset('synthetic-standard', {
    seed: 20250921, ra0: 150, dec0: 20, rotationDeg: 15, mirror: false,
    scaleArcsecPx: 3.2, width: 1024, height: 1024, matched: 26, streak: 4, saturated: 2, extraCatalog: 5,
  }),
  genDataset('synthetic-mirror', {
    seed: 20250922, ra0: 88, dec0: -12, rotationDeg: 42, mirror: true,
    scaleArcsecPx: 2.7, width: 900, height: 1100, matched: 24, streak: 3, saturated: 2, extraCatalog: 4,
  }),
  genDataset('synthetic-ra-seam', {
    seed: 20250923, ra0: 1.5, dec0: 5, rotationDeg: 8, mirror: false,
    scaleArcsecPx: 4.1, width: 800, height: 800, matched: 22, streak: 2, saturated: 1, extraCatalog: 3,
  }),
  genDataset('synthetic-sparse', {
    seed: 20250924, ra0: 230, dec0: 33, rotationDeg: 0, mirror: false,
    scaleArcsecPx: 3.0, width: 640, height: 480, matched: 4, streak: 0, saturated: 1, extraCatalog: 2,
  }),
  genDataset('synthetic-underdetermined', {
    seed: 20250925, ra0: 300, dec0: -40, rotationDeg: 12, mirror: false,
    scaleArcsecPx: 3.5, width: 640, height: 480, matched: 2, streak: 1, saturated: 1, extraCatalog: 1,
  }),
];

for (const ds of datasets) {
  writeFileSync(join(outDir, `${ds.name}.json`), JSON.stringify(ds, null, 2) + '\n');
}
writeFileSync(
  join(outDir, 'manifest.json'),
  JSON.stringify({ generatedBy: 'tools/gen-fixtures.ts', generatorSeedInputs: [20250921, 20250922, 20250923, 20250924, 20250925], datasets: datasets.map((d) => d.name) }, null, 2) + '\n',
);
console.log(`wrote ${datasets.length} fixtures to ${outDir}`);
