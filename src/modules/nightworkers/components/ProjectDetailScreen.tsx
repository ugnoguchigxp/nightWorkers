import {
  Activity,
  CircleDollarSign,
  ClipboardCheck,
  Pencil,
  Play,
  Sparkles,
  Target,
  TestTube2,
  Trash2,
  Zap,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ProjectEvaluationScreen } from '@/modules/project-evaluation';
import type {
  E2ESummary,
  MissionGoal,
  MissionTaskCandidate,
  ProjectDetailMetrics,
  ProjectQualityOverview,
} from '../../../../shared/schemas/project-detail.schema';
import {
  createMissionGoal,
  createProjectQualityRun,
  createTasksFromMissionCandidates,
  deleteMissionGoal,
  fetchMissionGoals,
  fetchMissionTaskCandidates,
  fetchProjectDetailMetrics,
  fetchProjectQuality,
  generateMissionTaskCandidates,
  updateMissionGoal,
  updateMissionTaskCandidate,
} from '../nightWorkersCommands';
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

type ModelUsageRow = {
  model: string;
  role: string;
  calls: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  cost: string;
};
type TopTokenTaskRow = {
  title: string;
  phase: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  cost: string;
  sessionId?: string;
};
type CoverageAxis = { labelKey: string; value: number };
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

const emptyMetrics: ProjectDetailMetrics = {
  runs: { total: 0, completed: 0, failed: 0 },
  llmUsage: {
    totalTokens: 0,
    promptInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningOutputTokens: 0,
    stateCardTokens: 0,
    callCount: 0,
    totalCost: null,
    averageTokensPerRun: null,
    averageCostPerRun: null,
    modelMix: [],
    topTokenTasks: [],
  },
  health: { latestEvaluationScore: null, coverageAverage: null },
};

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      payload.error &&
      typeof payload.error === 'object' &&
      'message' in payload.error &&
      typeof payload.error.message === 'string'
        ? payload.error.message
        : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export function ProjectDetailScreen({
  project,
  sessionViews,
  onOpenSession,
  onEvaluationTasksCreated,
}: ProjectDetailScreenProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ProjectDetailTab>('overview');
  const [metrics, setMetrics] = useState<ProjectDetailMetrics>(emptyMetrics);
  const [goals, setGoals] = useState<MissionGoal[]>([]);
  const [candidates, setCandidates] = useState<MissionTaskCandidate[]>([]);
  const [quality, setQuality] = useState<ProjectQualityOverview | null>(null);
  const [goalDraft, setGoalDraft] = useState<{
    id?: string;
    title: string;
    goalText: string;
    active: boolean;
  } | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [drawerCandidate, setDrawerCandidate] = useState<MissionTaskCandidate | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');
  const totalRuns = metrics.runs.total || sessionViews.length;
  const completedCount =
    metrics.runs.total > 0
      ? metrics.runs.completed
      : sessionViews.filter((view) => view.emailState === 'done').length;
  const modelUsageRows = useMemo<ModelUsageRow[]>(
    () =>
      metrics.llmUsage.modelMix.map((row) => ({
        model: row.model || row.provider,
        role: row.provider,
        calls: row.calls,
        tokens: row.tokens,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cachedInputTokens: row.cachedInputTokens,
        reasoningOutputTokens: row.reasoningOutputTokens,
        cost: row.cost === null ? '—' : `$${row.cost.toFixed(2)}`,
      })),
    [metrics.llmUsage.modelMix]
  );
  const topTokenTasks = useMemo<TopTokenTaskRow[]>(
    () =>
      metrics.llmUsage.topTokenTasks.map((task) => ({
        title: task.title,
        phase: task.taskId.slice(0, 8),
        tokens: task.tokens,
        inputTokens: task.inputTokens,
        outputTokens: task.outputTokens,
        cachedInputTokens: task.cachedInputTokens,
        reasoningOutputTokens: task.reasoningOutputTokens,
        cost: task.cost === null ? '—' : `$${task.cost.toFixed(2)}`,
        sessionId: task.taskId,
      })),
    [metrics.llmUsage.topTokenTasks]
  );
  const coverageAxes = useMemo<CoverageAxis[]>(
    () =>
      quality?.latestUnitRun?.coverageGate?.metrics.map((metric) => ({
        labelKey: `projectDetail.coverage.${metric.metric}`,
        value: metric.actualPercent,
      })) ?? [],
    [quality?.latestUnitRun?.coverageGate?.metrics]
  );
  const taskCandidateRows = useMemo<TaskCandidateRow[]>(
    () =>
      candidates.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        goal: candidate.goalTitle || '—',
        signal: candidate.evidence[0]
          ? `${candidate.evidence[0].label}: ${candidate.evidence[0].value}`
          : '—',
        evaluationContribution:
          candidate.evaluationContribution === null ? '—' : `+${candidate.evaluationContribution}`,
        tokenSize: candidate.tokenSize,
        importance: candidate.importancePercent,
        confidence: candidate.confidencePercent,
        complexity: candidate.complexity,
        reason: candidate.rationale,
      })),
    [candidates]
  );
  const coverageFileRows = useMemo(
    () => coverageRowsFromSummary(quality?.latestUnitRun?.coverageSummary),
    [quality?.latestUnitRun?.coverageSummary]
  );
  const e2eCoverageRows = useMemo(
    () => e2eRowsFromSummary(quality?.latestE2eRun?.e2eSummary),
    [quality?.latestE2eRun?.e2eSummary]
  );

  const loadProjectDetail = useCallback(async () => {
    const [metricsRes, goalsRes, candidatesRes, qualityRes] = await Promise.all([
      fetchProjectDetailMetrics(project.id),
      fetchMissionGoals(project.id),
      fetchMissionTaskCandidates(project.id),
      fetchProjectQuality(project.id),
    ]);
    setMetrics(await readJsonResponse<ProjectDetailMetrics>(metricsRes));
    setGoals(await readJsonResponse<MissionGoal[]>(goalsRes));
    setCandidates(await readJsonResponse<MissionTaskCandidate[]>(candidatesRes));
    setQuality(await readJsonResponse<ProjectQualityOverview>(qualityRes));
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    setMessage('');
    loadProjectDetail().catch((error) => {
      if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [loadProjectDetail]);

  const runAction = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setBusyAction(label);
      setMessage('');
      try {
        await action();
        await loadProjectDetail();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyAction(null);
      }
    },
    [loadProjectDetail]
  );

  const saveGoalDraft = () =>
    goalDraft
      ? runAction('goal', async () => {
          if (goalDraft.id) {
            await readJsonResponse(
              await updateMissionGoal(project.id, goalDraft.id, {
                title: goalDraft.title,
                goalText: goalDraft.goalText,
                active: goalDraft.active,
              })
            );
          } else {
            await readJsonResponse(await createMissionGoal(project.id, goalDraft));
          }
          setGoalDraft(null);
        })
      : undefined;

  const selectedCandidates = candidates.filter((candidate) =>
    selectedCandidateIds.includes(candidate.id)
  );

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
        {message ? (
          <div
            className="border px-3 py-2 text-xs"
            style={{ ...panelStyle, color: 'var(--nw-danger)' }}
          >
            {message}
          </div>
        ) : null}

        {activeTab === 'overview' ? (
          <section className="space-y-3">
            <SectionHeading
              icon={<Activity className="h-4 w-4" />}
              title={t('projectDetail.metrics.title')}
            />
            <TokenBreakdownBand metrics={metrics} />
            <div className="grid gap-4 xl:grid-cols-[1.45fr_0.75fr]">
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <KpiTile
                    label={t('projectDetail.metrics.runs')}
                    value={totalRuns.toLocaleString()}
                    sub={t('projectDetail.metrics.completed', { count: completedCount })}
                  />
                  <KpiTile
                    label={t('projectDetail.metrics.cost')}
                    value={
                      metrics.llmUsage.totalCost === null
                        ? '—'
                        : `$${metrics.llmUsage.totalCost.toFixed(2)}`
                    }
                    sub={t('projectDetail.metrics.notConnected')}
                  />
                  <KpiTile
                    label={t('projectDetail.metrics.avgTokensPerRun')}
                    value={metrics.llmUsage.averageTokensPerRun?.toLocaleString() ?? '—'}
                    sub="tokens / run"
                  />
                  <KpiTile
                    label={t('projectDetail.metrics.avgCostPerRun')}
                    value="—"
                    sub={t('projectDetail.metrics.notConnected')}
                  />
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
                          <th className="py-2 text-right">{t('projectDetail.field.tokens')}</th>
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
                                  {row.role} · I/O {formatCompactTokens(row.inputTokens)} /{' '}
                                  {formatCompactTokens(row.outputTokens)}
                                </div>
                              </td>
                              <td className="py-2 text-right">{row.calls}</td>
                              <td className="py-2 text-right">{formatCompactTokens(row.tokens)}</td>
                              <td className="py-2 text-right">{row.cost}</td>
                            </tr>
                          ))
                        ) : (
                          <EmptyTableRow
                            colSpan={4}
                            message={t('projectDetail.empty.modelUsage')}
                          />
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <aside className="space-y-3">
                <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3">
                  <CompactHealthTile
                    icon={<ClipboardCheck className="h-4 w-4" />}
                    label={t('projectDetail.health.evaluation')}
                    value={
                      metrics.health.latestEvaluationScore === null
                        ? '—'
                        : String(metrics.health.latestEvaluationScore)
                    }
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
                              <span className="block truncate text-[10px]" style={subtleTextStyle}>
                                I/O {formatCompactTokens(task.inputTokens)} /{' '}
                                {formatCompactTokens(task.outputTokens)}
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
            <GoalDefinitionsPanel
              goals={goals}
              busy={busyAction === 'goal'}
              onAdd={() => setGoalDraft({ title: '', goalText: '', active: true })}
              onEdit={(goal) =>
                setGoalDraft({
                  id: goal.id,
                  title: goal.title,
                  goalText: goal.goalText,
                  active: goal.active,
                })
              }
              onToggle={(goal) =>
                void runAction('goal', async () => {
                  await readJsonResponse(
                    await updateMissionGoal(project.id, goal.id, { active: !goal.active })
                  );
                })
              }
              onDelete={(goal) =>
                void runAction('goal', async () => {
                  await readJsonResponse(await deleteMissionGoal(project.id, goal.id));
                })
              }
            />
          </section>
        ) : null}

        {activeTab === 'mission' ? (
          <MissionGenerateTasksPanel
            rows={taskCandidateRows}
            candidates={candidates}
            selectedIds={selectedCandidateIds}
            busy={busyAction === 'generate' || busyAction === 'create-tasks'}
            onToggleSelected={(candidateId) =>
              setSelectedCandidateIds((current) =>
                current.includes(candidateId)
                  ? current.filter((id) => id !== candidateId)
                  : [...current, candidateId]
              )
            }
            onOpen={(candidate) => setDrawerCandidate(candidate)}
            onGenerate={() =>
              void runAction('generate', async () => {
                await readJsonResponse(await generateMissionTaskCandidates(project.id));
              })
            }
            onCreateTasks={() =>
              void runAction('create-tasks', async () => {
                const response = await createTasksFromMissionCandidates(project.id, {
                  candidateIds: selectedCandidateIds,
                  mode: 'draft',
                });
                const payload = await readJsonResponse<{ tasks: Task[] }>(response);
                onEvaluationTasksCreated?.(payload.tasks);
                setSelectedCandidateIds([]);
              })
            }
            selectedCount={selectedCandidates.length}
          />
        ) : null}

        {activeTab === 'evaluation' ? (
          <section className="min-h-[680px] overflow-hidden border" style={panelStyle}>
            <ProjectEvaluationScreen project={project} onTasksCreated={onEvaluationTasksCreated} />
          </section>
        ) : null}

        {activeTab === 'quality' ? (
          <QualityReportPanel
            quality={quality}
            coverageRows={coverageFileRows}
            e2eRows={e2eCoverageRows}
            busy={busyAction?.startsWith('quality') ?? false}
            onRun={(runType) =>
              void runAction(`quality:${runType}`, async () => {
                await readJsonResponse(await createProjectQualityRun(project.id, { runType }));
              })
            }
          />
        ) : null}
      </div>
      {goalDraft ? (
        <GoalEditorDialog
          draft={goalDraft}
          busy={busyAction === 'goal'}
          onChange={setGoalDraft}
          onClose={() => setGoalDraft(null)}
          onSave={saveGoalDraft}
        />
      ) : null}
      {drawerCandidate ? (
        <CandidateDrawer
          candidate={drawerCandidate}
          onClose={() => setDrawerCandidate(null)}
          onDismiss={(candidate) =>
            void runAction('candidate', async () => {
              await readJsonResponse(
                await updateMissionTaskCandidate(candidate.id, { status: 'dismissed' })
              );
              setDrawerCandidate(null);
            })
          }
        />
      ) : null}
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

function TokenBreakdownBand({ metrics }: { metrics: ProjectDetailMetrics }) {
  const { t } = useTranslation();
  const items = [
    {
      key: 'input',
      label: t('projectDetail.usage.input'),
      value: metrics.llmUsage.inputTokens,
    },
    {
      key: 'output',
      label: t('projectDetail.usage.output'),
      value: metrics.llmUsage.outputTokens,
    },
    {
      key: 'cached',
      label: t('projectDetail.usage.cachedInput'),
      value: metrics.llmUsage.cachedInputTokens,
    },
    {
      key: 'reasoning',
      label: t('projectDetail.usage.reasoningOutput'),
      value: metrics.llmUsage.reasoningOutputTokens,
    },
    {
      key: 'state',
      label: t('projectDetail.usage.stateCard'),
      value: metrics.llmUsage.stateCardTokens,
    },
    {
      key: 'prompt',
      label: t('projectDetail.usage.promptParts'),
      value: metrics.llmUsage.promptInputTokens,
    },
  ];

  return (
    <div
      className="grid gap-2 border p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      style={panelStyle}
    >
      {items.map((item) => (
        <div key={item.key} className="min-w-0">
          <div className="truncate text-[10px] font-semibold uppercase" style={subtleTextStyle}>
            {item.label}
          </div>
          <div className="mt-1 truncate text-sm font-bold">{item.value.toLocaleString()}</div>
        </div>
      ))}
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

function GoalDefinitionsPanel({
  goals,
  busy,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
}: {
  goals: MissionGoal[];
  busy: boolean;
  onAdd: () => void;
  onEdit: (goal: MissionGoal) => void;
  onToggle: (goal: MissionGoal) => void;
  onDelete: (goal: MissionGoal) => void;
}) {
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
            onClick={onAdd}
            disabled={busy}
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
                <th className="py-2 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {goals.length > 0 ? (
                goals.map((goal) => (
                  <tr key={goal.id} className="border-t" style={tableBorderStyle}>
                    <td className="max-w-[240px] py-3 pl-4">
                      <div className="truncate font-semibold">{goal.title}</div>
                    </td>
                    <td className="max-w-[560px] py-3">
                      <div className="line-clamp-2">{goal.goalText}</div>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <button type="button" onClick={() => onToggle(goal)} disabled={busy}>
                        <ActiveChip active={goal.active} />
                      </button>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <div className="flex justify-end gap-1">
                        <IconActionButton label="Edit" onClick={() => onEdit(goal)} disabled={busy}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconActionButton>
                        <IconActionButton
                          label="Delete"
                          onClick={() => onDelete(goal)}
                          disabled={busy}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconActionButton>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyTableRow colSpan={4} message={t('projectDetail.empty.goals')} />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function MissionGenerateTasksPanel({
  rows,
  candidates,
  selectedIds,
  busy,
  selectedCount,
  onToggleSelected,
  onOpen,
  onGenerate,
  onCreateTasks,
}: {
  rows: TaskCandidateRow[];
  candidates: MissionTaskCandidate[];
  selectedIds: string[];
  busy: boolean;
  selectedCount: number;
  onToggleSelected: (candidateId: string) => void;
  onOpen: (candidate: MissionTaskCandidate) => void;
  onGenerate: () => void;
  onCreateTasks: () => void;
}) {
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
            onClick={onGenerate}
            disabled={busy}
            className="h-8 px-3 text-xs font-semibold"
            style={primaryButtonStyle}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('projectDetail.mission.generate')}
          </Button>
        </div>
        <div className="flex justify-end border-b px-3 py-2" style={tableBorderStyle}>
          <Button
            type="button"
            onClick={onCreateTasks}
            disabled={busy || selectedCount === 0}
            className="h-8 px-3 text-xs font-semibold"
            style={controlStyle}
          >
            {`Create Tasks (${selectedCount})`}
          </Button>
        </div>
        <div className="nightworkers-scrollbar overflow-auto">
          <table className="w-full min-w-[1040px] text-xs">
            <thead style={subtleTextStyle}>
              <tr>
                <th className="py-2 pl-4 text-left">Select</th>
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
              {rows.length > 0 ? (
                rows.map((candidate) => {
                  const source = candidates.find((item) => item.id === candidate.id);
                  return (
                    <tr key={candidate.id} className="border-t" style={tableBorderStyle}>
                      <td className="py-3 pl-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(candidate.id)}
                          onChange={() => onToggleSelected(candidate.id)}
                        />
                      </td>
                      <td className="max-w-[270px] py-3 pl-4">
                        <button
                          type="button"
                          className="block max-w-full text-left"
                          onClick={() => {
                            if (source) onOpen(source);
                          }}
                        >
                          <span className="block truncate font-semibold">{candidate.title}</span>
                        </button>
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
                  );
                })
              ) : (
                <EmptyTableRow colSpan={8} message={t('projectDetail.empty.taskCandidates')} />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function QualityReportPanel({
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

function IconActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center border"
      style={controlStyle}
    >
      {children}
    </button>
  );
}

function GoalEditorDialog({
  draft,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  draft: { id?: string; title: string; goalText: string; active: boolean };
  busy: boolean;
  onChange: (draft: { id?: string; title: string; goalText: string; active: boolean }) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-xl border p-4"
        style={panelStyle}
      >
        <div className="text-sm font-bold">{draft.id ? 'Edit Goal' : 'Add Goal'}</div>
        <div className="mt-3 space-y-3">
          <label className="block text-xs font-semibold">
            Title
            <input
              value={draft.title}
              onChange={(event) => onChange({ ...draft, title: event.target.value })}
              className="mt-1 h-9 w-full border px-2"
              style={controlStyle}
            />
          </label>
          <label className="block text-xs font-semibold">
            Goal definition
            <textarea
              value={draft.goalText}
              onChange={(event) => onChange({ ...draft, goalText: event.target.value })}
              className="mt-1 min-h-32 w-full border px-2 py-2"
              style={controlStyle}
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(event) => onChange({ ...draft, active: event.target.checked })}
            />
            Active
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" onClick={onClose} disabled={busy} style={controlStyle}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSave}
            disabled={busy || !draft.title.trim() || !draft.goalText.trim()}
            style={primaryButtonStyle}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function CandidateDrawer({
  candidate,
  onClose,
  onDismiss,
}: {
  candidate: MissionTaskCandidate;
  onClose: () => void;
  onDismiss: (candidate: MissionTaskCandidate) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <aside
        className="nightworkers-scrollbar h-full w-full max-w-xl overflow-y-auto border-l p-4"
        style={panelStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-bold">{candidate.title}</div>
            <div className="mt-1 text-xs" style={mutedTextStyle}>
              {candidate.goalTitle || candidate.goalId || 'No linked goal'}
            </div>
          </div>
          <Button type="button" onClick={onClose} style={controlStyle}>
            Close
          </Button>
        </div>
        <DrawerSection title="Summary" body={candidate.summary} />
        <DrawerSection title="Rationale" body={candidate.rationale} />
        <DrawerSection title="Task prompt" body={candidate.taskPrompt} />
        <DrawerSection title="Acceptance criteria" body={candidate.acceptanceCriteria} />
        <DrawerSection title="Verification plan" body={candidate.verificationPlan} />
        <div className="mt-4">
          <div className="text-xs font-bold">Evidence</div>
          <div className="mt-2 space-y-2">
            {candidate.evidence.map((item, index) => (
              <div
                key={`${item.source}-${index}`}
                className="border p-2 text-xs"
                style={controlStyle}
              >
                <div className="font-semibold">{item.label}</div>
                <div className="mt-1" style={mutedTextStyle}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <KpiTile label="Importance" value={`${candidate.importancePercent}%`} sub="mission" />
          <KpiTile label="Confidence" value={`${candidate.confidencePercent}%`} sub="generation" />
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={() => onDismiss(candidate)} style={controlStyle}>
            Dismiss
          </Button>
        </div>
      </aside>
    </div>
  );
}

function DrawerSection({ title, body }: { title: string; body: string }) {
  return (
    <section className="mt-4">
      <div className="text-xs font-bold">{title}</div>
      <p className="mt-1 whitespace-pre-wrap text-xs" style={mutedTextStyle}>
        {body}
      </p>
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
  very_complex: 'projectDetail.complexity.veryComplex',
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
    value === 'very_complex' || value === 'complex'
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

function percentFromCoverageEntry(entry: unknown, metric: string) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 0;
  const metricValue = (entry as Record<string, unknown>)[metric];
  if (!metricValue || typeof metricValue !== 'object' || Array.isArray(metricValue)) return 0;
  const pct = (metricValue as Record<string, unknown>).pct;
  return typeof pct === 'number' && Number.isFinite(pct) ? pct : 0;
}

function uncoveredFromCoverageEntry(entry: unknown) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '—';
  const value = (entry as Record<string, unknown>).uncoveredLines;
  return Array.isArray(value) && value.length > 0 ? value.join(', ') : '—';
}

function coverageRowsFromSummary(summary: unknown): CoverageFileRow[] {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return [];
  const record = summary as Record<string, unknown>;
  return Object.entries(record)
    .filter(([file]) => file === 'total')
    .map(([file, entry]) => ({
      file,
      statements: percentFromCoverageEntry(entry, 'statements'),
      branches: percentFromCoverageEntry(entry, 'branches'),
      functions: percentFromCoverageEntry(entry, 'functions'),
      lines: percentFromCoverageEntry(entry, 'lines'),
      uncovered: uncoveredFromCoverageEntry(entry),
      summary: file === 'total',
    }));
}

function e2eRowsFromSummary(summary: E2ESummary | null | undefined): E2EResultRow[] {
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
