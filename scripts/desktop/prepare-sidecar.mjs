import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const stagedRoot = path.join(repoRoot, 'scripts/desktop/staged');
const require = createRequire(import.meta.url);

function copyRequired(source, destination) {
  if (!fs.existsSync(source)) {
    throw new Error(`Required desktop sidecar source missing: ${source}`);
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true, dereference: false });
}

function copyPackage(packageName) {
  const packageJson = requireResolve(`${packageName}/package.json`);
  const source = path.dirname(packageJson);
  const destination = path.join(stagedRoot, 'node_modules', ...packageName.split('/'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true, dereference: true });
}

function requireResolve(specifier) {
  return require.resolve(specifier, {
    paths: [path.join(repoRoot, 'node_modules'), path.join(repoRoot, 'node_modules/.pnpm/node_modules')],
  });
}

function resolveLibsqlNativePackage() {
  const packageByPlatform = new Map([
    ['darwin:arm64', '@libsql/darwin-arm64'],
    ['darwin:x64', '@libsql/darwin-x64'],
    ['linux:arm64', '@libsql/linux-arm64-gnu'],
    ['linux:x64', '@libsql/linux-x64-gnu'],
    ['win32:x64', '@libsql/win32-x64-msvc'],
  ]);
  const packageName = packageByPlatform.get(`${process.platform}:${process.arch}`);
  if (!packageName) {
    throw new Error(`Unsupported desktop sidecar native target: ${process.platform}/${process.arch}`);
  }
  return packageName;
}

fs.rmSync(stagedRoot, { recursive: true, force: true });
fs.mkdirSync(stagedRoot, { recursive: true });

copyRequired(path.join(repoRoot, 'dist-api-desktop'), path.join(stagedRoot, 'dist-api-desktop'));
copyRequired(path.join(repoRoot, 'dist'), path.join(stagedRoot, 'dist'));

fs.copyFileSync(path.join(repoRoot, 'package.json'), path.join(stagedRoot, 'package.json'));
copyPackage(resolveLibsqlNativePackage());
copyPackage('argon2');
copyPackage('@phc/format');
copyPackage('node-addon-api');
copyPackage('node-gyp-build');

const nodeDestinationDir = path.join(stagedRoot, 'node/bin');
fs.mkdirSync(nodeDestinationDir, { recursive: true });
fs.copyFileSync(process.execPath, path.join(nodeDestinationDir, 'node'));
fs.chmodSync(path.join(nodeDestinationDir, 'node'), 0o755);

const metadata = {
  createdAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
};
fs.writeFileSync(path.join(stagedRoot, 'manifest.json'), `${JSON.stringify(metadata, null, 2)}\n`);
fs.writeFileSync(path.join(stagedRoot, '.gitkeep'), '');

console.log(`Prepared desktop sidecar staging at ${stagedRoot}`);
