import crypto from 'node:crypto';

export function digestText(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}
