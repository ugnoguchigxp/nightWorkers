import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateCoverageAutonomyGate } from '../api/services/quality/coverage-autonomy-gate';
import {
  evaluateCoverageGate,
  parseCoverageSummaryJson,
} from '../api/services/quality/coverage-gate';
import { inspectProjectQualityPrerequisites } from '../api/services/quality/project-quality-prerequisites';
import { evaluateSourceDiffGuard } from '../api/services/quality/source-diff-guard';

let tempDir: string | null = null;

function makeTempDir() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-coverage-gate-'));
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

const summary = {
  total: {
    statements: { pct: 91 },
    branches: { pct: 79 },
    functions: { pct: 88 },
    lines: { pct: 92 },
  },
};

describe('coverage gate', () => {
  it('parses total coverage percentages for all metrics', () => {
    expect(parseCoverageSummaryJson(summary)).toEqual({
      statements: 91,
      branches: 79,
      functions: 88,
      lines: 92,
    });
  });

  it('fails when any metric is below the single configured threshold', () => {
    const result = evaluateCoverageGate(
      {
        coverageGateEnabled: true,
        coverageMinimumPercent: 80,
        coverageMaxIterations: 5,
      },
      summary,
      { measuredAt: new Date('2026-06-23T00:00:00.000Z') }
    );

    expect(result.passed).toBe(false);
    expect(result.failedMetrics).toEqual(['branches']);
    expect(result.metrics.find((metric) => metric.metric === 'branches')).toMatchObject({
      actualPercent: 79,
      deltaPercent: -1,
      passed: false,
    });
  });

  it('passes without parsing coverage when the gate is disabled', () => {
    const result = evaluateCoverageGate(
      {
        coverageGateEnabled: false,
        coverageMinimumPercent: 80,
        coverageMaxIterations: 5,
      },
      {}
    );

    expect(result).toMatchObject({
      enabled: false,
      passed: true,
      reason: 'coverage_gate_disabled',
    });
  });
});

describe('coverage autonomy gate config handling', () => {
  it('does not silently disable the gate when nightworkers-quality.json is malformed', async () => {
    const repoRoot = makeTempDir();
    fs.writeFileSync(path.join(repoRoot, 'nightworkers-quality.json'), '{broken');

    const { result } = await evaluateCoverageAutonomyGate({ repoRoot });

    expect(result.status).toBe('needs_human');
    expect(result.message).toContain('configuration could not be read');
    expect(result.configError).toContain('Failed to parse');
  });
});

describe('project quality prerequisites', () => {
  it('requires verify and test:coverage scripts', () => {
    const repoRoot = makeTempDir();
    fs.writeFileSync(
      path.join(repoRoot, 'package.json'),
      JSON.stringify(
        {
          scripts: {
            verify: 'bun scripts/verify.mjs verify',
            'test:coverage': 'vitest run --coverage',
          },
        },
        null,
        2
      )
    );

    expect(inspectProjectQualityPrerequisites(repoRoot)).toMatchObject({
      packageJsonPresent: true,
      ready: true,
      prerequisites: [
        { name: 'verify', present: true },
        { name: 'test:coverage', present: true },
      ],
    });
  });

  it('does not accept verify:base as a substitute for verify', () => {
    const repoRoot = makeTempDir();
    fs.writeFileSync(
      path.join(repoRoot, 'package.json'),
      JSON.stringify({ scripts: { 'verify:base': 'bun scripts/verify.mjs base' } })
    );

    expect(inspectProjectQualityPrerequisites(repoRoot)).toMatchObject({
      ready: false,
      prerequisites: [
        { name: 'verify', present: false },
        { name: 'test:coverage', present: false },
      ],
    });
  });
});

describe('source diff guard', () => {
  it('blocks test-only branches in production source files', () => {
    const result = evaluateSourceDiffGuard(`diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,2 @@
 export function foo() {}
+if (process.env.NODE_ENV === 'test') foo();
`);

    expect(result.passed).toBe(false);
    expect(result.productionFilesChanged).toEqual(['src/foo.ts']);
    expect(result.findings).toEqual([
      expect.objectContaining({
        filePath: 'src/foo.ts',
        reason: 'test_environment_branch',
      }),
      expect.objectContaining({
        filePath: 'src/foo.ts',
        reason: 'test_runtime_detection',
      }),
    ]);
  });

  it('allows ordinary test file changes', () => {
    const result = evaluateSourceDiffGuard(`diff --git a/tests/foo.test.ts b/tests/foo.test.ts
--- a/tests/foo.test.ts
+++ b/tests/foo.test.ts
@@ -1,1 +1,2 @@
 test('foo', () => {});
+test('bar', () => {});
`);

    expect(result.passed).toBe(true);
    expect(result.testFilesChanged).toEqual(['tests/foo.test.ts']);
    expect(result.findings).toEqual([]);
  });
});
