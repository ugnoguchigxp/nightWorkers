export const desktopSidecarTargets = {
  'darwin:arm64': {
    libsqlPackage: '@libsql/darwin-arm64',
    codexPackage: '@openai/codex-darwin-arm64',
    nodeExecutable: 'node',
  },
  'darwin:x64': {
    libsqlPackage: '@libsql/darwin-x64',
    codexPackage: '@openai/codex-darwin-x64',
    nodeExecutable: 'node',
  },
  'linux:arm64': {
    libsqlPackage: '@libsql/linux-arm64-gnu',
    codexPackage: '@openai/codex-linux-arm64',
    nodeExecutable: 'node',
  },
  'linux:x64': {
    libsqlPackage: '@libsql/linux-x64-gnu',
    codexPackage: '@openai/codex-linux-x64',
    nodeExecutable: 'node',
  },
  'win32:x64': {
    libsqlPackage: '@libsql/win32-x64-msvc',
    codexPackage: '@openai/codex-win32-x64',
    nodeExecutable: 'node.exe',
  },
};

export function getDesktopSidecarTarget(platform = process.platform, arch = process.arch) {
  const targetKey = `${platform}:${arch}`;
  const target = desktopSidecarTargets[targetKey];
  if (!target) {
    throw new Error(`Unsupported desktop sidecar native target: ${platform}/${arch}`);
  }
  return { targetKey, ...target };
}

export function getNodeExecutableName(platform = process.platform) {
  return platform === 'win32' ? 'node.exe' : 'node';
}
