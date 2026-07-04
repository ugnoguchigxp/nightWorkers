#!/usr/bin/env node
import { cliArgs, getVerificationPlan, printJsonAndExit } from './core.mjs';

const args = cliArgs();
const secondaryModules = Array.isArray(args.secondary)
  ? args.secondary
  : typeof args.secondary === 'string'
    ? args.secondary.split(',').map((item) => item.trim())
    : [];
printJsonAndExit({
  ok: true,
  payload: getVerificationPlan({
    repoRoot: args.repoRoot || process.cwd(),
    primaryModule: args.primary || args.module,
    secondaryModules,
  }),
});
