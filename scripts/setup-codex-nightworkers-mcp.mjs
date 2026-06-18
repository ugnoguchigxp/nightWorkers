#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const configPath = process.env.CODEX_CONFIG_PATH || path.join(codexHome, 'config.toml');

const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
const withoutNightWorkers = removeNightWorkersMcpSections(current).trimEnd();
const next = withoutNightWorkers ? `${withoutNightWorkers}\n` : '';

if (dryRun) {
  process.stdout.write(next);
  process.exit(0);
}

fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(configPath, next, { mode: 0o600 });
console.log(`Removed NightWorkers MCP registration from ${configPath}`);

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
