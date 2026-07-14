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
if (process.env.NIGHTWORKERS_RELEASE === '1' && manifest.runtime?.source !== 'pinned-runtime') {
  throw new Error('Release sidecar must use a pinned Node runtime');
}
if (
  process.env.NIGHTWORKERS_NODE_RUNTIME_VERSION &&
  manifest.runtime?.version !== process.env.NIGHTWORKERS_NODE_RUNTIME_VERSION
) {
  throw new Error(
    `Desktop runtime version mismatch: expected=${process.env.NIGHTWORKERS_NODE_RUNTIME_VERSION} actual=${manifest.runtime?.version || '<missing>'}`,
  );
}
if (!manifest.runtime?.sha256 || !/^[a-f0-9]{64}$/.test(manifest.runtime.sha256)) {
  throw new Error('Desktop manifest is missing the Node runtime SHA-256');
}
console.log(`Desktop target manifest verified: ${expectedTarget}`);
