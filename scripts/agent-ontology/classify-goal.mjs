#!/usr/bin/env node
import { classifyGoal, cliArgs, printJsonAndExit } from './core.mjs';

const args = cliArgs();
printJsonAndExit({
  ok: true,
  payload: classifyGoal({
    repoRoot: args.repoRoot || process.cwd(),
    goal: args.goal,
  }),
});
