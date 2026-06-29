import path from 'node:path';

const ignoredNames = new Set([
  '.git',
  '.DS_Store',
  '.env',
  '.env.local',
  '.env.test',
  'node_modules',
  'dist',
  'dist-api',
  'dist-web',
  'coverage',
  '.vite',
  '.next',
  '.turbo',
  'sqlite.db',
]);

const secretPathPattern = /(^|[/\\])(\.env|.*secret.*|.*token.*|.*credential.*)([/\\]|$)/i;

export function isProjectEvaluationIgnoredPath(relativePath: string) {
  const normalized = relativePath.split(path.sep).join('/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => ignoredNames.has(part))) return true;
  if (secretPathPattern.test(normalized)) return true;
  return (
    normalized.endsWith('.sqlite') ||
    normalized.endsWith('.sqlite3') ||
    normalized.endsWith('.db') ||
    normalized.endsWith('.pem') ||
    normalized.endsWith('.key')
  );
}

export function truncateProjectEvaluationText(text: string, maxChars = 24_000) {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}
