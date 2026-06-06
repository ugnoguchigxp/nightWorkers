import os from 'node:os';
import path from 'node:path';

export function getCodexGlobalHome(): string {
  return (
    process.env.NIGHTWORKERS_CODEX_HOME ||
    process.env.CODEX_HOME ||
    path.join(os.homedir(), '.codex')
  );
}

export function getCodexGlobalConfigPath(): string {
  return path.join(getCodexGlobalHome(), 'config.toml');
}

export function getCodexGlobalAgentsPath(): string {
  return path.join(getCodexGlobalHome(), 'AGENTS.md');
}
