import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  cleanupIsolatedE2eEnvironment,
  createIsolatedE2eEnvironment,
} from './e2e-environment.mjs';

const environment = await createIsolatedE2eEnvironment();
const playwrightCli = path.resolve('node_modules/@playwright/test/cli.js');
const args = process.argv.slice(2);
const child = spawn(process.execPath, [playwrightCli, ...(args.length > 0 ? args : ['test'])], {
  cwd: process.cwd(),
  env: environment.env,
  stdio: 'inherit',
});
let forwardedSignal = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    forwardedSignal = signal;
    child.kill(signal);
  });
}

console.log(`[e2e] isolated run root: ${environment.runRoot}`);
console.log(`[e2e] isolated database: ${environment.databasePath}`);

let exitCode = 1;
try {
  exitCode = await new Promise((resolve) => {
    child.once('error', (error) => {
      console.error(error);
      resolve(1);
    });
    child.once('close', (code) => resolve(code ?? 1));
  });
} finally {
  cleanupIsolatedE2eEnvironment(environment);
  console.log(`[e2e] isolated database reset: ${environment.databasePath}`);
}

if (forwardedSignal) {
  process.kill(process.pid, forwardedSignal);
} else {
  process.exitCode = exitCode;
}
