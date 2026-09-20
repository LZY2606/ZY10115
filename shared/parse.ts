import type { CatalogStar, ImageStar } from './types.ts';

export interface ParsedList {
  imageStars?: ImageStar[];
  catalogStars?: CatalogStar[];
}

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const rows: string[][] = [];
  for (const line of lines) {
    const fields: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else quoted = false;
        } else cur += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        fields.push(cur);
        cur = '';
      } else cur += ch;
    }
    fields.push(cur);
    rows.push(fields);
  }
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = (row[i] ?? '').trim();
    });
    return obj;
  });
}

function num(row: Record<string, string>, keys: string[]): number {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== '') {
      const v = Number(row[key]);
      if (Number.isFinite(v)) return v;
    }
  }
  return NaN;
}

function str(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) if (row[key] !== undefined && row[key] !== '') return row[key];
  return '';
}

export function rowsToImageStars(rows: Record<string, string>[]): ImageStar[] {
  return rows
    .map((row, idx) => {
      const x = num(row, ['x', 'px', 'X', 'col']);
      const y = num(row, ['y', 'py', 'Y', 'row']);
      const flux = num(row, ['flux', 'brightness', 'intensity', 'mag']);
      const saturatedRaw = str(row, ['saturated', 'sat']).toLowerCase();
      return {
        id: str(row, ['id', 'star_id', 'name']) || `img-auto-${idx + 1}`,
        x,
        y,
        flux: Number.isFinite(flux) ? flux : 0,
        saturated: saturatedRaw === 'true' || saturatedRaw === '1' || saturatedRaw === 'yes',
      };
    })
    .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
}

export function rowsToCatalogStars(rows: Record<string, string>[]): CatalogStar[] {
  return rows
    .map((row, idx) => ({
      id: str(row, ['id', 'star_id', 'name']) || `cat-auto-${idx + 1}`,
      ra: num(row, ['ra', 'RA', 'raj2000']),
      dec: num(row, ['dec', 'Dec', 'de', 'decj2000']),
      mag: num(row, ['mag', 'magnitude', 'vmag']),
    }))
    .filter((s) => Number.isFinite(s.ra) && Number.isFinite(s.dec));
}

export function parseJsonPayload(text: string): ParsedList {
  const data = JSON.parse(text);
  const imageStars: ImageStar[] | undefined = data.imageStars ?? data.image ?? data.detections;
  const catalogStars: CatalogStar[] | undefined = data.catalogStars ?? data.catalog ?? data.stars;
  return { imageStars, catalogStars };
}

export function detectAndParse(text: string, filename: string): ParsedList {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return parseJsonPayload(text);
  if (/\.csv$/i.test(filename) || trimmed.includes(',')) {
    const rows = parseCsv(text);
    const first = rows[0] ?? {};
    const looksImage = ['x', 'px', 'X', 'col'].some((k) => k in first);
    const looksCatalog = ['ra', 'RA', 'raj2000'].some((k) => k in first);
    if (looksImage && !looksCatalog) return { imageStars: rowsToImageStars(rows) };
    if (looksCatalog && !looksImage) return { catalogStars: rowsToCatalogStars(rows) };
    if (looksImage && looksCatalog) {
      return { imageStars: rowsToImageStars(rows), catalogStars: rowsToCatalogStars(rows) };
    }
  }
  throw new Error('unrecognized input format: expected JSON or CSV with x/y or ra/dec columns');
}
