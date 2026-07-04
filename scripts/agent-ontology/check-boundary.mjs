#!/usr/bin/env node
import { checkBoundary, cliArgs, printJsonAndExit } from './core.mjs';

const args = cliArgs();
const files = Array.isArray(args.files)
  ? args.files
  : typeof args.files === 'string'
    ? args.files.split(',').map((item) => item.trim())
    : [];
const secondaryModules = Array.isArray(args.secondary)
  ? args.secondary
  : typeof args.secondary === 'string'
    ? args.secondary.split(',').map((item) => item.trim())
    : [];
printJsonAndExit({
  ok: true,
  payload: checkBoundary({
    repoRoot: args.repoRoot || process.cwd(),
    primaryModule: args.primary || args.module,
    secondaryModules,
    plannedFiles: files,
  }),
});
