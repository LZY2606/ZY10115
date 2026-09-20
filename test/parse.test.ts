import { describe, expect, it } from 'vitest';
import { detectAndParse, parseCsv, rowsToImageStars, rowsToCatalogStars } from '../shared/parse.ts';

describe('CSV / JSON parsing', () => {
  it('parses image CSV with aliases', () => {
    const rows = parseCsv('id,x,y,flux,saturated\ni1,10,20,5000,true\ni2,30,40,1200,false');
    const stars = rowsToImageStars(rows);
    expect(stars).toEqual([
      { id: 'i1', x: 10, y: 20, flux: 5000, saturated: true },
      { id: 'i2', x: 30, y: 40, flux: 1200, saturated: false },
    ]);
  });

  it('parses catalog CSV', () => {
    const stars = rowsToCatalogStars(parseCsv('id,ra,dec,mag\nc1,359.9,-2.5,9.1'));
    expect(stars[0].ra).toBe(359.9);
  });

  it('dispatches JSON payloads', () => {
    const parsed = detectAndParse(JSON.stringify({ imageStars: [{ id: 'a', x: 1, y: 2, flux: 3 }], catalogStars: [] }), 'x.json');
    expect(parsed.imageStars).toHaveLength(1);
  });

  it('rejects nonsense input', () => {
    expect(() => detectAndParse('hello world', 'x.txt')).toThrow(/unrecognized/);
  });
});
