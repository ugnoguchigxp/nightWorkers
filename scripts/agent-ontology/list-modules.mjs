#!/usr/bin/env node
import { cliArgs, listModules, printJsonAndExit } from './core.mjs';

const args = cliArgs();
printJsonAndExit({
  ok: true,
  payload: listModules(args.repoRoot || process.cwd()),
});
