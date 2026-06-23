import fs from 'node:fs';
import { ValidationError } from '../../lib/errors';
import type { TestQualitySettings } from '../settings/test-quality-settings';

export const COVERAGE_METRICS = ['statements', 'branches', 'functions', 'lines'] as const;

export type CoverageMetricName = (typeof COVERAGE_METRICS)[number];

export type CoverageMetricResult = {
  metric: CoverageMetricName;
  actualPercent: number;
  targetPercent: number;
  deltaPercent: number;
  passed: boolean;
};

export type CoverageGateResult = {
  enabled: boolean;
  passed: boolean;
  targetPercent: number;
  metrics: CoverageMetricResult[];
  failedMetrics: CoverageMetricName[];
  summaryPath?: string;
  measuredAt: string;
  reason?: string;
};

export type ParsedCoverageSummary = Record<CoverageMetricName, number>;

export function readCoverageSummaryFile(summaryPath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  } catch (err) {
    throw new ValidationError('Failed to read coverage-summary.json', {
      summaryPath,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

export function parseCoverageSummaryJson(input: unknown): ParsedCoverageSummary {
  if (!isRecord(input) || !isRecord(input.total)) {
    throw new ValidationError('coverage-summary.json must contain a total object');
  }

  const totals = {} as ParsedCoverageSummary;
  for (const metric of COVERAGE_METRICS) {
    const metricSummary = input.total[metric];
    if (!isRecord(metricSummary) || typeof metricSummary.pct !== 'number') {
      throw new ValidationError(`coverage-summary.json total.${metric}.pct is required`);
    }
    if (!Number.isFinite(metricSummary.pct)) {
      throw new ValidationError(`coverage-summary.json total.${metric}.pct must be finite`);
    }
    totals[metric] = metricSummary.pct;
  }
  return totals;
}

export function evaluateCoverageGate(
  settings: TestQualitySettings,
  summaryJson: unknown,
  options: { summaryPath?: string; measuredAt?: Date } = {}
): CoverageGateResult {
  const measuredAt = (options.measuredAt ?? new Date()).toISOString();
  const targetPercent = settings.coverageMinimumPercent;
  if (!settings.coverageGateEnabled) {
    return {
      enabled: false,
      passed: true,
      targetPercent,
      metrics: [],
      failedMetrics: [],
      summaryPath: options.summaryPath,
      measuredAt,
      reason: 'coverage_gate_disabled',
    };
  }

  const totals = parseCoverageSummaryJson(summaryJson);
  const metrics = COVERAGE_METRICS.map((metric) => {
    const actualPercent = totals[metric];
    const deltaPercent = roundPercent(actualPercent - targetPercent);
    return {
      metric,
      actualPercent,
      targetPercent,
      deltaPercent,
      passed: actualPercent >= targetPercent,
    };
  });
  const failedMetrics = metrics.filter((metric) => !metric.passed).map((metric) => metric.metric);

  return {
    enabled: true,
    passed: failedMetrics.length === 0,
    targetPercent,
    metrics,
    failedMetrics,
    summaryPath: options.summaryPath,
    measuredAt,
    reason: failedMetrics.length === 0 ? 'coverage_gate_passed' : 'coverage_gate_failed',
  };
}

export function evaluateCoverageSummaryFile(
  settings: TestQualitySettings,
  summaryPath: string
): CoverageGateResult {
  return evaluateCoverageGate(settings, readCoverageSummaryFile(summaryPath), { summaryPath });
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
