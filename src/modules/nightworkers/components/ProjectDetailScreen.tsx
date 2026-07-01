import {
  Activity,
  BarChart3,
  CircleDollarSign,
  ClipboardCheck,
  Play,
  Sparkles,
  Target,
  TestTube2,
  Zap,
} from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ProjectEvaluationScreen } from '@/modules/project-evaluation';
import type { Repository, Task, WorkbenchSessionView } from '../types';

type ProjectDetailScreenProps = {
  project: Repository;
  sessionViews: WorkbenchSessionView[];
  onOpenSession: (sessionId: string) => void;
  onEvaluationTasksCreated?: (tasks: Task[]) => void;
};

type ProjectDetailTab = 'overview' | 'mission' | 'evaluation' | 'quality';

const projectDetailTabs = [
  { id: 'overview', labelKey: 'projectDetail.tab.overview' },
  { id: 'mission', labelKey: 'projectDetail.tab.mission' },
  { id: 'evaluation', labelKey: 'projectDetail.tab.evaluation' },
  { id: 'quality', labelKey: 'projectDetail.tab.quality' },
] satisfies { id: ProjectDetailTab; labelKey: string }[];

const shellStyle = {
  background: 'var(--nw-background)',
  color: 'var(--nw-text)',
} satisfies React.CSSProperties;

const panelStyle = {
  background: 'var(--nw-panel)',
  borderColor: 'var(--nw-border)',
  borderRadius: 'var(--nw-radius)',
  boxShadow: 'var(--nw-shadow)',
  color: 'var(--nw-text)',
} satisfies React.CSSProperties;

const controlStyle = {
  background: 'var(--nw-panel)',
  borderColor: 'var(--nw-border)',
  borderRadius: 'var(--nw-control-radius)',
  color: 'var(--nw-text)',
} satisfies React.CSSProperties;

const mutedTextStyle = {
  color: 'var(--nw-muted-text)',
} satisfies React.CSSProperties;

const subtleTextStyle = {
  color: 'var(--nw-subtle-text)',
} satisfies React.CSSProperties;

const primaryTextStyle = {
  color: 'var(--nw-primary)',
} satisfies React.CSSProperties;

const primaryButtonStyle = {
  background: 'var(--nw-primary)',
  borderColor: 'var(--nw-primary)',
  borderRadius: 'var(--nw-control-radius)',
  color: 'var(--nw-primary-foreground, var(--nw-background))',
} satisfies React.CSSProperties;

const tableBorderStyle = {
  borderColor: 'var(--nw-border)',
} satisfies React.CSSProperties;

type UsageBucket = { label: string; tokens: number; cost: number };
type ModelUsageRow = { model: string; role: string; calls: number; cost: string };
type TopTokenTaskRow = {
  title: string;
  phase: string;
  tokens: number;
  cost: string;
  sessionId?: string;
};
type CoverageAxis = { labelKey: string; value: number };
type MissionGoalRow = { id: string; title: string; goal: string; active: boolean };
type TaskCandidateRow = {
  id: string;
  title: string;
  goal: string;
  signal: string;
  evaluationContribution: string;
  tokenSize: string;
  importance: number;
  confidence: number;
  complexity: string;
  reason: string;
};
type CoverageFileRow = {
  file: string;
  statements: number;
  branches: number;
  functions: number;
  lines: number;
  uncovered: string;
  summary?: boolean;
};
type E2EResultRow = {
  suite: string;
  status: string;
  tests: string;
  duration: string;
  lastFailure: string;
};

const usageBuckets: UsageBucket[] = [];
const modelUsageRows: ModelUsageRow[] = [];
const topTokenTasks: TopTokenTaskRow[] = [];
const coverageAxes: CoverageAxis[] = [];
const missionGoalRows: MissionGoalRow[] = [];
const taskCandidateRows: TaskCandidateRow[] = [];
const coverageFileRows: CoverageFileRow[] = [];
const e2eCoverageRows: E2EResultRow[] = [];

export function ProjectDetailScreen({
  project,
  sessionViews,
  onOpenSession,
  onEvaluationTasksCreated,
}: ProjectDetailScreenProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ProjectDetailTab>('overview');
  const totalRuns = sessionViews.length;
  const completedCount = sessionViews.filter((view) => view.emailState === 'done').length;
  const maxTokens =
    usageBuckets.length > 0 ? Math.max(...usageBuckets.map((bucket) => bucket.tokens)) : 0;
  const maxCost =
    usageBuckets.length > 0 ? Math.max(...usageBuckets.map((bucket) => bucket.cost)) : 0;

  return (
    <div className="nightworkers-scrollbar h-full min-h-0 overflow-y-auto p-4" style={shellStyle}>
      <div className="mx-auto max-w-7xl space-y-4">
        <nav className="flex flex-wrap gap-1 border-b pb-2 text-xs" style={tableBorderStyle}>
          {projectDetailTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="h-8 border px-3 font-medium"
              style={
                tab.id === activeTab
                  ? {
                      background: 'color-mix(in srgb, var(--nw-primary) 14%, var(--nw-panel))',
                      borderColor: 'var(--nw-primary)',
                      borderRadius: 'var(--nw-control-radius)',
                      color: 'var(--nw-primary)',
                    }
                  : controlStyle
              }
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </nav>

        {activeTab === 'overview' ? (
          <section className="space-y-3">
            <SectionHeading
              icon={<Activity className="h-4 w-4" />}
              title={t('projectDetail.metrics.title')}
            />
            <div className="grid gap-4 xl:grid-cols-[1.45fr_0.75fr]">
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
                  <KpiTile
                    label={t('projectDetail.metrics.runs')}
                    value={totalRuns.toLocaleString()}
                    sub={t('projectDetail.metrics.completed', { count: completedCount })}
                  />
                  <KpiTile
                    label={t('projectDetail.metrics.tokens')}
                    value="—"
                    sub={t('projectDetail.metrics.notConnected')}
                  />
                  <KpiTile
                    label={t('projectDetail.metrics.cost')}
                    value="—"
                    sub={t('projectDetail.metrics.notConnected')}
                  />
                  <KpiTile
                    label={t('projectDetail.metrics.avgTokensPerRun')}
                    value="—"
                    sub={t('projectDetail.metrics.notConnected')}
                  />
                  <KpiTile
                    label={t('projectDetail.metrics.avgCostPerRun')}
                    value="—"
                    sub={t('projectDetail.metrics.notConnected')}
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
                  <div className="border p-4" style={panelStyle}>
                    <SectionLabel
                      icon={<BarChart3 className="h-4 w-4" />}
                      title={t('projectDetail.metrics.sevenDayActivity')}
                    />
                    {usageBuckets.length > 0 ? (
                      <div className="mt-4 flex h-44 items-end gap-2">
                        {usageBuckets.map((bucket) => (
                          <div
                            key={bucket.label}
                            className="flex min-w-0 flex-1 flex-col items-center gap-1"
                          >
                            <div className="flex h-36 w-full items-end gap-1">
                              <div
                                className="w-1/2 rounded-t"
                                style={{
                                  background: 'var(--nw-primary)',
                                  height: `${Math.max(8, (bucket.tokens / maxTokens) * 136)}px`,
                                }}
                                title={`${bucket.tokens.toLocaleString()} tokens`}
                              />
                              <div
                                className="w-1/2 rounded-t"
                                style={{
                                  background:
                                    'color-mix(in srgb, var(--nw-warning) 78%, var(--nw-panel))',
                                  height: `${Math.max(8, (bucket.cost / maxCost) * 136)}px`,
                                }}
                                title={`$${bucket.cost.toFixed(2)}`}
                              />
                            </div>
                            <span className="truncate text-[10px]" style={subtleTextStyle}>
                              {bucket.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyBlock message={t('projectDetail.empty.activity')} />
                    )}
                  </div>

                  <div className="border p-4" style={panelStyle}>
                    <SectionLabel
                      icon={<CircleDollarSign className="h-4 w-4" />}
                      title={t('projectDetail.metrics.modelMix')}
                    />
                    <div className="mt-3 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead style={subtleTextStyle}>
                          <tr>
                            <th className="py-2 text-left">{t('projectDetail.field.model')}</th>
                            <th className="py-2 text-right">{t('projectDetail.field.calls')}</th>
                            <th className="py-2 text-right">{t('projectDetail.field.cost')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {modelUsageRows.length > 0 ? (
                            modelUsageRows.map((row) => (
                              <tr key={row.model} className="border-t" style={tableBorderStyle}>
                                <td className="max-w-[160px] py-2">
                                  <div className="truncate font-semibold">{row.model}</div>
                                  <div className="truncate text-[10px]" style={subtleTextStyle}>
                                    {row.role}
                                  </div>
                                </td>
                                <td className="py-2 text-right">{row.calls}</td>
                                <td className="py-2 text-right">{row.cost}</td>
                              </tr>
                            ))
                          ) : (
                            <EmptyTableRow
                              colSpan={3}
                              message={t('projectDetail.empty.modelUsage')}
                            />
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              <aside className="space-y-3">
                <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3">
                  <CompactHealthTile
                    icon={<ClipboardCheck className="h-4 w-4" />}
                    label={t('projectDetail.health.evaluation')}
                    value="—"
                    tone="primary"
                    compact
                  />
                  <CompactHealthTile
                    icon={<TestTube2 className="h-4 w-4" />}
                    label={t('projectDetail.health.coverageGate')}
                    value={<CoverageBreakdown axes={coverageAxes} />}
                    tone="warning"
                  />
                </div>
                <div className="border p-4" style={panelStyle}>
                  <SectionLabel
                    icon={<Zap className="h-4 w-4" />}
                    title={t('projectDetail.metrics.topTokenTasks')}
                  />
                  {topTokenTasks.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {topTokenTasks.map((task) => {
                        const content = (
                          <>
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-semibold">
                                {task.title}
                              </span>
                              <span className="block truncate text-[10px]" style={subtleTextStyle}>
                                {task.phase} / {task.cost}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-xs font-semibold">
                                {formatCompactTokens(task.tokens)}
                              </span>
                              <span className="block text-[10px]" style={mutedTextStyle}>
                                tokens
                              </span>
                            </span>
                          </>
                        );
                        const sessionId = task.sessionId;
                        return sessionId ? (
                          <button
                            key={task.title}
                            type="button"
                            onClick={() => onOpenSession(sessionId)}
                            className="flex w-full min-w-0 items-center justify-between gap-3 border-b py-2 text-left last:border-b-0"
                            style={tableBorderStyle}
                          >
                            {content}
                          </button>
                        ) : (
                          <div
                            key={task.title}
                            className="flex min-w-0 items-center justify-between gap-3 border-b py-2 last:border-b-0"
                            style={tableBorderStyle}
                          >
                            {content}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyBlock message={t('projectDetail.empty.topTokenTasks')} />
                  )}
                </div>
              </aside>
            </div>
            <GoalDefinitionsPanel />
          </section>
        ) : null}

        {activeTab === 'mission' ? <MissionGenerateTasksPanel /> : null}

        {activeTab === 'evaluation' ? (
          <section className="min-h-[680px] overflow-hidden border" style={panelStyle}>
            <ProjectEvaluationScreen project={project} onTasksCreated={onEvaluationTasksCreated} />
          </section>
        ) : null}

        {activeTab === 'quality' ? <QualityReportPanel /> : null}
      </div>
    </div>
  );
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border p-3" style={panelStyle}>
      <div className="text-[10px] font-semibold uppercase" style={subtleTextStyle}>
        {label}
      </div>
      <div className="mt-2 truncate text-xl font-bold">{value}</div>
      <div className="mt-1 truncate text-[11px]" style={subtleTextStyle}>
        {sub}
      </div>
    </div>
  );
}

function CompactHealthTile({
  icon,
  label,
  value,
  tone,
  compact = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone: 'primary' | 'warning';
  compact?: boolean;
}) {
  const accent =
    tone === 'warning'
      ? 'color-mix(in srgb, var(--nw-warning) 82%, var(--nw-text))'
      : 'var(--nw-primary)';
  return (
    <div className={`border ${compact ? 'p-2.5' : 'p-4'}`} style={panelStyle}>
      <div
        className={compact ? 'flex h-full min-w-0 flex-col items-center justify-center' : 'min-w-0'}
      >
        <div
          className={
            compact
              ? 'flex flex-col items-center gap-1 text-center text-[10px] font-semibold leading-tight'
              : 'flex items-center gap-2 text-xs font-semibold'
          }
          style={mutedTextStyle}
        >
          <span style={{ color: accent }}>{icon}</span>
          {label}
        </div>
        <div className={compact ? 'mt-1' : 'mt-2'}>
          {typeof value === 'string' ? (
            <span className="text-2xl font-bold" style={{ color: accent }}>
              {value}
            </span>
          ) : (
            value
          )}
        </div>
      </div>
    </div>
  );
}

function CoverageBreakdown({ axes }: { axes: { labelKey: string; value: number }[] }) {
  const { t } = useTranslation();
  if (axes.length === 0) {
    return (
      <span className="text-2xl font-bold" style={{ color: 'var(--nw-muted-text)' }}>
        —
      </span>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      {axes.map((axis) => (
        <div
          key={axis.labelKey}
          className="flex min-w-0 items-baseline justify-between gap-1 text-[10px]"
        >
          <span className="truncate" style={subtleTextStyle}>
            {t(axis.labelKey)}
          </span>
          <span className="font-semibold">{axis.value}%</span>
        </div>
      ))}
    </div>
  );
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="mt-3 flex min-h-28 items-center justify-center border border-dashed px-4 py-6 text-center text-xs">
      <span style={mutedTextStyle}>{message}</span>
    </div>
  );
}

function EmptyTableRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr className="border-t" style={tableBorderStyle}>
      <td colSpan={colSpan} className="px-4 py-6 text-center text-xs" style={mutedTextStyle}>
        {message}
      </td>
    </tr>
  );
}

function GoalDefinitionsPanel() {
  const { t } = useTranslation();
  return (
    <section className="space-y-3">
      <SectionHeading
        icon={<Target className="h-4 w-4" />}
        title={t('projectDetail.goals.title')}
      />
      <div className="overflow-hidden border" style={panelStyle}>
        <div
          className="flex items-center justify-between gap-3 border-b p-3"
          style={tableBorderStyle}
        >
          <SectionLabel
            icon={<Target className="h-4 w-4" />}
            title={t('projectDetail.goals.section')}
          />
          <Button
            type="button"
            className="h-8 px-3 text-xs font-semibold"
            style={primaryButtonStyle}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('projectDetail.goals.add')}
          </Button>
        </div>
        <div className="nightworkers-scrollbar overflow-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead style={subtleTextStyle}>
              <tr>
                <th className="py-2 pl-4 text-left">{t('projectDetail.field.missionGoal')}</th>
                <th className="py-2 text-left">{t('projectDetail.field.goalDefinition')}</th>
                <th className="py-2 pr-4 text-right">{t('projectDetail.field.active')}</th>
              </tr>
            </thead>
            <tbody>
              {missionGoalRows.length > 0 ? (
                missionGoalRows.map((goal) => (
                  <tr key={goal.id} className="border-t" style={tableBorderStyle}>
                    <td className="max-w-[240px] py-3 pl-4">
                      <div className="truncate font-semibold">{goal.title}</div>
                    </td>
                    <td className="max-w-[560px] py-3">
                      <div className="line-clamp-2">{goal.goal}</div>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <ActiveChip active={goal.active} />
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyTableRow colSpan={3} message={t('projectDetail.empty.goals')} />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function MissionGenerateTasksPanel() {
  const { t } = useTranslation();
  return (
    <section className="space-y-3">
      <SectionHeading
        icon={<Sparkles className="h-4 w-4" />}
        title={t('projectDetail.mission.title')}
      />
      <div className="overflow-hidden border" style={panelStyle}>
        <div
          className="flex items-center justify-between gap-3 border-b p-3"
          style={tableBorderStyle}
        >
          <SectionLabel
            icon={<Zap className="h-4 w-4" />}
            title={t('projectDetail.mission.candidates')}
          />
          <Button
            type="button"
            className="h-8 px-3 text-xs font-semibold"
            style={primaryButtonStyle}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('projectDetail.mission.generate')}
          </Button>
        </div>
        <div className="nightworkers-scrollbar overflow-auto">
          <table className="w-full min-w-[1040px] text-xs">
            <thead style={subtleTextStyle}>
              <tr>
                <th className="py-2 pl-4 text-left">{t('projectDetail.field.candidate')}</th>
                <th className="py-2 text-left">{t('projectDetail.field.goalSignal')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.evalContribution')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.tokenSize')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.importance')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.confidence')}</th>
                <th className="py-2 pr-4 text-right">{t('projectDetail.field.complexity')}</th>
              </tr>
            </thead>
            <tbody>
              {taskCandidateRows.length > 0 ? (
                taskCandidateRows.map((candidate) => (
                  <tr key={candidate.id} className="border-t" style={tableBorderStyle}>
                    <td className="max-w-[270px] py-3 pl-4">
                      <div className="truncate font-semibold">{candidate.title}</div>
                      <div className="mt-0.5 line-clamp-2 text-[10px]" style={subtleTextStyle}>
                        {candidate.reason}
                      </div>
                    </td>
                    <td className="max-w-[260px] py-3">
                      <div className="truncate">{candidate.goal}</div>
                      <div className="mt-0.5 line-clamp-2 text-[10px]" style={subtleTextStyle}>
                        {candidate.signal}
                      </div>
                    </td>
                    <td className="py-3 text-right">
                      <span className="font-semibold" style={primaryTextStyle}>
                        {candidate.evaluationContribution}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <SizeChip value={candidate.tokenSize} />
                    </td>
                    <td className="py-3 text-right">{candidate.importance}%</td>
                    <td className="py-3 text-right">{candidate.confidence}%</td>
                    <td className="py-3 pr-4 text-right">
                      <ComplexityChip value={candidate.complexity} />
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyTableRow colSpan={7} message={t('projectDetail.empty.taskCandidates')} />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function QualityReportPanel() {
  const { t } = useTranslation();
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeading
          icon={<TestTube2 className="h-4 w-4" />}
          title={t('projectDetail.quality.title')}
        />
        <div className="flex flex-wrap gap-2">
          {[
            t('projectDetail.quality.runUnit'),
            t('projectDetail.quality.runE2E'),
            t('projectDetail.quality.runAll'),
          ].map((label, index) => (
            <Button
              key={label}
              type="button"
              className="h-8 px-3 text-xs font-semibold"
              style={index === 2 ? primaryButtonStyle : controlStyle}
            >
              <Play className="h-3.5 w-3.5" />
              {label}
            </Button>
          ))}
        </div>
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
              {coverageFileRows.length > 0 ? (
                coverageFileRows.map((row) => (
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
              {e2eCoverageRows.length > 0 ? (
                e2eCoverageRows.map((row) => (
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

function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-base font-bold">
          <span style={primaryTextStyle}>{icon}</span>
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-xs" style={mutedTextStyle}>
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SectionLabel({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-bold">
      <span style={primaryTextStyle}>{icon}</span>
      {title}
    </h3>
  );
}

function JestStatusLabel({ status }: { status: string }) {
  const failed = status === 'FAIL' || status === 'failed';
  const tone = failed ? 'var(--nw-danger)' : 'var(--nw-success)';
  return (
    <span
      className="inline-flex h-6 items-center border px-2 font-mono text-[11px] font-bold"
      style={{
        background: `color-mix(in srgb, ${tone} 12%, var(--nw-panel))`,
        borderColor: `color-mix(in srgb, ${tone} 42%, var(--nw-border))`,
        borderRadius: 'var(--nw-control-radius)',
        color: tone,
      }}
    >
      {failed ? 'FAIL' : 'PASS'}
    </span>
  );
}

function CoverageCell({ value }: { value: number }) {
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

const tokenSizeLabelKeys: Record<string, string> = {
  huge: 'projectDetail.tokenSize.huge',
  big: 'projectDetail.tokenSize.big',
  medium: 'projectDetail.tokenSize.medium',
  small: 'projectDetail.tokenSize.small',
  tiny: 'projectDetail.tokenSize.tiny',
};

const complexityLabelKeys: Record<string, string> = {
  'very complex': 'projectDetail.complexity.veryComplex',
  complex: 'projectDetail.complexity.complex',
  moderate: 'projectDetail.complexity.moderate',
  simple: 'projectDetail.complexity.simple',
  trivial: 'projectDetail.complexity.trivial',
};

function SizeChip({ value }: { value: string }) {
  const { t } = useTranslation();
  const labelKey = tokenSizeLabelKeys[value];
  const tone =
    value === 'huge' || value === 'big'
      ? 'var(--nw-warning)'
      : value === 'medium'
        ? 'var(--nw-warning)'
        : value === 'small' || value === 'tiny'
          ? 'var(--nw-success)'
          : 'var(--nw-muted-text)';
  return (
    <span
      className="inline-flex h-6 items-center border px-2 text-[11px] font-semibold"
      style={{
        background: `color-mix(in srgb, ${tone} 12%, var(--nw-panel))`,
        borderColor: `color-mix(in srgb, ${tone} 42%, var(--nw-border))`,
        borderRadius: 'var(--nw-control-radius)',
        color: tone,
      }}
    >
      {labelKey ? t(labelKey) : value}
    </span>
  );
}

function ComplexityChip({ value }: { value: string }) {
  const { t } = useTranslation();
  const labelKey = complexityLabelKeys[value];
  const tone =
    value === 'very complex' || value === 'complex'
      ? 'var(--nw-warning)'
      : value === 'moderate'
        ? 'var(--nw-primary)'
        : value === 'simple' || value === 'trivial'
          ? 'var(--nw-success)'
          : 'var(--nw-muted-text)';
  return (
    <span
      className="inline-flex h-6 items-center border px-2 text-[11px] font-semibold"
      style={{
        background: `color-mix(in srgb, ${tone} 12%, var(--nw-panel))`,
        borderColor: `color-mix(in srgb, ${tone} 42%, var(--nw-border))`,
        borderRadius: 'var(--nw-control-radius)',
        color: tone,
      }}
    >
      {labelKey ? t(labelKey) : value}
    </span>
  );
}

function ActiveChip({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const tone = active ? 'var(--nw-success)' : 'var(--nw-muted-text)';
  return (
    <span
      className="inline-flex h-6 items-center border px-2 text-[11px] font-semibold"
      style={{
        background: `color-mix(in srgb, ${tone} 12%, var(--nw-panel))`,
        borderColor: `color-mix(in srgb, ${tone} 42%, var(--nw-border))`,
        borderRadius: 'var(--nw-control-radius)',
        color: tone,
      }}
    >
      {active ? t('projectDetail.status.active') : t('projectDetail.status.inactive')}
    </span>
  );
}

function formatCompactTokens(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  return `${Math.round(tokens / 1_000)}K`;
}
