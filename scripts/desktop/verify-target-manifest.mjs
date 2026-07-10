import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopSidecarTargets } from './platform-targets.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const manifestPath = path.join(repoRoot, 'scripts/desktop/staged/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expectedTarget = process.argv[2] || manifest.target;
if (!expectedTarget || !desktopSidecarTargets[expectedTarget]) {
  throw new Error(`Expected a supported target argument, received: ${expectedTarget || '<empty>'}`);
}
const target = desktopSidecarTargets[expectedTarget];
const missingPackages = [target.libsqlPackage, target.codexPackage].filter(
  (packageName) => !manifest.copiedPackages?.includes(packageName),
);
if (manifest.target !== expectedTarget) {
  throw new Error(`Desktop target mismatch: expected=${expectedTarget} actual=${manifest.target}`);
}
if (manifest.nodeExecutable !== target.nodeExecutable) {
  throw new Error(
    `Desktop executable mismatch: expected=${target.nodeExecutable} actual=${manifest.nodeExecutable}`,
  );
}
if (missingPackages.length > 0) {
  throw new Error(`Desktop manifest is missing native packages: ${missingPackages.join(', ')}`);
}
console.log(`Desktop target manifest verified: ${expectedTarget}`);
