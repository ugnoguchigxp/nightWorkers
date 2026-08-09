import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATABASE_ACCESS_SCOPES } from '../shared/runtime-database-access.mjs';
import {
  cleanupIsolatedRuntimeEnvironment,
  createIsolatedRuntimeEnvironment,
} from './isolated-runtime-environment.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const workerPath = path.join(scriptDirectory, 'run-project-exploration-paired-pilot.ts');
const parsed = parseLauncherArgs(process.argv.slice(2));
const isolated = createIsolatedRuntimeEnvironment({
  repositoryRoot,
  scope: DATABASE_ACCESS_SCOPES.isolatedEvaluation,
  rootName: '.nightworkers-evaluations',
  databaseName: 'project-exploration-pilot.sqlite',
  purpose: 'project_exploration_paired_pilot',
  env: process.env,
});

let forwardedSignal = null;
let exitCode = 1;
try {
  fs.copyFileSync(
    parsed.llmSettingsPath,
    isolated.env.NIGHTWORKERS_LLM_SETTINGS_PATH,
  );
  fs.chmodSync(isolated.env.NIGHTWORKERS_LLM_SETTINGS_PATH, 0o600);

  const workerArgs = parsed.workerArgs.includes('--dedicated-database')
    ? parsed.workerArgs
    : [...parsed.workerArgs, '--dedicated-database'];
  const child = spawn('bun', [workerPath, ...workerArgs], {
    cwd: repositoryRoot,
    env: {
      ...isolated.env,
      NODE_ENV: 'development',
      NIGHTWORKERS_EXECUTOR_MODE: 'in_process',
      CORS_ORIGIN: 'http://localhost:39174',
    },
    stdio: 'inherit',
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      forwardedSignal = signal;
      child.kill(signal);
    });
  }

  console.log(`[evaluation] isolated run id: ${isolated.runId}`);
  console.log(`[evaluation] isolated database: ${isolated.databasePath}`);

  exitCode = await new Promise((resolve) => {
    child.once('error', (error) => {
      console.error(error);
      resolve(1);
    });
    child.once('close', (code) => resolve(code ?? 1));
  });
} finally {
  if (parsed.preserveIsolatedRuntime) {
    console.log(`[evaluation] isolated runtime preserved: ${isolated.runRoot}`);
  } else {
    cleanupIsolatedRuntimeEnvironment(isolated);
    console.log(`[evaluation] isolated runtime reset: ${isolated.runRoot}`);
  }
}

if (forwardedSignal) {
  process.kill(process.pid, forwardedSignal);
} else {
  process.exitCode = exitCode;
}

function parseLauncherArgs(args) {
  const workerArgs = [];
  let llmSettingsPath = '';
  let preserveIsolatedRuntime = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--preserve-isolated-runtime') {
      preserveIsolatedRuntime = true;
      continue;
    }
    if (arg === '--llm-settings-path') {
      const value = args[index + 1];
      if (!value) throw new Error('--llm-settings-path requires a value');
      llmSettingsPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--llm-settings-path=')) {
      llmSettingsPath = arg.slice('--llm-settings-path='.length);
      continue;
    }
    workerArgs.push(arg);
  }
  if (!llmSettingsPath.trim()) {
    throw new Error(
      '--llm-settings-path is required so evaluation never reads operational application settings.',
    );
  }
  const resolvedSettingsPath = path.resolve(llmSettingsPath);
  if (!fs.statSync(resolvedSettingsPath).isFile()) {
    throw new Error(`LLM settings source is not a file: ${resolvedSettingsPath}`);
  }
  for (const required of ['--repository-root', '--producer-root']) {
    if (!hasOption(workerArgs, required)) {
      throw new Error(`${required} is required`);
    }
  }
  return {
    llmSettingsPath: resolvedSettingsPath,
    preserveIsolatedRuntime,
    workerArgs,
  };
}

function hasOption(args, option) {
  return args.includes(option) || args.some((arg) => arg.startsWith(`${option}=`));
}
