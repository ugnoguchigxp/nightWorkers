import { spawn } from 'node:child_process';

const child = spawn('bun', ['api/index.ts', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NIGHTWORKERS_DATABASE_ACCESS_SCOPE:
      process.env.NIGHTWORKERS_DATABASE_ACCESS_SCOPE || 'operational',
    NIGHTWORKERS_EXECUTOR_MODE:
      process.env.NIGHTWORKERS_EXECUTOR_MODE || 'in_process',
  },
  stdio: 'inherit',
});

let forwardedSignal = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    forwardedSignal = signal;
    child.kill(signal);
  });
}

const exitCode = await new Promise((resolve) => {
  child.once('error', (error) => {
    console.error(error);
    resolve(1);
  });
  child.once('close', (code) => resolve(code ?? 1));
});

if (forwardedSignal) {
  process.kill(process.pid, forwardedSignal);
} else {
  process.exitCode = exitCode;
}
