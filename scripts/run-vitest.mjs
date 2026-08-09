import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import {
  cleanupIsolatedRuntimeEnvironment,
  createIsolatedRuntimeEnvironment,
} from './isolated-runtime-environment.mjs';
import {
  findAddedGitEntries,
  findRemovedGitEntries,
  readGitWorktreePaths,
  readNightWorkersBranchRefs,
} from './git-worktree-leak-guard.mjs';
import { buildVitestChildEnvironment } from './vitest-database.mjs';

const repositoryRoot = process.cwd();
const worktreesBefore = readGitWorktreePaths(repositoryRoot);
const branchesBefore = readNightWorkersBranchRefs(repositoryRoot);
const environment = createIsolatedRuntimeEnvironment({
  repositoryRoot: os.tmpdir(),
  scope: 'isolated_test',
  rootName: 'nightworkers-vitest',
  databaseName: 'vitest.sqlite',
  purpose: 'vitest',
});
const vitestEntry = path.resolve('node_modules/vitest/vitest.mjs');
let child;
try {
  child = spawn(process.execPath, [vitestEntry, ...process.argv.slice(2)], {
    cwd: repositoryRoot,
    env: buildVitestChildEnvironment({
      env: process.env,
      databasePath: environment.databasePath,
      runRoot: environment.runRoot,
      workspaceRoot: environment.workspaceRoot,
    }),
    stdio: 'inherit',
  });
} catch (error) {
  try {
    cleanupIsolatedRuntimeEnvironment(environment);
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      'Vitest startup and isolated run rollback both failed.',
    );
  }
  throw error;
}

console.log(`[vitest] isolated run root: ${environment.runRoot}`);

let forwardedSignal = null;
let forceKillTimer = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (forwardedSignal) return;
    forwardedSignal = signal;
    child.kill(signal);
    forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    forceKillTimer.unref();
  });
}

let exitCode = 1;
try {
  exitCode = await new Promise((resolve) => {
    child.once('error', (error) => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      console.error(error);
      resolve(1);
    });
    child.once('close', (code) => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve(code ?? 1);
    });
  });
  const worktreesAfter = readGitWorktreePaths(repositoryRoot);
  const branchesAfter = readNightWorkersBranchRefs(repositoryRoot);
  const addedWorktrees = findAddedGitEntries(worktreesBefore, worktreesAfter);
  const addedBranches = findAddedGitEntries(branchesBefore, branchesAfter);
  const removedWorktrees = findRemovedGitEntries(worktreesBefore, worktreesAfter);
  const removedBranches = findRemovedGitEntries(branchesBefore, branchesAfter);
  if (
    addedWorktrees.length > 0 ||
    addedBranches.length > 0 ||
    removedWorktrees.length > 0 ||
    removedBranches.length > 0
  ) {
    console.error(
      '[vitest] Refusing to hide Git leakage outside the isolated test run:',
    );
    for (const worktree of addedWorktrees)
      console.error(`- worktree: ${worktree}`);
    for (const branch of addedBranches) console.error(`- branch: ${branch}`);
    for (const worktree of removedWorktrees)
      console.error(`- removed worktree: ${worktree}`);
    for (const branch of removedBranches)
      console.error(`- removed branch: ${branch}`);
    exitCode = 1;
  }
} finally {
  try {
    cleanupIsolatedRuntimeEnvironment(environment);
    console.log(`[vitest] isolated run reset: ${environment.runRoot}`);
  } catch (error) {
    console.error('[vitest] Failed to clean the isolated test run.', error);
    exitCode = 1;
  }
}

if (forwardedSignal) {
  process.kill(process.pid, forwardedSignal);
} else {
  process.exitCode = exitCode;
}
