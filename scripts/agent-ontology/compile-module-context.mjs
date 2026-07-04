#!/usr/bin/env node
import { cliArgs, compileModuleContext, printJsonAndExit } from './core.mjs';

const args = cliArgs();
const secondaryModules = Array.isArray(args.secondary)
  ? args.secondary
  : typeof args.secondary === 'string'
    ? args.secondary.split(',').map((item) => item.trim())
    : [];
printJsonAndExit({
  ok: true,
  payload: compileModuleContext({
    repoRoot: args.repoRoot || process.cwd(),
    goal: args.goal,
    primaryModule: args.primary || args.module,
    secondaryModules,
    taskGenerationEvidence: args.taskGenerationEvidence === true,
  }),
});
