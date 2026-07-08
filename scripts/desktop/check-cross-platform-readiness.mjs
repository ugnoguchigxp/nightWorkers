import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopSidecarTargets } from './platform-targets.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

const checks = [];

function readJson(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function expectArray(label, actual, expected) {
  const actualValues = Array.isArray(actual) ? actual : [];
  const missing = expected.filter((value) => !actualValues.includes(value));
  const extra = actualValues.filter((value) => !expected.includes(value));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${label} mismatch. expected=${expected.join(',')} actual=${actualValues.join(',') || '<empty>'}`
    );
  }
  checks.push(`${label}: ${actualValues.join(',')}`);
}

function expectScript(packageJson, name, expectedCommand) {
  const actual = packageJson.scripts?.[name];
  if (actual !== expectedCommand) {
    throw new Error(`${name} script mismatch. expected="${expectedCommand}" actual="${actual ?? '<missing>'}"`);
  }
  checks.push(`${name}: ${actual}`);
}

function expectObjectKeys(label, actual, expected) {
  if (!isPlainObject(actual)) {
    throw new Error(`${label} must be an object`);
  }
  expectArray(label, Object.keys(actual), expected);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readSchemaBundleTargets(tauriSchema) {
  const bundleTypes = tauriSchema.definitions?.BundleType?.oneOf;
  if (!Array.isArray(bundleTypes)) {
    throw new Error('Tauri schema BundleType enum is missing');
  }
  return new Set(bundleTypes.flatMap((entry) => entry.enum ?? []));
}

function expectSchemaSupportsTargets(tauriSchema, targets) {
  const supportedTargets = readSchemaBundleTargets(tauriSchema);
  const missing = targets.filter((target) => !supportedTargets.has(target));
  if (missing.length > 0) {
    throw new Error(`Tauri schema does not support bundle targets: ${missing.join(',')}`);
  }
  checks.push(`Tauri schema bundle targets: ${targets.join(',')}`);
}

const packageJson = readJson('package.json');
const tauriConfig = readJson('src-tauri/tauri.conf.json');
const linuxConfig = readJson('src-tauri/tauri.linux.conf.json');
const windowsConfig = readJson('src-tauri/tauri.windows.conf.json');
const tauriSchema = readJson('node_modules/@tauri-apps/cli/config.schema.json');

expectArray('default bundle targets', tauriConfig.bundle?.targets, ['app']);
expectArray('Linux bundle targets', linuxConfig.bundle?.targets, ['deb', 'rpm', 'appimage']);
expectArray('Windows bundle targets', windowsConfig.bundle?.targets, ['nsis', 'msi']);
expectSchemaSupportsTargets(tauriSchema, ['app', 'deb', 'rpm', 'appimage', 'nsis', 'msi']);
expectObjectKeys('Linux platform bundle keys', linuxConfig.bundle, ['targets', 'linux']);
expectObjectKeys('Linux bundle config keys', linuxConfig.bundle?.linux, ['appimage', 'deb', 'rpm']);
expectObjectKeys('Windows platform bundle keys', windowsConfig.bundle, ['targets', 'windows']);
expectObjectKeys('Windows bundle config keys', windowsConfig.bundle?.windows, [
  'webviewInstallMode',
  'allowDowngrades',
]);

expectScript(packageJson, 'desktop:build:linux', 'tauri build --bundles deb,rpm,appimage');
expectScript(packageJson, 'desktop:build:windows', 'tauri build --bundles nsis,msi');

for (const targetKey of ['linux:x64', 'linux:arm64', 'win32:x64']) {
  const target = desktopSidecarTargets[targetKey];
  if (!target?.libsqlPackage || !target?.codexPackage || !target?.nodeExecutable) {
    throw new Error(`Desktop sidecar target is incomplete: ${targetKey}`);
  }
  checks.push(`${targetKey}: ${target.nodeExecutable}`);
}

if (desktopSidecarTargets['win32:x64']?.nodeExecutable !== 'node.exe') {
  throw new Error('Windows desktop sidecar must stage node.exe');
}

console.log(`Desktop cross-platform readiness ok (${checks.length} checks)`);
