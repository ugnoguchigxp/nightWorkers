import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const trackedArtifactTask = {
  label: 'tracked artifact check',
  command: 'bun',
  args: ['--silent', 'run', 'check:tracked-artifacts'],
};

const typecheckTask = {
  label: 'typecheck',
  command: 'bun',
  args: ['--silent', 'run', 'typecheck'],
};

const lintTask = {
  label: 'lint',
  command: 'bun',
  args: ['--silent', 'run', 'lint'],
};

const supervisorRegressionTask = {
  label: 'supervisor regression tests',
  command: 'bun',
  args: ['--silent', 'run', 'test:supervisor-regression'],
};

const desktopRuntimeTask = {
  label: 'desktop runtime tests',
  command: 'bun',
  args: ['--silent', 'run', 'test:desktop-runtime'],
};

const desktopLintTask = {
  label: 'desktop lint',
  command: 'bun',
  args: ['--silent', 'run', 'desktop:lint'],
};

const desktopBuildTask = {
  label: 'desktop build',
  command: 'bun',
  args: ['--silent', 'run', 'desktop:build'],
};

const desktopSidecarSmokeTask = {
  label: 'desktop sidecar smoke',
  command: 'bun',
  args: ['--silent', 'run', 'desktop:smoke-sidecar'],
};

const desktopPackagedSmokeTask = {
  label: 'desktop packaged smoke',
  command: 'bun',
  args: ['--silent', 'run', 'desktop:smoke'],
};

const allTestsTask = {
  label: 'all vitest tests',
  command: 'bun',
  args: ['--silent', 'run', 'test', 'run'],
};

const basePhases = [
  {
    label: 'base static checks',
    mode: 'parallel',
    tasks: [trackedArtifactTask, typecheckTask, lintTask],
  },
  {
    label: 'base serial tests',
    mode: 'serial',
    tasks: [supervisorRegressionTask],
  },
];

const desktopPhases = [
  {
    label: 'desktop independent checks',
    mode: 'parallel',
    tasks: [desktopRuntimeTask, desktopLintTask],
  },
  {
    label: 'desktop build and smoke',
    mode: 'serial',
    tasks: [
      desktopBuildTask,
      desktopSidecarSmokeTask,
      desktopPackagedSmokeTask,
    ],
  },
];

const taskSets = {
  base: basePhases,
  desktop: desktopPhases,
  verify: basePhases,
  full: [
    ...basePhases,
    {
      label: 'full serial tests',
      mode: 'serial',
      tasks: [allTestsTask],
    },
  ],
};

const target = process.argv[2] || 'verify';
const tasks = taskSets[target];

if (!tasks) {
  console.error(`Unknown verify target: ${target}`);
  console.error(`Expected one of: ${Object.keys(taskSets).join(', ')}`);
  process.exit(1);
}

const formatDuration = (startedAt) => {
  const seconds = (performance.now() - startedAt) / 1000;
  return `${seconds.toFixed(1)}s`;
};

const runTask = (task) =>
  new Promise((resolve) => {
    const startedAt = performance.now();
    console.log(`[verify] ${task.label} ...`);

    const child = spawn(task.command, task.args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));

    child.on('error', (error) => {
      resolve({
        task,
        code: 1,
        duration: formatDuration(startedAt),
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: `${Buffer.concat(stderr).toString('utf8')}${error.message}\n`,
      });
    });

    child.on('close', (code, signal) => {
      resolve({
        task,
        code: code ?? 1,
        signal,
        duration: formatDuration(startedAt),
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });

const printCapturedOutput = (result) => {
  console.error(`[verify] ${result.task.label} failed (${result.duration})`);
  if (result.signal) {
    console.error(`[verify] signal: ${result.signal}`);
  }
  if (result.stdout.trim()) {
    console.error(`\n--- ${result.task.label} stdout ---`);
    console.error(result.stdout.trimEnd());
  }
  if (result.stderr.trim()) {
    console.error(`\n--- ${result.task.label} stderr ---`);
    console.error(result.stderr.trimEnd());
  }
};

const hasFailed = (result) => result.code !== 0 || result.signal;

const printSuccess = (result) => {
  console.log(`[verify] ${result.task.label} ok (${result.duration})`);
};

const runSerialPhase = async (phase) => {
  for (const task of phase.tasks) {
    const result = await runTask(task);
    if (hasFailed(result)) {
      printCapturedOutput(result);
      process.exit(result.code || 1);
    }
    printSuccess(result);
  }
};

const runParallelPhase = async (phase) => {
  const results = await Promise.all(phase.tasks.map((task) => runTask(task)));
  const failures = results.filter(hasFailed);

  for (const result of results) {
    if (!hasFailed(result)) {
      printSuccess(result);
    }
  }

  if (failures.length > 0) {
    for (const result of failures) {
      printCapturedOutput(result);
    }
    process.exit(failures[0].code || 1);
  }
};

for (const phase of tasks) {
  console.log(`[verify] ${phase.label} (${phase.mode})`);
  if (phase.mode === 'parallel') {
    await runParallelPhase(phase);
    continue;
  }
  if (phase.mode === 'serial') {
    await runSerialPhase(phase);
    continue;
  }
  console.error(`Unknown verify phase mode: ${phase.mode}`);
  process.exit(1);
}
