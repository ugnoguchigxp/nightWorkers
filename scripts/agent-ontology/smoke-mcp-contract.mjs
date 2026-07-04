#!/usr/bin/env node
import {
  checkBoundary,
  classifyGoal,
  compileModuleContext,
  getVerificationPlan,
  listModules,
  printJsonAndExit,
  readManifestById,
  validateAllManifests,
} from './core.mjs';

const repoRoot = process.cwd();
const validation = validateAllManifests(repoRoot);
if (!validation.ok) {
  printJsonAndExit({ ok: false, validation }, 1);
} else {
  const modules = listModules(repoRoot);
  const first = modules.modules[0]?.id;
  const payload = {
    validation,
    modules,
    firstModule: first ? readManifestById(repoRoot, first) : null,
    classification: classifyGoal({ repoRoot, goal: 'Project Detail Mission task candidate UI' }),
    context: first
      ? compileModuleContext({
          repoRoot,
          goal: 'Project Detail Mission task candidate UI',
          primaryModule: first,
        })
      : null,
    boundary: first
      ? checkBoundary({
          repoRoot,
          primaryModule: first,
          plannedFiles: ['spec/docs/coding-agent-module-ontology-implementation-plan.md'],
        })
      : null,
    verification: first ? getVerificationPlan({ repoRoot, primaryModule: first }) : null,
  };
  printJsonAndExit({ ok: true, payload });
}
