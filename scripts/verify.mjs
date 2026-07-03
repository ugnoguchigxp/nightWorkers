import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const baseTasks = [
  { label: 'tracked artifact check', command: 'bun', args: ['--silent', 'run', 'check:tracked-artifacts'] },
  { label: 'typecheck', command: 'bun', args: ['--silent', 'run', 'typecheck'] },
  { label: 'lint', command: 'bun', args: ['--silent', 'run', 'lint'] },
  {
    label: 'supervisor regression tests',
    command: 'bun',
    args: ['--silent', 'run', 'test:supervisor-regression'],
  },
];

const desktopTasks = [
  {
    label: 'desktop runtime tests',
    command: 'bun',
    args: ['--silent', 'run', 'test:desktop-runtime'],
  },
  { label: 'desktop lint', command: 'bun', args: ['--silent', 'run', 'desktop:lint'] },
  { label: 'desktop build', command: 'bun', args: ['--silent', 'run', 'desktop:build'] },
  { label: 'desktop sidecar smoke', command: 'bun', args: ['--silent', 'run', 'desktop:smoke-sidecar'] },
  { label: 'desktop packaged smoke', command: 'bun', args: ['--silent', 'run', 'desktop:smoke'] },
];

const allTestsTask = {
  label: 'all vitest tests',
  command: 'bun',
  args: ['--silent', 'run', 'test', 'run'],
};

const taskSets = {
  base: baseTasks,
  desktop: desktopTasks,
  verify: [...baseTasks, ...desktopTasks],
  full: [...baseTasks, ...desktopTasks, allTestsTask],
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

for (const task of tasks) {
  const result = await runTask(task);
  if (result.code !== 0 || result.signal) {
    printCapturedOutput(result);
    process.exit(result.code || 1);
  }
  console.log(`[verify] ${task.label} ok (${result.duration})`);
}
