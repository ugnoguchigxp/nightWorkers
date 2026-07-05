import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect } from 'vitest';
import app from '../../api/app';
import { createRepository, writeCoverageSummary, writePlaywrightSummary } from './helpers';
import './setup';

describe('Project Detail backend quality', () => {
  it('does not allow PATCH to directly mark a candidate as task_created', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-status-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);
      const createGoalRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-goals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Quality',
            goalText: 'Quality capability を整備する。',
            active: true,
          }),
        }
      );
      expect(createGoalRes.status).toBe(201);
      const generateRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      expect(generateRes.status).toBe(201);
      const generated = (await generateRes.json()) as { candidates: Array<{ id: string }> };

      const patchRes = await app.request(
        `http://localhost/api/mission-task-candidates/${generated.candidates[0].id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'task_created' }),
        }
      );
      expect(patchRes.status).toBe(400);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('rejects quality runs when required capability is missing', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-quality-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);

      const qualityRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality`
      );
      expect(qualityRes.status).toBe(200);
      const quality = await qualityRes.json();
      expect(quality.capabilities.e2e.runnable).toBe(false);

      const runRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'e2e' }),
        }
      );
      expect(runRes.status).toBe(400);

      const runsRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`
      );
      expect(await runsRes.json()).toHaveLength(0);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('persists quality run completion when coverage parsing fails', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-coverage-'));
    try {
      fs.mkdirSync(path.join(repoRoot, 'coverage'));
      fs.writeFileSync(path.join(repoRoot, 'coverage', 'coverage-summary.json'), '{broken');
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit', 'test:coverage': 'echo coverage' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);

      const runRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'unit' }),
        }
      );
      expect(runRes.status).toBe(201);
      const run = await runRes.json();
      expect(run.status).toBe('completed');
      expect(run.errorMessage).toContain('Failed to read coverage-summary.json');

      const qualityRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality`
      );
      const quality = await qualityRes.json();
      expect(quality.runningRuns).toHaveLength(0);
      expect(quality.latestUnitRun.id).toBe(run.id);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('requests Vitest json-summary coverage artifacts for project quality runs', async () => {
    const repoRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'nightworkers-detail-coverage-reporter-')
    );
    try {
      fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
      fs.writeFileSync(
        path.join(repoRoot, 'scripts', 'write-coverage-if-summary-reporter.cjs'),
        [
          "const fs = require('node:fs');",
          "if (!process.argv.includes('--coverage.reporter=json-summary')) process.exit(0);",
          "fs.mkdirSync('coverage', { recursive: true });",
          'fs.writeFileSync(',
          "  'coverage/coverage-summary.json',",
          '  JSON.stringify({',
          '    total: {',
          '      statements: { pct: 91 },',
          '      branches: { pct: 90 },',
          '      functions: { pct: 92 },',
          '      lines: { pct: 93 }',
          '    }',
          '  })',
          ');',
        ].join('\n'),
        'utf8'
      );
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({
          scripts: {
            test: 'echo unit',
            'test:coverage': 'node scripts/write-coverage-if-summary-reporter.cjs',
          },
        }),
        'utf8'
      );
      const project = await createRepository(repoRoot);

      const runRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'unit' }),
        }
      );

      expect(runRes.status).toBe(201);
      const run = await runRes.json();
      expect(run.status).toBe('completed');
      expect(run.command).toContain('--coverage.reporter=json-summary');
      expect(run.errorMessage).toBeNull();
      expect(run.coverageSummary.total.lines.pct).toBe(93);
      expect(run.coverageGate).toMatchObject({
        passed: true,
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('uses all quality runs as the latest coverage and E2E display source', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-quality-all-'));
    try {
      writeCoverageSummary(repoRoot);
      writePlaywrightSummary(repoRoot);
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({
          scripts: {
            test: 'echo unit',
            'test:coverage': 'echo coverage',
            'test:e2e': 'echo e2e',
          },
        }),
        'utf8'
      );
      const project = await createRepository(repoRoot);

      const runRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'all' }),
        }
      );
      expect(runRes.status).toBe(201);
      const run = (await runRes.json()) as { id: string; runType: string };
      expect(run.runType).toBe('all');

      const qualityRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality`
      );
      expect(qualityRes.status).toBe(200);
      const quality = await qualityRes.json();

      expect(quality.latestUnitRun).toBeNull();
      expect(quality.latestE2eRun).toBeNull();
      expect(quality.latestAllRun.id).toBe(run.id);
      expect(quality.latestCoverageRun.id).toBe(run.id);
      expect(quality.latestE2eResultRun.id).toBe(run.id);
      expect(quality.latestCoverageRun.coverageSummary['src/checkout.ts'].lines.pct).toBe(72);
      expect(quality.latestE2eResultRun.e2eSummary.suites).toMatchObject([
        { title: 'checkout.spec.ts', tests: 1, status: 'passed' },
      ]);
      expect(quality.recentRuns.map((item: { id: string }) => item.id)).toContain(run.id);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('keeps E2E runs visible when the structured artifact is missing', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-e2e-missing-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit', 'test:e2e': 'echo e2e' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);

      const runRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'e2e' }),
        }
      );
      expect(runRes.status).toBe(201);
      const run = await runRes.json();
      expect(run.errorMessage).toContain('E2E artifact not found');

      const qualityRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality`
      );
      const quality = await qualityRes.json();
      expect(quality.latestE2eRun.id).toBe(run.id);
      expect(quality.latestE2eResultRun.id).toBe(run.id);
      expect(quality.latestE2eResultRun.e2eSummary).toMatchObject({
        status: 'passed',
        total: 0,
        suites: [],
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('requests Playwright JSON artifacts for E2E quality runs', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-e2e-reporter-'));
    try {
      fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
      fs.writeFileSync(
        path.join(repoRoot, 'scripts', 'write-e2e-if-json-reporter.cjs'),
        [
          "const fs = require('node:fs');",
          "const path = require('node:path');",
          'const outputFile = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;',
          "const hasJsonReporter = process.argv.some((arg) => arg.includes('--reporter=') && arg.includes('json'));",
          'if (!outputFile || !hasJsonReporter) process.exit(0);',
          'fs.mkdirSync(path.dirname(outputFile), { recursive: true });',
          'fs.writeFileSync(',
          '  outputFile,',
          '  JSON.stringify({',
          '    suites: [',
          '      {',
          "        title: 'smoke.spec.ts',",
          '        specs: [',
          '          {',
          "            title: 'public screens render',",
          '            tests: [{ results: [{ status: "passed", duration: 120 }] }]',
          '          }',
          '        ]',
          '      }',
          '    ]',
          '  })',
          ');',
        ].join('\n'),
        'utf8'
      );
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({
          scripts: {
            test: 'echo unit',
            'test:e2e': 'node scripts/write-e2e-if-json-reporter.cjs',
          },
        }),
        'utf8'
      );
      const project = await createRepository(repoRoot);

      const runRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'e2e' }),
        }
      );

      expect(runRes.status).toBe(201);
      const run = await runRes.json();
      expect(run.status).toBe('completed');
      expect(run.command).toContain('PLAYWRIGHT_JSON_OUTPUT_FILE');
      expect(run.command).toContain('--reporter=list,json');
      expect(run.errorMessage).toBeNull();
      expect(run.e2eSummary).toMatchObject({
        status: 'passed',
        total: 1,
        passed: 1,
        failed: 0,
        suites: [{ title: 'smoke.spec.ts', status: 'passed', tests: 1 }],
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('counts failed tests from E2E artifacts instead of failed suites only', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-e2e-failed-'));
    try {
      fs.mkdirSync(path.join(repoRoot, 'playwright-report'), { recursive: true });
      fs.writeFileSync(
        path.join(repoRoot, 'playwright-report', 'results.json'),
        JSON.stringify({
          suites: [
            {
              title: 'checkout.spec.ts',
              specs: [
                {
                  title: 'loads checkout',
                  tests: [
                    {
                      results: [
                        { status: 'failed', duration: 100, error: { message: 'missing total' } },
                      ],
                    },
                  ],
                },
                {
                  title: 'submits checkout',
                  tests: [
                    {
                      results: [
                        {
                          status: 'failed',
                          duration: 200,
                          error: { message: 'button disabled' },
                        },
                      ],
                    },
                  ],
                },
                {
                  title: 'opens receipt',
                  tests: [{ results: [{ status: 'passed', duration: 50 }] }],
                },
                {
                  title: 'passes after retry',
                  tests: [
                    {
                      results: [
                        { status: 'failed', duration: 30, error: { message: 'first attempt' } },
                        { status: 'passed', duration: 40 },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit', 'test:e2e': 'echo e2e' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);

      const runRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'e2e' }),
        }
      );
      expect(runRes.status).toBe(201);
      const run = await runRes.json();
      expect(run.e2eSummary).toMatchObject({
        status: 'failed',
        total: 4,
        passed: 2,
        failed: 2,
      });
      expect(run.e2eSummary.suites).toMatchObject([
        { title: 'checkout.spec.ts', status: 'failed', tests: 4, lastFailure: 'button disabled' },
      ]);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('does not expose quality run detail through another repository route', async () => {
    const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-run-a-'));
    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-run-b-'));
    try {
      for (const repoRoot of [firstRoot, secondRoot]) {
        fs.writeFileSync(
          path.join(repoRoot, 'package.json'),
          JSON.stringify({ scripts: { test: 'echo unit' } }),
          'utf8'
        );
      }
      const firstProject = await createRepository(firstRoot);
      const secondProject = await createRepository(secondRoot);

      const runRes = await app.request(
        `http://localhost/api/repositories/${firstProject.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'unit' }),
        }
      );
      expect(runRes.status).toBe(201);
      const run = await runRes.json();

      const mismatchRes = await app.request(
        `http://localhost/api/repositories/${secondProject.id}/quality/runs/${run.id}`
      );
      expect(mismatchRes.status).toBe(404);
    } finally {
      fs.rmSync(firstRoot, { recursive: true, force: true });
      fs.rmSync(secondRoot, { recursive: true, force: true });
    }
  });
});
