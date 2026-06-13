#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNightWorkersCodexToolConfigLines } from '../api/mcp/nightworkers-tool-manifest.ts';

const args = new Set(process.argv.slice(2));
const remove = args.has('--remove') || args.has('remove') || args.has('uninstall');
const dryRun = args.has('--dry-run');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const configPath = process.env.CODEX_CONFIG_PATH || path.join(codexHome, 'config.toml');

const nextBlock = [
  '# NightWorkers MCP registration managed by scripts/setup-codex-nightworkers-mcp.mjs',
  '[mcp_servers.nightworkers]',
  'command = "bun"',
  'args = ["run", "codex:mcp"]',
  `cwd = "${tomlString(repoRoot)}"`,
  'enabled = true',
  ...buildNightWorkersCodexToolConfigLines(),
  '# End NightWorkers MCP registration',
].join('\n');

const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
const withoutNightWorkers = removeNightWorkersMcpSections(current).trimEnd();
const next = remove
  ? withoutNightWorkers
  : [withoutNightWorkers, withoutNightWorkers ? '\n\n' : '', nextBlock, '\n'].join('');

if (dryRun) {
  process.stdout.write(next);
  process.exit(0);
}

fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(configPath, next, { mode: 0o600 });
console.log(
  remove
    ? `Removed NightWorkers MCP registration from ${configPath}`
    : `Installed NightWorkers MCP registration in ${configPath}`
);

function removeNightWorkersMcpSections(input) {
  const lines = input.split(/\r?\n/);
  const output = [];
  let skippingManagedBlock = false;
  let skippingNightWorkersSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '# NightWorkers MCP registration managed by scripts/setup-codex-nightworkers-mcp.mjs') {
      skippingManagedBlock = true;
      skippingNightWorkersSection = false;
      continue;
    }
    if (skippingManagedBlock) {
      if (trimmed === '# End NightWorkers MCP registration') {
        skippingManagedBlock = false;
      }
      continue;
    }

    const section = /^\[([^\]]+)\]\s*$/.exec(trimmed)?.[1];
    if (section) {
      skippingNightWorkersSection =
        section === 'mcp_servers.nightworkers' ||
        section.startsWith('mcp_servers.nightworkers.');
    }
    if (skippingNightWorkersSection) continue;
    output.push(line);
  }

  return output.join('\n');
}

function tomlString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
