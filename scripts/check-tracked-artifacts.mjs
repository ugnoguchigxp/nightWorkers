import { execFileSync } from 'node:child_process';

const forbiddenTrackedPrefixes = [
  '.tanstack/tmp/',
  'scratch/',
  'playwright-report/',
  'test-results/',
  'blob-report/',
  'coverage/',
  'github-pages/.preview/',
  'github-pages/reports/',
  'scripts/desktop/staged/',
  'src-tauri/target/',
];

const allowedTrackedPaths = new Set(['scratch/.gitkeep', 'scripts/desktop/staged/.gitkeep']);

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const violations = tracked.filter(
  (file) =>
    !allowedTrackedPaths.has(file) &&
    forbiddenTrackedPrefixes.some((prefix) => file.startsWith(prefix))
);

if (violations.length > 0) {
  console.error('Tracked generated/local artifacts are not allowed:');
  for (const file of violations) console.error(`- ${file}`);
  process.exit(1);
}
