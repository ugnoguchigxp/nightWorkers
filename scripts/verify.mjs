import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const task = (id, label, args) => ({ id, label, command: 'bun', args });

const trackedArtifactTask = task('tracked-artifacts', 'tracked artifact check', [
  '--silent',
  'run',
  'check:tracked-artifacts',
]);
const architectureTask = task('architecture', 'architecture boundary checks', [
  '--silent',
  'run',
  'check:architecture',
]);
const fixtureCatalogTask = task(
  'llm-fixture-catalog',
  'LLM fixture catalog stale check',
  ['--silent', 'run', 's11tnext:fixtures:check'],
);
const typecheckTask = task('typecheck', 'typecheck', ['--silent', 'run', 'typecheck']);
const lintTask = task('lint', 'lint', ['--silent', 'run', 'lint']);
const supervisorRegressionTask = task(
  'supervisor-regression',
  'supervisor regression tests',
  ['--silent', 'run', 'test:supervisor-regression'],
);
const desktopRuntimeTask = task('desktop-runtime', 'desktop runtime tests', [
  '--silent',
  'run',
  'test:desktop-runtime',
]);
const desktopLintTask = task('desktop-lint', 'desktop lint', [
  '--silent',
  'run',
  'desktop:lint',
]);
const desktopBackendBuildTask = task(
  'desktop-backend-build',
  'desktop backend bundle build',
  ['--silent', 'run', 'build:backend:desktop'],
);
const desktopBuildTask = task('desktop-build', 'desktop build', [
  '--silent',
  'run',
  'desktop:build',
]);
const desktopSidecarSmokeTask = task('desktop-sidecar-smoke', 'desktop sidecar smoke', [
  '--silent',
  'run',
  'desktop:smoke-sidecar',
]);
const desktopPackagedSmokeTask = task('desktop-packaged-smoke', 'desktop packaged smoke', [
  '--silent',
  'run',
  'desktop:smoke',
]);
const allTestsTask = task('all-tests', 'all vitest tests', [
  '--silent',
  'run',
  'test',
  'run',
]);
const liveLlmTask = task('live-llm', 'live LLM provider tests', [
  '--silent',
  'run',
  'test:live:llm',
]);
const liveAgentE2eTask = task('live-agent-e2e', 'live LLM agent E2E', [
  '--silent',
  'run',
  'test:e2e:agent-live',
]);
const e2eCoverageTask = task('e2e-coverage', 'Playwright deterministic E2E coverage', [
  '--silent',
  'run',
  'test:e2e:coverage',
]);
const accessibilityE2eTask = task('e2e-accessibility', 'Playwright accessibility', [
  '--silent',
  'run',
  'test:e2e:a11y',
]);
const dependencyAuditTask = task('dependency-audit', 'High/Critical dependency audit', [
  '--silent',
  'run',
  'audit:dependencies',
]);
const releaseMetadataTask = task('release-metadata', 'release metadata', [
  '--silent',
  'run',
  'release:check',
]);
const docsConsistencyTask = task('docs-consistency', 'documentation consistency', [
  '--silent',
  'run',
  'check:docs',
]);
const demoSmokeTask = task('demo-smoke', 'deterministic demo smoke', [
  '--silent',
  'run',
  'demo:smoke',
]);

const basePhases = [
  {
    id: 'base-static',
    label: 'base static checks',
    mode: 'parallel',
    tasks: [
      trackedArtifactTask,
      architectureTask,
      fixtureCatalogTask,
      typecheckTask,
      lintTask,
    ],
  },
  {
    id: 'base-supervisor',
    label: 'base serial tests',
    mode: 'serial',
    tasks: [supervisorRegressionTask],
  },
];
const fullTestPhase = {
  id: 'full-tests',
  label: 'full serial tests',
  mode: 'serial',
  tasks: [allTestsTask],
};
const e2ePhase = {
  id: 'e2e-coverage',
  label: 'E2E scenario coverage',
  mode: 'serial',
  tasks: [e2eCoverageTask],
};
const accessibilityPhase = {
  id: 'e2e-accessibility',
  label: 'Accessibility E2E',
  mode: 'serial',
  tasks: [accessibilityE2eTask],
};
const auditPhase = {
  id: 'dependency-audit',
  label: 'dependency policy',
  mode: 'serial',
  tasks: [dependencyAuditTask],
};
const releaseMetadataPhase = {
  id: 'release-metadata',
  label: 'release metadata and documentation',
  mode: 'parallel',
  tasks: [releaseMetadataTask, docsConsistencyTask],
};
const demoPhase = {
  id: 'deterministic-demo',
  label: 'credential-free demo',
  mode: 'serial',
  tasks: [demoSmokeTask],
};
const livePhase = {
  id: 'live-provider',
  label: 'opt-in live provider checks',
  mode: 'serial',
  tasks: [liveLlmTask, liveAgentE2eTask],
};
const desktopPhases = [
  {
    id: 'desktop-independent',
    label: 'desktop independent checks',
    mode: 'parallel',
    tasks: [desktopRuntimeTask, desktopLintTask],
  },
  {
    id: 'desktop-build-smoke',
    label: 'desktop build and smoke',
    mode: 'serial',
    tasks: [
      desktopBackendBuildTask,
      desktopBuildTask,
      desktopSidecarSmokeTask,
      desktopPackagedSmokeTask,
    ],
  },
];
const deterministicFullPhases = [
  ...basePhases,
  fullTestPhase,
  e2ePhase,
  demoPhase,
  auditPhase,
  ...desktopPhases,
];

export const taskSets = {
  base: basePhases,
  desktop: desktopPhases,
  verify: basePhases,
  full: deterministicFullPhases,
  e2e: [e2ePhase],
  accessibility: [accessibilityPhase],
  audit: [auditPhase],
  live: [livePhase],
  release: [releaseMetadataPhase, ...deterministicFullPhases],
};

const formatDuration = (startedAt) =>
  `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;

const runTask = (taskDefinition) =>
  new Promise((resolve) => {
    const startedAt = performance.now();
    console.log(`[verify] ${taskDefinition.label} ...`);

    const child = spawn(taskDefinition.command, taskDefinition.args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({
        task: taskDefinition,
        duration: formatDuration(startedAt),
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        ...result,
      });
    };

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      stderr.push(Buffer.from(`${error.message}\n`));
      finish({ code: 1 });
    });
    child.on('close', (code, signal) => finish({ code: code ?? 1, signal }));
  });

const hasFailed = (result) => result.code !== 0 || result.signal;

const printCapturedOutput = (result) => {
  console.error(`[verify] ${result.task.label} failed (${result.duration})`);
  if (result.signal) console.error(`[verify] signal: ${result.signal}`);
  if (result.stdout.trim()) {
    console.error(`\n--- ${result.task.label} stdout ---`);
    console.error(result.stdout.trimEnd());
  }
  if (result.stderr.trim()) {
    console.error(`\n--- ${result.task.label} stderr ---`);
    console.error(result.stderr.trimEnd());
  }
};

const printResult = (result) => {
  if (hasFailed(result)) {
    printCapturedOutput(result);
    return;
  }
  console.log(`[verify] ${result.task.label} ok (${result.duration})`);
};

export function formatVerificationSummary(target, results) {
  const lines = [
    '',
    `[verify] summary target=${target}`,
    'status  phase                   task                          duration',
  ];
  for (const result of results) {
    lines.push(
      `${hasFailed(result) ? 'FAIL' : 'PASS'}    ${result.phase.label.padEnd(23)} ${result.task.label.padEnd(29)} ${result.duration}`,
    );
  }
  return lines.join('\n');
}

export async function executeVerificationPhases(phases, taskRunner = runTask) {
  const results = [];
  for (const phase of phases) {
    console.log(`[verify] ${phase.label} (${phase.mode})`);
    const phaseResults =
      phase.mode === 'parallel'
        ? await Promise.all(phase.tasks.map((item) => taskRunner(item)))
        : phase.mode === 'serial'
          ? await runSerialTasks(phase.tasks, taskRunner)
          : null;
    if (!phaseResults) {
      throw new Error(`Unknown verify phase mode: ${phase.mode}`);
    }
    const annotatedResults = phaseResults.map((result) => ({ ...result, phase }));
    results.push(...annotatedResults);
    for (const result of annotatedResults) printResult(result);
    const failure = annotatedResults.find(hasFailed);
    if (failure) return { results, failure };
  }
  return { results, failure: null };
}

async function runSerialTasks(tasks, taskRunner) {
  const results = [];
  for (const item of tasks) {
    const result = await taskRunner(item);
    results.push(result);
    if (hasFailed(result)) break;
  }
  return results;
}

async function main() {
  const target = process.argv[2] || 'verify';
  const phases = taskSets[target];
  if (!phases) {
    console.error(`Unknown verify target: ${target}`);
    console.error(`Expected one of: ${Object.keys(taskSets).join(', ')}`);
    return 1;
  }
  if (process.argv.includes('--list')) {
    console.log(
      JSON.stringify(
        phases.map((phase) => ({
          id: phase.id,
          label: phase.label,
          mode: phase.mode,
          tasks: phase.tasks.map(({ id, label }) => ({ id, label })),
        })),
        null,
        2,
      ),
    );
    return 0;
  }

  const { results, failure } = await executeVerificationPhases(phases);
  const summary = formatVerificationSummary(target, results);
  console.log(summary);
  if (failure) {
    console.error(
      `[verify] blocked at phase=${failure.phase.id} task=${failure.task.id}`,
    );
    return failure.code || 1;
  }
  if (target === 'release') {
    console.log('[verify] release-ready: all required gates passed');
  } else {
    console.log(`[verify] ${target} verification passed`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
