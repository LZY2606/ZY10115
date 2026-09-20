import { createHash } from 'node:crypto';

export function stableStringify(value: unknown): string {
  return stringifySorted(value);
}

function stringifySorted(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stringifySorted).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stringifySorted(obj[k])).join(',') + '}';
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function shortHash(text: string): string {
  return sha256Hex(text).slice(0, 12);
}

export function numKey(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return String(value);
  return Number(value.toFixed(digits)).toString();
}
