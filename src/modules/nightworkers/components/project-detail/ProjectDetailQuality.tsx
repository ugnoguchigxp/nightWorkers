import { ClipboardCheck, Play, TestTube2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type {
  E2ESummary,
  ProjectQualityOverview,
  ProjectQualityRun,
} from '../../../../../shared/schemas/project-detail.schema';
import type { CoverageDisplayValue, CoverageFileRow } from '../../qualityRows';
import {
  EmptyTableRow,
  JestStatusLabel,
  SectionHeading,
  SectionLabel,
} from './ProjectDetailCommon';
import {
  controlStyle,
  mutedTextStyle,
  panelStyle,
  primaryButtonStyle,
  primaryTextStyle,
  subtleTextStyle,
  tableBorderStyle,
} from './styles';
import type { E2EResultRow } from './types';

const coverageAxisMetrics = ['statements', 'branches', 'functions', 'lines'] as const;

export function coverageAxesFromQualityRun(run: ProjectQualityRun | null | undefined) {
  const gateMetrics = run?.coverageGate?.metrics ?? [];
  if (gateMetrics.length > 0) {
    return gateMetrics.map((metric) => ({
      labelKey: `projectDetail.coverage.${metric.metric}`,
      value: metric.actualPercent,
    }));
  }

  const total = coverageSummaryTotal(run?.coverageSummary);
  if (!total) return [];
  return coverageAxisMetrics.flatMap((metric) => {
    const value = coverageMetricPercent(total[metric]);
    return value === null ? [] : [{ labelKey: `projectDetail.coverage.${metric}`, value }];
  });
}

function coverageSummaryTotal(summary: unknown): Record<string, unknown> | null {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  const total = (summary as Record<string, unknown>).total;
  return total && typeof total === 'object' && !Array.isArray(total)
    ? (total as Record<string, unknown>)
    : null;
}

function coverageMetricPercent(metricSummary: unknown) {
  if (!metricSummary || typeof metricSummary !== 'object' || Array.isArray(metricSummary)) {
    return null;
  }
  const pct = (metricSummary as Record<string, unknown>).pct;
  return typeof pct === 'number' && Number.isFinite(pct) ? pct : null;
}

export function QualityReportPanel({
  quality,
  coverageRows,
  e2eRows,
  busy,
  onRun,
}: {
  quality: ProjectQualityOverview | null;
  coverageRows: CoverageFileRow[];
  e2eRows: E2EResultRow[];
  busy: boolean;
  onRun: (runType: 'unit' | 'e2e' | 'all') => void;
}) {
  const { t } = useTranslation();
  const runButtons = [
    {
      label: t('projectDetail.quality.runUnit'),
      runType: 'unit' as const,
      capability: quality?.capabilities.unit,
    },
    {
      label: t('projectDetail.quality.runE2E'),
      runType: 'e2e' as const,
      capability: quality?.capabilities.e2e,
    },
    {
      label: t('projectDetail.quality.runAll'),
      runType: 'all' as const,
      capability: quality?.capabilities.all,
    },
  ];
  const coverageRun = quality?.latestCoverageRun ?? null;
  const e2eRun = quality?.latestE2eResultRun ?? null;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeading
          icon={<TestTube2 className="h-4 w-4" />}
          title={t('projectDetail.quality.title')}
        />
        <div className="flex flex-wrap gap-2">
          {runButtons.map((button, index) => (
            <Button
              key={button.runType}
              type="button"
              onClick={() => onRun(button.runType)}
              disabled={busy || !button.capability?.runnable}
              title={
                button.capability?.runnable
                  ? button.capability.command
                  : button.capability?.missingCapabilities.join(', ')
              }
              className="h-8 px-3 text-xs font-semibold"
              style={index === 2 ? primaryButtonStyle : controlStyle}
            >
              <Play className="h-3.5 w-3.5" />
              {button.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <QualityRunStatus
          label={t('projectDetail.quality.coverageReport')}
          run={coverageRun}
          emptyMessage={t('projectDetail.quality.coverageNotRun')}
          capability={quality?.capabilities.coverage}
        />
        <QualityRunStatus
          label={t('projectDetail.quality.e2eResults')}
          run={e2eRun}
          emptyMessage={t('projectDetail.quality.e2eNotRun')}
          capability={quality?.capabilities.e2e}
        />
      </div>

      <div className="overflow-hidden border" style={panelStyle}>
        <div
          className="flex items-center justify-between gap-3 border-b p-3"
          style={tableBorderStyle}
        >
          <div>
            <SectionLabel
              icon={<ClipboardCheck className="h-4 w-4" />}
              title={t('projectDetail.quality.coverageReport')}
            />
            <div className="mt-1 text-xs" style={mutedTextStyle}>
              {t('projectDetail.quality.coverageSubtitle')}
            </div>
          </div>
        </div>
        <div className="nightworkers-scrollbar overflow-auto">
          <table className="w-full min-w-[1040px] border-collapse font-mono text-xs">
            <thead>
              <tr style={subtleTextStyle}>
                <th className="border-b py-2 pl-4 text-left" style={tableBorderStyle}>
                  {t('projectDetail.field.file')}
                </th>
                <th className="border-b px-2 py-2 text-right" style={tableBorderStyle}>
                  {t('projectDetail.field.statements')}
                </th>
                <th className="border-b px-2 py-2 text-right" style={tableBorderStyle}>
                  {t('projectDetail.field.branches')}
                </th>
                <th className="border-b px-2 py-2 text-right" style={tableBorderStyle}>
                  {t('projectDetail.field.functions')}
                </th>
                <th className="border-b px-2 py-2 text-right" style={tableBorderStyle}>
                  {t('projectDetail.field.lines')}
                </th>
                <th className="border-b py-2 pr-4 text-left" style={tableBorderStyle}>
                  {t('projectDetail.field.uncoveredLines')}
                </th>
              </tr>
            </thead>
            <tbody>
              {coverageRows.length > 0 ? (
                coverageRows.map((row) => (
                  <tr
                    key={row.file}
                    className={row.summary ? 'font-bold' : undefined}
                    style={
                      row.summary
                        ? {
                            background: 'color-mix(in srgb, var(--nw-primary) 7%, var(--nw-panel))',
                          }
                        : undefined
                    }
                  >
                    <td className="border-b py-2 pl-4" style={tableBorderStyle}>
                      <span className="block max-w-[360px] truncate">{row.file}</span>
                    </td>
                    <CoverageCell value={row.statements} />
                    <CoverageCell value={row.branches} />
                    <CoverageCell value={row.functions} />
                    <CoverageCell value={row.lines} />
                    <td className="border-b py-2 pr-4" style={tableBorderStyle}>
                      <span className="block max-w-[360px] truncate" style={subtleTextStyle}>
                        {row.uncovered}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyTableRow colSpan={6} message={t('projectDetail.empty.coverageReport')} />
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden border" style={panelStyle}>
        <div className="border-b p-3" style={tableBorderStyle}>
          <SectionLabel
            icon={<TestTube2 className="h-4 w-4" />}
            title={t('projectDetail.quality.e2eResults')}
          />
        </div>
        <div className="nightworkers-scrollbar overflow-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead style={subtleTextStyle}>
              <tr>
                <th className="py-2 pl-4 text-left">{t('projectDetail.field.status')}</th>
                <th className="py-2 text-left">{t('projectDetail.field.suite')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.tests')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.time')}</th>
                <th className="py-2 pr-4 text-left">{t('projectDetail.field.lastFailure')}</th>
              </tr>
            </thead>
            <tbody>
              {e2eRows.length > 0 ? (
                e2eRows.map((row) => (
                  <tr key={row.suite} className="border-t" style={tableBorderStyle}>
                    <td className="py-3 pl-4">
                      <JestStatusLabel status={row.status} />
                    </td>
                    <td className="py-3 font-semibold">{row.suite}</td>
                    <td className="py-3 text-right">{row.tests}</td>
                    <td className="py-3 text-right">{row.duration}</td>
                    <td className="py-3 pr-4">{row.lastFailure}</td>
                  </tr>
                ))
              ) : (
                <EmptyTableRow colSpan={5} message={t('projectDetail.empty.e2eResults')} />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function QualityRunStatus({
  label,
  run,
  emptyMessage,
  capability,
}: {
  label: string;
  run: ProjectQualityRun | null;
  emptyMessage: string;
  capability?: { runnable: boolean; missingCapabilities: string[]; command?: string };
}) {
  const { t } = useTranslation();
  const missingCapability =
    !capability?.runnable && capability?.missingCapabilities.length
      ? t('projectDetail.quality.missingCapability', {
          capability: capability.missingCapabilities.join(', '),
        })
      : null;
  return (
    <div className="border p-3 text-xs" style={panelStyle}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{label}</span>
        {run ? <QualityStatusChip status={run.status} /> : null}
      </div>
      <div className="mt-2 space-y-1" style={mutedTextStyle}>
        {run ? (
          <>
            <div>
              {run.runType} / {run.status}
              {run.exitCode === null ? '' : ` / exit ${run.exitCode}`}
            </div>
            <div className="truncate">{run.command}</div>
            {run.coverageGate ? (
              <div>
                {t('projectDetail.quality.coverageGateStatus', {
                  status: run.coverageGate.passed ? 'PASS' : 'FAIL',
                  target: run.coverageGate.targetPercent,
                })}
              </div>
            ) : null}
            {missingCapability ? (
              <div style={{ color: 'var(--nw-warning)' }}>{missingCapability}</div>
            ) : null}
            {run.errorMessage ? (
              <div style={{ color: 'var(--nw-warning)' }}>{run.errorMessage}</div>
            ) : null}
            {run.latestOutput ? (
              <details className="mt-2">
                <summary className="cursor-pointer" style={primaryTextStyle}>
                  {t('projectDetail.quality.commandOutput')}
                </summary>
                <pre
                  className="nightworkers-scrollbar mt-2 max-h-40 overflow-auto whitespace-pre-wrap border p-2 font-mono text-[11px]"
                  style={controlStyle}
                >
                  {run.latestOutput}
                </pre>
              </details>
            ) : null}
          </>
        ) : (
          <div>{missingCapability ?? emptyMessage}</div>
        )}
      </div>
    </div>
  );
}

function QualityStatusChip({ status }: { status: ProjectQualityRun['status'] }) {
  if (status === 'completed') return <JestStatusLabel status="PASS" />;
  if (status === 'failed' || status === 'cancelled') return <JestStatusLabel status="FAIL" />;
  return (
    <span
      className="inline-flex h-6 items-center border px-2 font-mono text-[11px] font-bold"
      style={{
        background: 'color-mix(in srgb, var(--nw-primary) 12%, var(--nw-panel))',
        borderColor: 'color-mix(in srgb, var(--nw-primary) 42%, var(--nw-border))',
        borderRadius: 'var(--nw-control-radius)',
        color: 'var(--nw-primary)',
      }}
    >
      {status.toUpperCase()}
    </span>
  );
}

function CoverageCell({ value }: { value: CoverageDisplayValue }) {
  if (value === null) {
    return (
      <td className="border-b px-2 py-2 text-right font-bold" style={tableBorderStyle}>
        —
      </td>
    );
  }
  const tone =
    value >= 85 ? 'var(--nw-success)' : value >= 80 ? 'var(--nw-warning)' : 'var(--nw-danger)';
  return (
    <td
      className="border-b px-2 py-2 text-right font-bold"
      style={{
        ...tableBorderStyle,
        background: `color-mix(in srgb, ${tone} 12%, var(--nw-panel))`,
        color: tone,
      }}
    >
      {value.toFixed(1)}
    </td>
  );
}

export function e2eRowsFromSummary(summary: E2ESummary | null | undefined): E2EResultRow[] {
  if (!summary) return [];
  if (summary.suites.length === 0) {
    return [
      {
        suite: 'E2E',
        status: summary.status === 'passed' ? 'PASS' : 'FAIL',
        tests: summary.total > 0 ? `${summary.passed}/${summary.total}` : '—',
        duration: summary.durationMs === null ? '—' : `${Math.round(summary.durationMs / 1000)}s`,
        lastFailure: summary.failed > 0 ? 'See command output' : '—',
      },
    ];
  }
  return summary.suites.map((suite) => ({
    suite: suite.title,
    status: suite.status === 'passed' ? 'PASS' : 'FAIL',
    tests: String(suite.tests),
    duration: suite.durationMs === null ? '—' : `${Math.round(suite.durationMs / 1000)}s`,
    lastFailure: suite.lastFailure ?? '—',
  }));
}
