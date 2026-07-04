#!/usr/bin/env node
import { cliArgs, printJsonAndExit, readManifestById } from './core.mjs';

const args = cliArgs();
const moduleId = String(args.module || args.id || '').trim();
if (!moduleId) {
  printJsonAndExit({ ok: false, error: { code: 'INVALID_ARGS', message: '--module is required.' } }, 1);
} else {
  printJsonAndExit({
    ok: true,
    payload: readManifestById(args.repoRoot || process.cwd(), moduleId),
  });
}
