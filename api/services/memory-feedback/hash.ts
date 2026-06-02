import crypto from 'node:crypto';

export function digestText(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function stableId(parts: unknown[]): string {
  const hash = digestText(JSON.stringify(parts)).slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
