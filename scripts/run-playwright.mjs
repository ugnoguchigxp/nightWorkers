import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  cleanupIsolatedE2eEnvironment,
  createIsolatedE2eEnvironment,
} from './e2e-environment.mjs';
import {
  findAddedGitEntries,
  findRemovedGitEntries,
  readGitWorktreePaths,
  readNightWorkersBranchRefs,
} from './git-worktree-leak-guard.mjs';

const repositoryRoot = process.cwd();
const worktreesBefore = readGitWorktreePaths(repositoryRoot);
const branchesBefore = readNightWorkersBranchRefs(repositoryRoot);
const environment = await createIsolatedE2eEnvironment();
const playwrightCli = path.resolve('node_modules/@playwright/test/cli.js');
const args = process.argv.slice(2);
let child;
try {
  child = spawn(
    process.execPath,
    [playwrightCli, ...(args.length > 0 ? args : ['test'])],
    {
      cwd: repositoryRoot,
      env: environment.env,
      stdio: 'inherit',
    },
  );
} catch (error) {
  try {
    cleanupIsolatedE2eEnvironment(environment);
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      'Playwright startup and isolated run rollback both failed.',
    );
  }
  throw error;
}
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

console.log(`[e2e] isolated run root: ${environment.runRoot}`);
console.log(`[e2e] isolated database: ${environment.databasePath}`);

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
} finally {
  try {
    cleanupIsolatedE2eEnvironment(environment);
    console.log(`[e2e] isolated run reset: ${environment.runRoot}`);
  } catch (error) {
    console.error('[e2e] Failed to clean the isolated E2E run.', error);
    exitCode = 1;
  }
}

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
  console.error('[e2e] Git state leaked outside the isolated E2E run:');
  for (const worktree of addedWorktrees) console.error(`- worktree: ${worktree}`);
  for (const branch of addedBranches) console.error(`- branch: ${branch}`);
  for (const worktree of removedWorktrees)
    console.error(`- removed worktree: ${worktree}`);
  for (const branch of removedBranches) console.error(`- removed branch: ${branch}`);
  exitCode = 1;
}

if (forwardedSignal) {
  process.kill(process.pid, forwardedSignal);
} else {
  process.exitCode = exitCode;
}
