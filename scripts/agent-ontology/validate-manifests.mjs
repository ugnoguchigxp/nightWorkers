#!/usr/bin/env node
import { cliArgs, printJsonAndExit, validateAllManifests } from './core.mjs';

const args = cliArgs();
const result = validateAllManifests(args.repoRoot || process.cwd());
printJsonAndExit(result, result.ok ? 0 : 1);
