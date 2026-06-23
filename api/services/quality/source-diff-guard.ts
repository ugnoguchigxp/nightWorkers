export type SourceDiffGuardFinding = {
  filePath: string;
  line: string;
  reason: string;
};

export type SourceDiffGuardResult = {
  passed: boolean;
  productionFilesChanged: string[];
  testFilesChanged: string[];
  findings: SourceDiffGuardFinding[];
};

const testPathPattern =
  /(^|\/)(__tests__|tests?|spec|test|fixtures?|mocks?|__mocks__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/i;
const sourcePathPattern = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs|py|rs|go|java|kt|swift|php|rb)$/i;
const forbiddenSourcePatterns: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /NODE_ENV\s*={0,2}=+\s*['"]test['"]|['"]test['"]\s*={0,2}=+\s*NODE_ENV/,
    reason: 'test_environment_branch',
  },
  {
    pattern: /process\.env\.(VITEST|JEST|NODE_ENV)|import\.meta\.vitest|globalThis\.__TEST__/,
    reason: 'test_runtime_detection',
  },
  {
    pattern: /istanbul ignore|c8 ignore|v8 ignore|coverage ignore/i,
    reason: 'coverage_ignore_directive',
  },
  {
    pattern: /data-testid|data-test-id|testId|test-id/,
    reason: 'test_selector_added_to_source',
  },
];

export function evaluateSourceDiffGuard(diff: string): SourceDiffGuardResult {
  const productionFilesChanged = new Set<string>();
  const testFilesChanged = new Set<string>();
  const findings: SourceDiffGuardFinding[] = [];
  let currentFile = '';

  for (const rawLine of diff.split('\n')) {
    if (rawLine.startsWith('diff --git ')) {
      currentFile = parseDiffFilePath(rawLine);
      if (currentFile) {
        if (isTestPath(currentFile)) {
          testFilesChanged.add(currentFile);
        } else if (isSourcePath(currentFile)) {
          productionFilesChanged.add(currentFile);
        }
      }
      continue;
    }
    if (!currentFile || !isSourcePath(currentFile) || isTestPath(currentFile)) continue;
    if (!rawLine.startsWith('+') || rawLine.startsWith('+++')) continue;

    for (const { pattern, reason } of forbiddenSourcePatterns) {
      if (pattern.test(rawLine)) {
        findings.push({
          filePath: currentFile,
          line: rawLine.slice(1).trim(),
          reason,
        });
      }
    }
  }

  return {
    passed: findings.length === 0,
    productionFilesChanged: [...productionFilesChanged].sort(),
    testFilesChanged: [...testFilesChanged].sort(),
    findings,
  };
}

function parseDiffFilePath(line: string): string {
  const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
  return match?.[2] || match?.[1] || '';
}

function isTestPath(filePath: string) {
  return testPathPattern.test(filePath);
}

function isSourcePath(filePath: string) {
  return sourcePathPattern.test(filePath);
}
