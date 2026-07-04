import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Code2,
  Layers3,
  Loader2,
  Pencil,
  Play,
  Sparkles,
  Target,
  TestTube2,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ProjectEvaluationScreen } from '@/modules/project-evaluation';
import {
  getMissionGoalTemplatesForStack,
  type MissionGoalTemplate,
  missionGoalTemplates,
} from '../../../../shared/mission-goal-templates';
import type {
  Mission,
  MissionTaskProposal,
} from '../../../../shared/schemas/mission-planner.schema';
import type {
  E2ESummary,
  MissionGoal,
  MissionTaskCandidate,
  ProjectDetailMetrics,
  ProjectQualityOverview,
  ProjectQualityRun,
  ProjectStackProfile,
} from '../../../../shared/schemas/project-detail.schema';
import {
  createMissionGoal,
  createProjectQualityRun,
  createTasksFromMissionCandidates,
  createTasksFromMissionTaskProposals,
  decomposeMission,
  deleteMission,
  deleteMissionGoal,
  dismissMissionTaskProposal,
  fetchMissionGoals,
  fetchMissions,
  fetchMissionTaskCandidates,
  fetchProjectDetailMetrics,
  fetchProjectQuality,
  fetchRepositoryMissionTaskProposals,
  generateMissionCandidatesFromGoals,
  generateMissionTaskCandidates,
  updateMissionGoal,
  updateMissionTaskCandidate,
} from '../nightWorkersCommands';
import {
  type CoverageDisplayValue,
  type CoverageFileRow,
  coverageRowsFromSummary,
} from '../qualityRows';
import type { Repository, Task, WorkbenchSessionView } from '../types';

type ProjectDetailScreenProps = {
  project: Repository;
  sessionViews: WorkbenchSessionView[];
  onOpenSession: (sessionId: string) => void;
  onEvaluationTasksCreated?: (tasks: Task[]) => Promise<void> | void;
};

type ProjectDetailTab = 'overview' | 'mission' | 'evaluation' | 'quality' | 'stack';

const projectDetailTabs = [
  { id: 'overview', labelKey: 'projectDetail.tab.overview' },
  { id: 'mission', labelKey: 'projectDetail.tab.mission' },
  { id: 'evaluation', labelKey: 'projectDetail.tab.evaluation' },
  { id: 'quality', labelKey: 'projectDetail.tab.quality' },
  { id: 'stack', labelKey: 'projectDetail.tab.stack' },
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
const coverageAxisMetrics = ['statements', 'branches', 'functions', 'lines'] as const;
type CandidateRowSource = 'mission_task_candidate' | 'mission_task_proposal';
type TaskCandidateOrigin = 'goal_generation' | 'mission_decomposition';
type TaskCandidateSourceRef =
  | { source: 'mission_task_candidate'; id: string }
  | { source: 'mission_task_proposal'; id: string };
type UnifiedTaskCandidateStatus = 'candidate' | 'task_created' | 'dismissed';
type UnifiedTaskCandidate = {
  id: string;
  repositoryId: string;
  goalId: string | null;
  goalTitle: string | null;
  missionId: string | null;
  origin: TaskCandidateOrigin;
  sourceRef: TaskCandidateSourceRef;
  title: string;
  summary: string;
  rationale: string;
  evidence: Array<{ source: string; label: string; value: string }>;
  evaluationContribution: number | null;
  importancePercent: number | null;
  confidencePercent: number | null;
  tokenSize: string | null;
  complexity: string | null;
  taskPrompt: string;
  acceptanceCriteria: string;
  verificationPlan: string;
  status: UnifiedTaskCandidateStatus;
  taskId: string | null;
  createdAt: string | Date;
};
type TaskGenerationTreeRow =
  | {
      kind: 'goal';
      id: string;
      depth: 0;
      goal: MissionGoal | null;
      childCounts: { missions: number; taskCandidates: number };
    }
  | {
      kind: 'mission';
      id: string;
      depth: 1;
      parentGoalId: string;
      mission: Mission;
      childCounts: { taskCandidates: number };
    }
  | {
      kind: 'task_candidate';
      id: string;
      depth: 1 | 2;
      parentGoalId: string | null;
      parentMissionId: string | null;
      candidate: UnifiedTaskCandidate;
    };
type ExpandedState = {
  goalIds: Set<string>;
  missionIds: Set<string>;
};
type DetailModalState =
  | { kind: 'goal'; id: string }
  | { kind: 'mission'; id: string }
  | { kind: 'task_candidate'; id: string }
  | null;
type E2EResultRow = {
  suite: string;
  status: string;
  tests: string;
  duration: string;
  lastFailure: string;
};
type GoalDraft = { id?: string; title: string; goalText: string; active: boolean };

function candidateRowId(source: CandidateRowSource, id: string) {
  return `${source}:${id}`;
}

const unassignedGoalId = '__unassigned__';

function normalizeCandidateStatus(
  status: MissionTaskCandidate['status']
): UnifiedTaskCandidateStatus {
  if (status === 'task_created' || status === 'dismissed') return status;
  return 'candidate';
}

function normalizeProposalStatus(
  status: MissionTaskProposal['status']
): UnifiedTaskCandidateStatus {
  if (status === 'task_created' || status === 'dismissed') return status;
  return 'candidate';
}

function toTimestamp(value: string | Date) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareNewestFirst(a: { createdAt: string | Date }, b: { createdAt: string | Date }) {
  return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
}

function isMissionDeleteInProgress(status: Mission['status']) {
  return status === 'decomposing' || status === 'evaluating';
}

export function buildUnifiedTaskCandidates(
  candidates: MissionTaskCandidate[],
  proposals: MissionTaskProposal[]
): UnifiedTaskCandidate[] {
  return [
    ...candidates.map(
      (candidate): UnifiedTaskCandidate => ({
        id: candidateRowId('mission_task_candidate', candidate.id),
        repositoryId: candidate.repositoryId,
        goalId: candidate.goalId,
        goalTitle: candidate.goalTitle ?? null,
        missionId: null,
        origin: 'goal_generation',
        sourceRef: { source: 'mission_task_candidate', id: candidate.id },
        title: candidate.title,
        summary: candidate.summary,
        rationale: candidate.rationale,
        evidence: candidate.evidence,
        evaluationContribution: candidate.evaluationContribution,
        importancePercent: candidate.importancePercent,
        confidencePercent: candidate.confidencePercent,
        tokenSize: candidate.tokenSize,
        complexity: candidate.complexity,
        taskPrompt: candidate.taskPrompt,
        acceptanceCriteria: candidate.acceptanceCriteria,
        verificationPlan: candidate.verificationPlan,
        status: normalizeCandidateStatus(candidate.status),
        taskId: candidate.taskId,
        createdAt: candidate.createdAt,
      })
    ),
    ...proposals.map(
      (proposal): UnifiedTaskCandidate => ({
        id: candidateRowId('mission_task_proposal', proposal.id),
        repositoryId: proposal.repositoryId,
        goalId: null,
        goalTitle: null,
        missionId: proposal.missionId,
        origin: 'mission_decomposition',
        sourceRef: { source: 'mission_task_proposal', id: proposal.id },
        title: proposal.title,
        summary: proposal.summary,
        rationale: proposal.expectedOutcome,
        evidence: proposal.targetFilesOrModules.map((path) => ({
          source: 'mission_decomposition',
          label: 'Target',
          value: path,
        })),
        evaluationContribution: null,
        importancePercent: null,
        confidencePercent: null,
        tokenSize: null,
        complexity: null,
        taskPrompt: proposal.initialPrompt,
        acceptanceCriteria: proposal.acceptanceCriteria.join('\n'),
        verificationPlan: proposal.verificationGate.join('\n'),
        status: normalizeProposalStatus(proposal.status),
        taskId: proposal.taskId,
        createdAt: proposal.createdAt,
      })
    ),
  ];
}

function pushToMap<T>(map: Map<string, T[]>, key: string, value: T) {
  map.set(key, [...(map.get(key) ?? []), value]);
}

export function buildTaskGenerationTreeRows({
  goals,
  missions,
  candidates,
  expanded,
}: {
  goals: MissionGoal[];
  missions: Mission[];
  candidates: UnifiedTaskCandidate[];
  expanded: ExpandedState;
}): TaskGenerationTreeRow[] {
  const rows: TaskGenerationTreeRow[] = [];
  const missionsByGoal = new Map<string, Mission[]>();
  const candidatesByGoal = new Map<string, UnifiedTaskCandidate[]>();
  const candidatesByMission = new Map<string, UnifiedTaskCandidate[]>();

  for (const mission of missions) {
    pushToMap(missionsByGoal, mission.sourceGoalIds[0] ?? unassignedGoalId, mission);
  }
  for (const candidate of candidates) {
    if (candidate.missionId) {
      pushToMap(candidatesByMission, candidate.missionId, candidate);
    } else {
      pushToMap(candidatesByGoal, candidate.goalId ?? unassignedGoalId, candidate);
    }
  }

  const sortedGoals = [...goals].sort(
    (a, b) => a.sortOrder - b.sortOrder || toTimestamp(a.createdAt) - toTimestamp(b.createdAt)
  );

  const pushGoalGroup = (goal: MissionGoal | null) => {
    const goalId = goal?.id ?? unassignedGoalId;
    const goalMissions = [...(missionsByGoal.get(goalId) ?? [])].sort(compareNewestFirst);
    const goalCandidates = [...(candidatesByGoal.get(goalId) ?? [])].sort(compareNewestFirst);
    rows.push({
      kind: 'goal',
      id: goalId,
      depth: 0,
      goal,
      childCounts: { missions: goalMissions.length, taskCandidates: goalCandidates.length },
    });
    if (!expanded.goalIds.has(goalId)) return;
    for (const mission of goalMissions) {
      const missionCandidates = [...(candidatesByMission.get(mission.id) ?? [])].sort(
        compareNewestFirst
      );
      rows.push({
        kind: 'mission',
        id: mission.id,
        depth: 1,
        parentGoalId: goalId,
        mission,
        childCounts: { taskCandidates: missionCandidates.length },
      });
      if (expanded.missionIds.has(mission.id)) {
        rows.push(
          ...missionCandidates.map(
            (candidate): TaskGenerationTreeRow => ({
              kind: 'task_candidate',
              id: candidate.id,
              depth: 2,
              parentGoalId: goalId,
              parentMissionId: mission.id,
              candidate,
            })
          )
        );
      }
    }
    rows.push(
      ...goalCandidates.map(
        (candidate): TaskGenerationTreeRow => ({
          kind: 'task_candidate',
          id: candidate.id,
          depth: 1,
          parentGoalId: goalId === unassignedGoalId ? null : goalId,
          parentMissionId: null,
          candidate,
        })
      )
    );
  };

  for (const goal of sortedGoals) pushGoalGroup(goal);
  if (
    (missionsByGoal.get(unassignedGoalId)?.length ?? 0) > 0 ||
    (candidatesByGoal.get(unassignedGoalId)?.length ?? 0) > 0
  ) {
    pushGoalGroup(null);
  }
  return rows;
}

export function applyMissionGoalTemplate(
  draft: GoalDraft,
  template: MissionGoalTemplate
): GoalDraft {
  const titleMatchesTemplate = missionGoalTemplates.some((item) => item.title === draft.title);
  return {
    ...draft,
    title: draft.title.trim() && !titleMatchesTemplate ? draft.title : template.title,
    goalText: template.goalText,
  };
}

export function toggleMissionGoalTemplate(
  draft: GoalDraft,
  template: MissionGoalTemplate
): GoalDraft {
  if (draft.goalText !== template.goalText) return applyMissionGoalTemplate(draft, template);
  return {
    ...draft,
    title: draft.title === template.title ? '' : draft.title,
    goalText: '',
  };
}

const emptyMetrics: ProjectDetailMetrics = {
  stackProfile: {
    summary: '',
    manifestStatus: 'missing',
    manifestPath: '',
    packageManager: null,
    technologies: [],
  },
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
  const [missions, setMissions] = useState<Mission[]>([]);
  const [candidates, setCandidates] = useState<MissionTaskCandidate[]>([]);
  const [proposalCandidates, setProposalCandidates] = useState<MissionTaskProposal[]>([]);
  const [quality, setQuality] = useState<ProjectQualityOverview | null>(null);
  const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [expandedRows, setExpandedRows] = useState<ExpandedState>({
    goalIds: new Set(),
    missionIds: new Set(),
  });
  const [detailModal, setDetailModal] = useState<DetailModalState>(null);
  const [hasInitializedExpansion, setHasInitializedExpansion] = useState(false);
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
    () => coverageAxesFromQualityRun(quality?.latestCoverageRun),
    [quality?.latestCoverageRun]
  );
  const unifiedTaskCandidates = useMemo(
    () => buildUnifiedTaskCandidates(candidates, proposalCandidates),
    [candidates, proposalCandidates]
  );
  const treeRows = useMemo(
    () =>
      buildTaskGenerationTreeRows({
        goals,
        missions,
        candidates: unifiedTaskCandidates,
        expanded: expandedRows,
      }),
    [expandedRows, goals, missions, unifiedTaskCandidates]
  );
  const selectedCandidates = useMemo(
    () =>
      selectedCandidateIds
        .map((id) => unifiedTaskCandidates.find((candidate) => candidate.id === id))
        .filter(
          (candidate): candidate is UnifiedTaskCandidate => candidate?.status === 'candidate'
        ),
    [selectedCandidateIds, unifiedTaskCandidates]
  );
  const coverageFileRows = useMemo(
    () => coverageRowsFromSummary(quality?.latestCoverageRun?.coverageSummary, project.localPath),
    [project.localPath, quality?.latestCoverageRun?.coverageSummary]
  );
  const e2eCoverageRows = useMemo(
    () => e2eRowsFromSummary(quality?.latestE2eResultRun?.e2eSummary),
    [quality?.latestE2eResultRun?.e2eSummary]
  );

  const loadProjectDetail = useCallback(async () => {
    const [metricsRes, goalsRes, missionsRes, candidatesRes, proposalsRes, qualityRes] =
      await Promise.all([
        fetchProjectDetailMetrics(project.id),
        fetchMissionGoals(project.id),
        fetchMissions(project.id),
        fetchMissionTaskCandidates(project.id),
        fetchRepositoryMissionTaskProposals(project.id),
        fetchProjectQuality(project.id),
      ]);
    setMetrics(await readJsonResponse<ProjectDetailMetrics>(metricsRes));
    setGoals(await readJsonResponse<MissionGoal[]>(goalsRes));
    setMissions(await readJsonResponse<Mission[]>(missionsRes));
    setCandidates(await readJsonResponse<MissionTaskCandidate[]>(candidatesRes));
    setProposalCandidates(await readJsonResponse<MissionTaskProposal[]>(proposalsRes));
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

  useEffect(() => {
    const goalIds = new Set(goals.map((goal) => goal.id));
    const missionIds = new Set(missions.map((mission) => mission.id));
    setExpandedRows((current) => ({
      goalIds: new Set(
        [...current.goalIds].filter((id) => id === unassignedGoalId || goalIds.has(id))
      ),
      missionIds: new Set([...current.missionIds].filter((id) => missionIds.has(id))),
    }));
    setSelectedCandidateIds((current) =>
      current.filter((id) => unifiedTaskCandidates.some((candidate) => candidate.id === id))
    );
  }, [goals, missions, unifiedTaskCandidates]);

  useEffect(() => {
    if (hasInitializedExpansion) return;
    if (goals.length === 0 && missions.length === 0 && unifiedTaskCandidates.length === 0) return;
    const goalIdsWithChildren = new Set<string>();
    for (const goal of goals) {
      const hasChildren =
        missions.some((mission) => mission.sourceGoalIds[0] === goal.id) ||
        unifiedTaskCandidates.some(
          (candidate) => !candidate.missionId && candidate.goalId === goal.id
        );
      if (goal.active && hasChildren) goalIdsWithChildren.add(goal.id);
    }
    const hasUnassigned =
      missions.some((mission) => mission.sourceGoalIds.length === 0) ||
      unifiedTaskCandidates.some((candidate) => !candidate.missionId && !candidate.goalId);
    if (hasUnassigned) goalIdsWithChildren.add(unassignedGoalId);
    setExpandedRows((current) => ({
      ...current,
      goalIds: goalIdsWithChildren.size > 0 ? goalIdsWithChildren : current.goalIds,
    }));
    setHasInitializedExpansion(true);
  }, [goals, hasInitializedExpansion, missions, unifiedTaskCandidates]);

  useEffect(() => {
    if (!detailModal) return;
    if (detailModal.kind === 'goal' && !goals.some((goal) => goal.id === detailModal.id)) {
      setDetailModal(null);
    }
    if (
      detailModal.kind === 'mission' &&
      !missions.some((mission) => mission.id === detailModal.id)
    ) {
      setDetailModal(null);
    }
    if (
      detailModal.kind === 'task_candidate' &&
      !unifiedTaskCandidates.some((candidate) => candidate.id === detailModal.id)
    ) {
      setDetailModal(null);
    }
  }, [detailModal, goals, missions, unifiedTaskCandidates]);

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
      ? runAction('goal:save', async () => {
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

  const createTasksFromUnifiedCandidates = useCallback(
    async (selected: UnifiedTaskCandidate[]) => {
      const createdTasks: Task[] = [];
      const selectedMissionTaskCandidateIds = selected
        .filter((candidate) => candidate.sourceRef.source === 'mission_task_candidate')
        .map((candidate) => candidate.sourceRef.id);
      const selectedMissionTaskProposalIds = selected
        .filter((candidate) => candidate.sourceRef.source === 'mission_task_proposal')
        .map((candidate) => candidate.sourceRef.id);

      if (selectedMissionTaskCandidateIds.length > 0) {
        const response = await createTasksFromMissionCandidates(project.id, {
          candidateIds: selectedMissionTaskCandidateIds,
          mode: 'draft',
        });
        const payload = await readJsonResponse<{ tasks: Task[] }>(response);
        createdTasks.push(...payload.tasks);
      }
      if (selectedMissionTaskProposalIds.length > 0) {
        const response = await createTasksFromMissionTaskProposals({
          proposalIds: selectedMissionTaskProposalIds,
          mode: 'draft',
        });
        const payload = await readJsonResponse<{ tasks: Task[] }>(response);
        createdTasks.push(...payload.tasks);
      }
      if (createdTasks.length > 0) await onEvaluationTasksCreated?.(createdTasks);
    },
    [onEvaluationTasksCreated, project.id]
  );

  const dismissUnifiedCandidate = (candidate: UnifiedTaskCandidate) =>
    runAction(`candidate:dismiss:${candidate.id}`, async () => {
      if (candidate.sourceRef.source === 'mission_task_candidate') {
        await readJsonResponse(
          await updateMissionTaskCandidate(candidate.sourceRef.id, { status: 'dismissed' })
        );
      } else {
        await readJsonResponse(await dismissMissionTaskProposal(candidate.sourceRef.id));
      }
      setSelectedCandidateIds((current) => current.filter((id) => id !== candidate.id));
      if (detailModal?.kind === 'task_candidate' && detailModal.id === candidate.id) {
        setDetailModal(null);
      }
    });

  const toggleExpandedGoal = (goalId: string) =>
    setExpandedRows((current) => {
      const goalIds = new Set(current.goalIds);
      if (goalIds.has(goalId)) goalIds.delete(goalId);
      else goalIds.add(goalId);
      return { ...current, goalIds };
    });

  const toggleExpandedMission = (missionId: string) =>
    setExpandedRows((current) => {
      const missionIds = new Set(current.missionIds);
      if (missionIds.has(missionId)) missionIds.delete(missionId);
      else missionIds.add(missionId);
      return { ...current, missionIds };
    });

  const detailGoal =
    detailModal?.kind === 'goal' ? goals.find((goal) => goal.id === detailModal.id) : null;
  const detailMission =
    detailModal?.kind === 'mission'
      ? missions.find((mission) => mission.id === detailModal.id)
      : null;
  const detailCandidate =
    detailModal?.kind === 'task_candidate'
      ? unifiedTaskCandidates.find((candidate) => candidate.id === detailModal.id)
      : null;

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
              aside={<StackSummaryBadge stackProfile={metrics.stackProfile} />}
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
                    value={
                      metrics.llmUsage.averageCostPerRun === null
                        ? '—'
                        : `$${metrics.llmUsage.averageCostPerRun.toFixed(2)}`
                    }
                    sub="cost / run"
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
          </section>
        ) : null}

        {activeTab === 'mission' ? (
          <section className="space-y-4">
            <TaskGenerationTreeTable
              rows={treeRows}
              expanded={expandedRows}
              selectedIds={selectedCandidateIds}
              busy={Boolean(busyAction)}
              busyAction={busyAction}
              selectedCount={selectedCandidates.length}
              onAddGoal={() => setGoalDraft({ title: '', goalText: '', active: true })}
              onCreateSelected={() =>
                void runAction('candidate:create-tasks', async () => {
                  await createTasksFromUnifiedCandidates(selectedCandidates);
                  setSelectedCandidateIds([]);
                })
              }
              onGenerateTaskCandidates={() =>
                void runAction('goal:generate-task-candidates', async () => {
                  await readJsonResponse(await generateMissionTaskCandidates(project.id));
                })
              }
              onGenerateMissionCandidates={() =>
                void runAction('goal:generate-mission-candidates', async () => {
                  await readJsonResponse(await generateMissionCandidatesFromGoals(project.id));
                })
              }
              onToggleGoal={toggleExpandedGoal}
              onToggleMission={toggleExpandedMission}
              onToggleSelected={(candidateId) =>
                setSelectedCandidateIds((current) =>
                  current.includes(candidateId)
                    ? current.filter((id) => id !== candidateId)
                    : [...current, candidateId]
                )
              }
              onOpenGoal={(goal) => {
                if (goal) setDetailModal({ kind: 'goal', id: goal.id });
              }}
              onOpenMission={(mission) => setDetailModal({ kind: 'mission', id: mission.id })}
              onOpenCandidate={(candidate) =>
                setDetailModal({ kind: 'task_candidate', id: candidate.id })
              }
              onEditGoal={(goal) =>
                setGoalDraft({
                  id: goal.id,
                  title: goal.title,
                  goalText: goal.goalText,
                  active: goal.active,
                })
              }
              onToggleGoalActive={(goal) =>
                void runAction('goal:save', async () => {
                  await readJsonResponse(
                    await updateMissionGoal(project.id, goal.id, { active: !goal.active })
                  );
                })
              }
              onDeleteGoal={(goal) =>
                void runAction('goal:delete', async () => {
                  await readJsonResponse(await deleteMissionGoal(project.id, goal.id));
                  if (detailModal?.kind === 'goal' && detailModal.id === goal.id) {
                    setDetailModal(null);
                  }
                })
              }
              onDecomposeMission={(mission) =>
                void runAction(`mission:decompose:${mission.id}`, async () => {
                  await readJsonResponse(await decomposeMission(mission.id));
                  setExpandedRows((current) => ({
                    ...current,
                    missionIds: new Set([...current.missionIds, mission.id]),
                  }));
                })
              }
              onDeleteMission={(mission) =>
                void runAction(`mission:delete:${mission.id}`, async () => {
                  await readJsonResponse(await deleteMission(mission.id));
                  if (detailModal?.kind === 'mission' && detailModal.id === mission.id) {
                    setDetailModal(null);
                  }
                })
              }
              onCreateCandidate={(candidate) =>
                void runAction('candidate:create-tasks', async () => {
                  await createTasksFromUnifiedCandidates([candidate]);
                  setSelectedCandidateIds((current) => current.filter((id) => id !== candidate.id));
                })
              }
              onDismissCandidate={(candidate) => void dismissUnifiedCandidate(candidate)}
            />
          </section>
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

        {activeTab === 'stack' ? (
          <StackProfilePanel stackProfile={metrics.stackProfile} projectPath={project.localPath} />
        ) : null}
      </div>
      {goalDraft ? (
        <GoalEditorDialog
          draft={goalDraft}
          busy={busyAction === 'goal:save'}
          stackProfile={metrics.stackProfile}
          onChange={setGoalDraft}
          onClose={() => setGoalDraft(null)}
          onSave={saveGoalDraft}
        />
      ) : null}
      {detailGoal ? (
        <GoalDetailModal
          goal={detailGoal}
          missionCount={
            missions.filter((mission) => mission.sourceGoalIds[0] === detailGoal.id).length
          }
          candidateCount={
            unifiedTaskCandidates.filter(
              (candidate) => !candidate.missionId && candidate.goalId === detailGoal.id
            ).length
          }
          busy={Boolean(busyAction)}
          onClose={() => setDetailModal(null)}
          onEdit={(goal) =>
            setGoalDraft({
              id: goal.id,
              title: goal.title,
              goalText: goal.goalText,
              active: goal.active,
            })
          }
          onToggle={(goal) =>
            void runAction('goal:save', async () => {
              await readJsonResponse(
                await updateMissionGoal(project.id, goal.id, { active: !goal.active })
              );
            })
          }
          onDelete={(goal) =>
            void runAction('goal:delete', async () => {
              await readJsonResponse(await deleteMissionGoal(project.id, goal.id));
              setDetailModal(null);
            })
          }
          onGenerateTaskCandidates={(goal) =>
            void runAction(`goal:generate-task-candidates:${goal.id}`, async () => {
              await readJsonResponse(
                await generateMissionTaskCandidates(project.id, { goalIds: [goal.id] })
              );
              setExpandedRows((current) => ({
                ...current,
                goalIds: new Set([...current.goalIds, goal.id]),
              }));
            })
          }
          onGenerateMissionCandidates={(goal) =>
            void runAction(`goal:generate-mission-candidates:${goal.id}`, async () => {
              await readJsonResponse(
                await generateMissionCandidatesFromGoals(project.id, { goalIds: [goal.id] })
              );
              setExpandedRows((current) => ({
                ...current,
                goalIds: new Set([...current.goalIds, goal.id]),
              }));
            })
          }
        />
      ) : null}
      {detailCandidate ? (
        <TaskCandidateDetailModal
          candidate={detailCandidate}
          busy={Boolean(busyAction)}
          onClose={() => setDetailModal(null)}
          onCreateTask={(candidate) =>
            void runAction('candidate:create-tasks', async () => {
              await createTasksFromUnifiedCandidates([candidate]);
              setSelectedCandidateIds((current) => current.filter((id) => id !== candidate.id));
              setDetailModal(null);
            })
          }
          onDismiss={(candidate) => void dismissUnifiedCandidate(candidate)}
        />
      ) : null}
      {detailMission ? (
        <MissionCandidateModal
          mission={detailMission}
          goals={goals}
          taskCandidateCount={
            unifiedTaskCandidates.filter((candidate) => candidate.missionId === detailMission.id)
              .length
          }
          busy={busyAction === `mission:decompose:${detailMission.id}`}
          onClose={() => setDetailModal(null)}
          onDecompose={(mission) =>
            void runAction(`mission:decompose:${mission.id}`, async () => {
              await readJsonResponse(await decomposeMission(mission.id));
              setExpandedRows((current) => ({
                ...current,
                missionIds: new Set([...current.missionIds, mission.id]),
              }));
              setDetailModal(null);
            })
          }
          onDelete={(mission) =>
            void runAction(`mission:delete:${mission.id}`, async () => {
              await readJsonResponse(await deleteMission(mission.id));
              setDetailModal(null);
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

function StackSummaryBadge({ stackProfile }: { stackProfile: ProjectStackProfile }) {
  const { t } = useTranslation();
  const summary = stackProfile.summary || t('projectDetail.stack.unknown');
  return (
    <div
      className="flex min-h-8 max-w-full items-center gap-2 border px-3 text-xs font-semibold"
      style={{
        background: 'color-mix(in srgb, var(--nw-primary) 9%, var(--nw-panel))',
        borderColor: 'color-mix(in srgb, var(--nw-primary) 35%, var(--nw-border))',
        borderRadius: 'var(--nw-control-radius)',
        color: 'var(--nw-primary)',
      }}
      title={summary}
    >
      <Code2 className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{summary}</span>
    </div>
  );
}

function StackProfilePanel({
  stackProfile,
  projectPath,
}: {
  stackProfile: ProjectStackProfile;
  projectPath: string;
}) {
  const { t } = useTranslation();
  const summary = stackProfile.summary || t('projectDetail.stack.unknown');
  return (
    <section className="space-y-3">
      <SectionHeading
        icon={<Layers3 className="h-4 w-4" />}
        title={t('projectDetail.stack.title')}
        description={t('projectDetail.stack.description')}
        aside={<StackSummaryBadge stackProfile={stackProfile} />}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <KpiTile
          label={t('projectDetail.stack.summary')}
          value={summary}
          sub={t('projectDetail.stack.summarySub')}
        />
        <KpiTile
          label={t('projectDetail.stack.packageManager')}
          value={stackProfile.packageManager || '—'}
          sub={t('projectDetail.stack.packageManagerSub')}
        />
        <KpiTile
          label={t('projectDetail.stack.manifest')}
          value={t(`projectDetail.stack.manifestStatus.${stackProfile.manifestStatus}`)}
          sub={projectPath}
        />
      </div>
      <div className="overflow-hidden border" style={panelStyle}>
        <div className="border-b p-3" style={tableBorderStyle}>
          <SectionLabel
            icon={<Code2 className="h-4 w-4" />}
            title={t('projectDetail.stack.detectedTechnologies')}
          />
        </div>
        <div className="nightworkers-scrollbar overflow-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead style={subtleTextStyle}>
              <tr>
                <th className="py-2 pl-4 text-left">{t('projectDetail.field.technology')}</th>
                <th className="py-2 text-left">{t('projectDetail.field.category')}</th>
                <th className="py-2 text-left">{t('projectDetail.field.source')}</th>
                <th className="py-2 text-left">{t('projectDetail.field.version')}</th>
                <th className="py-2 pr-4 text-right">{t('projectDetail.field.confidence')}</th>
              </tr>
            </thead>
            <tbody>
              {stackProfile.technologies.length > 0 ? (
                stackProfile.technologies.map((technology) => (
                  <tr
                    key={`${technology.name}:${technology.packageName ?? technology.source}`}
                    className="border-t"
                    style={tableBorderStyle}
                  >
                    <td className="py-3 pl-4">
                      <div className="font-semibold">{technology.name}</div>
                      <div className="text-[10px]" style={subtleTextStyle}>
                        {technology.packageName || '—'}
                      </div>
                    </td>
                    <td className="py-3">
                      {t(`projectDetail.stack.category.${technology.category}`)}
                    </td>
                    <td className="py-3">{t(`projectDetail.stack.source.${technology.source}`)}</td>
                    <td className="py-3 font-mono">{technology.version || '—'}</td>
                    <td className="py-3 pr-4 text-right">
                      {t(`projectDetail.stack.confidence.${technology.confidence}`)}
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyTableRow colSpan={5} message={t('projectDetail.stack.empty')} />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function TaskGenerationTreeTable({
  rows,
  expanded,
  selectedIds,
  selectedCount,
  busy,
  busyAction,
  onAddGoal,
  onCreateSelected,
  onGenerateTaskCandidates,
  onGenerateMissionCandidates,
  onToggleGoal,
  onToggleMission,
  onToggleSelected,
  onOpenGoal,
  onOpenMission,
  onOpenCandidate,
  onEditGoal,
  onToggleGoalActive,
  onDeleteGoal,
  onDecomposeMission,
  onDeleteMission,
  onCreateCandidate,
  onDismissCandidate,
}: {
  rows: TaskGenerationTreeRow[];
  expanded: ExpandedState;
  selectedIds: string[];
  selectedCount: number;
  busy: boolean;
  busyAction: string | null;
  onAddGoal: () => void;
  onCreateSelected: () => void;
  onGenerateTaskCandidates: () => void;
  onGenerateMissionCandidates: () => void;
  onToggleGoal: (goalId: string) => void;
  onToggleMission: (missionId: string) => void;
  onToggleSelected: (candidateId: string) => void;
  onOpenGoal: (goal: MissionGoal | null) => void;
  onOpenMission: (mission: Mission) => void;
  onOpenCandidate: (candidate: UnifiedTaskCandidate) => void;
  onEditGoal: (goal: MissionGoal) => void;
  onToggleGoalActive: (goal: MissionGoal) => void;
  onDeleteGoal: (goal: MissionGoal) => void;
  onDecomposeMission: (mission: Mission) => void;
  onDeleteMission: (mission: Mission) => void;
  onCreateCandidate: (candidate: UnifiedTaskCandidate) => void;
  onDismissCandidate: (candidate: UnifiedTaskCandidate) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3">
      <SectionHeading
        icon={<Sparkles className="h-4 w-4" />}
        title={t('projectDetail.mission.treeTitle')}
      />
      <div className="overflow-hidden border" style={panelStyle}>
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-b p-3"
          style={tableBorderStyle}
        >
          <SectionLabel
            icon={<Target className="h-4 w-4" />}
            title={t('projectDetail.mission.candidates')}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              onClick={onAddGoal}
              disabled={busy}
              className="h-8 px-3 text-xs font-semibold"
              style={controlStyle}
            >
              <Target className="h-3.5 w-3.5" />
              {t('projectDetail.goals.add')}
            </Button>
            <Button
              type="button"
              onClick={onCreateSelected}
              disabled={busy || selectedCount === 0}
              className="h-8 px-3 text-xs font-semibold"
              style={controlStyle}
            >
              {t('projectDetail.mission.createTasks', { count: selectedCount })}
            </Button>
            <Button
              type="button"
              onClick={onGenerateMissionCandidates}
              disabled={busy}
              className="h-8 px-3 text-xs font-semibold"
              style={controlStyle}
            >
              {busyAction === 'goal:generate-mission-candidates' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {t('projectDetail.mission.generateMissionCandidates')}
            </Button>
            <Button
              type="button"
              onClick={onGenerateTaskCandidates}
              disabled={busy}
              className="h-8 px-3 text-xs font-semibold"
              style={primaryButtonStyle}
            >
              {busyAction === 'goal:generate-task-candidates' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              {t('projectDetail.mission.generate')}
            </Button>
          </div>
        </div>
        <div className="nightworkers-scrollbar overflow-auto">
          <table className="w-full min-w-[1160px] text-xs">
            <thead style={subtleTextStyle}>
              <tr>
                <th className="py-2 pl-4 text-left">{t('projectDetail.mission.open')}</th>
                <th className="py-2 text-left">{t('projectDetail.mission.select')}</th>
                <th className="py-2 text-left">{t('projectDetail.field.candidate')}</th>
                <th className="py-2 text-left">{t('projectDetail.field.kind')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.status')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.evalContribution')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.tokenSize')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.importance')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.confidence')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.complexity')}</th>
                <th className="py-2 pr-4 text-right">{t('projectDetail.field.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? (
                rows.map((row) => (
                  <TaskGenerationTreeRowView
                    key={`${row.kind}:${row.id}`}
                    row={row}
                    expanded={expanded}
                    selectedIds={selectedIds}
                    busy={busy}
                    onToggleGoal={onToggleGoal}
                    onToggleMission={onToggleMission}
                    onToggleSelected={onToggleSelected}
                    onOpenGoal={onOpenGoal}
                    onOpenMission={onOpenMission}
                    onOpenCandidate={onOpenCandidate}
                    onEditGoal={onEditGoal}
                    onToggleGoalActive={onToggleGoalActive}
                    onDeleteGoal={onDeleteGoal}
                    onDecomposeMission={onDecomposeMission}
                    onDeleteMission={onDeleteMission}
                    onCreateCandidate={onCreateCandidate}
                    onDismissCandidate={onDismissCandidate}
                  />
                ))
              ) : (
                <EmptyTableRow colSpan={11} message={t('projectDetail.empty.goals')} />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function TaskGenerationTreeRowView({
  row,
  expanded,
  selectedIds,
  busy,
  onToggleGoal,
  onToggleMission,
  onToggleSelected,
  onOpenGoal,
  onOpenMission,
  onOpenCandidate,
  onEditGoal,
  onToggleGoalActive,
  onDeleteGoal,
  onDecomposeMission,
  onDeleteMission,
  onCreateCandidate,
  onDismissCandidate,
}: {
  row: TaskGenerationTreeRow;
  expanded: ExpandedState;
  selectedIds: string[];
  busy: boolean;
  onToggleGoal: (goalId: string) => void;
  onToggleMission: (missionId: string) => void;
  onToggleSelected: (candidateId: string) => void;
  onOpenGoal: (goal: MissionGoal | null) => void;
  onOpenMission: (mission: Mission) => void;
  onOpenCandidate: (candidate: UnifiedTaskCandidate) => void;
  onEditGoal: (goal: MissionGoal) => void;
  onToggleGoalActive: (goal: MissionGoal) => void;
  onDeleteGoal: (goal: MissionGoal) => void;
  onDecomposeMission: (mission: Mission) => void;
  onDeleteMission: (mission: Mission) => void;
  onCreateCandidate: (candidate: UnifiedTaskCandidate) => void;
  onDismissCandidate: (candidate: UnifiedTaskCandidate) => void;
}) {
  const { t } = useTranslation();
  const indent = row.depth === 0 ? 'pl-1' : row.depth === 1 ? 'pl-7' : 'pl-12';
  const emptyCell = <span style={mutedTextStyle}>—</span>;

  if (row.kind === 'goal') {
    const isExpanded = expanded.goalIds.has(row.id);
    const hasChildren = row.childCounts.missions + row.childCounts.taskCandidates > 0;
    return (
      <tr className="border-t" style={tableBorderStyle}>
        <td className="py-3 pl-4">
          <TreeToggle
            expanded={isExpanded}
            disabled={!hasChildren}
            onClick={() => onToggleGoal(row.id)}
          />
        </td>
        <td className="py-3">{emptyCell}</td>
        <td className={`max-w-[320px] py-3 ${indent}`}>
          {row.goal ? (
            <button
              type="button"
              className="block max-w-full text-left"
              onClick={() => onOpenGoal(row.goal)}
            >
              <span className="block truncate font-semibold">{row.goal.title}</span>
              <span className="mt-0.5 line-clamp-2 text-[10px]" style={subtleTextStyle}>
                {row.goal.goalText}
              </span>
            </button>
          ) : (
            <div>
              <div className="font-semibold">{t('projectDetail.mission.unassigned')}</div>
              <div className="mt-0.5 text-[10px]" style={subtleTextStyle}>
                {t('projectDetail.mission.unassignedHint')}
              </div>
            </div>
          )}
        </td>
        <td className="py-3">{t('projectDetail.tree.kind.goal')}</td>
        <td className="py-3 text-right">
          {row.goal ? <ActiveChip active={row.goal.active} /> : emptyCell}
        </td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 pr-4 text-right">
          {row.goal ? (
            <div className="flex justify-end gap-1">
              <IconActionButton label="Edit" onClick={() => onEditGoal(row.goal!)} disabled={busy}>
                <Pencil className="h-3.5 w-3.5" />
              </IconActionButton>
              <IconActionButton
                label={
                  row.goal.active
                    ? t('projectDetail.status.inactive')
                    : t('projectDetail.status.active')
                }
                onClick={() => onToggleGoalActive(row.goal!)}
                disabled={busy}
              >
                <Check className="h-3.5 w-3.5" />
              </IconActionButton>
              <IconActionButton
                label="Delete"
                onClick={() => onDeleteGoal(row.goal!)}
                disabled={busy}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconActionButton>
            </div>
          ) : (
            emptyCell
          )}
        </td>
      </tr>
    );
  }

  if (row.kind === 'mission') {
    const isExpanded = expanded.missionIds.has(row.id);
    const hasChildren = row.childCounts.taskCandidates > 0;
    const canDeleteMission = !isMissionDeleteInProgress(row.mission.status) && !hasChildren;
    return (
      <tr className="border-t" style={tableBorderStyle}>
        <td className="py-3 pl-4">
          <TreeToggle
            expanded={isExpanded}
            disabled={!hasChildren}
            onClick={() => onToggleMission(row.id)}
          />
        </td>
        <td className="py-3">{emptyCell}</td>
        <td className={`max-w-[320px] py-3 ${indent}`}>
          <button
            type="button"
            className="block max-w-full text-left"
            onClick={() => onOpenMission(row.mission)}
          >
            <span className="block truncate font-semibold">{row.mission.title}</span>
            <span className="mt-0.5 line-clamp-2 text-[10px]" style={subtleTextStyle}>
              {row.mission.goalText}
            </span>
          </button>
        </td>
        <td className="py-3">{t('projectDetail.tree.kind.mission')}</td>
        <td className="py-3 text-right">
          {t(`projectDetail.mission.status.${row.mission.status}`, {
            defaultValue: row.mission.status,
          })}
        </td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 pr-4 text-right">
          <div className="flex justify-end gap-1">
            <IconActionButton
              label={t('projectDetail.mission.decomposeToTaskCandidates')}
              onClick={() => onDecomposeMission(row.mission)}
              disabled={
                busy || row.mission.status === 'review_pending' || row.mission.status === 'active'
              }
            >
              <Sparkles className="h-3.5 w-3.5" />
            </IconActionButton>
            <IconActionButton
              label={
                hasChildren
                  ? t('projectDetail.mission.deleteMissionBlockedByChildren')
                  : t('projectDetail.mission.deleteMission')
              }
              onClick={() => onDeleteMission(row.mission)}
              disabled={busy || !canDeleteMission}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconActionButton>
          </div>
        </td>
      </tr>
    );
  }

  const candidate = row.candidate;
  return (
    <tr className="border-t" style={tableBorderStyle}>
      <td className="py-3 pl-4">{emptyCell}</td>
      <td className="py-3">
        <input
          type="checkbox"
          checked={selectedIds.includes(candidate.id)}
          onChange={() => onToggleSelected(candidate.id)}
          disabled={busy || candidate.status !== 'candidate'}
        />
      </td>
      <td className={`max-w-[320px] py-3 ${indent}`}>
        <button
          type="button"
          className="block max-w-full text-left"
          onClick={() => onOpenCandidate(candidate)}
        >
          <span className="block truncate font-semibold">{candidate.title}</span>
          <span className="mt-0.5 line-clamp-2 text-[10px]" style={subtleTextStyle}>
            {candidate.rationale}
          </span>
        </button>
      </td>
      <td className="py-3">{t('projectDetail.tree.kind.taskCandidate')}</td>
      <td className="py-3 text-right">
        {t(`projectDetail.mission.status.${candidate.status}`, { defaultValue: candidate.status })}
      </td>
      <td className="py-3 text-right">
        {candidate.evaluationContribution === null ? (
          emptyCell
        ) : (
          <span className="font-semibold" style={primaryTextStyle}>
            +{candidate.evaluationContribution}
          </span>
        )}
      </td>
      <td className="py-3 text-right">
        {candidate.tokenSize ? <SizeChip value={candidate.tokenSize} /> : emptyCell}
      </td>
      <td className="py-3 text-right">
        {candidate.importancePercent === null ? emptyCell : `${candidate.importancePercent}%`}
      </td>
      <td className="py-3 text-right">
        {candidate.confidencePercent === null ? emptyCell : `${candidate.confidencePercent}%`}
      </td>
      <td className="py-3 text-right">
        {candidate.complexity ? <ComplexityChip value={candidate.complexity} /> : emptyCell}
      </td>
      <td className="py-3 pr-4 text-right">
        <div className="flex justify-end gap-1">
          <IconActionButton
            label={t('projectDetail.mission.createSingleTask')}
            onClick={() => onCreateCandidate(candidate)}
            disabled={busy || candidate.status !== 'candidate'}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
          </IconActionButton>
          <IconActionButton
            label={t('projectDetail.mission.deleteCandidate')}
            onClick={() => onDismissCandidate(candidate)}
            disabled={busy || candidate.status !== 'candidate'}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconActionButton>
        </div>
      </td>
    </tr>
  );
}

function TreeToggle({
  expanded,
  disabled,
  onClick,
}: {
  expanded: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <IconActionButton
      label={expanded ? 'Collapse' : 'Expand'}
      onClick={onClick}
      disabled={disabled}
    >
      {expanded ? (
        <ChevronDown className="h-3.5 w-3.5" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5" />
      )}
    </IconActionButton>
  );
}

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

export function GoalEditorDialog({
  draft,
  busy,
  stackProfile,
  onChange,
  onClose,
  onSave,
}: {
  draft: GoalDraft;
  busy: boolean;
  stackProfile?: ProjectStackProfile | null;
  onChange: (draft: GoalDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const availableTemplates = getMissionGoalTemplatesForStack(stackProfile);
  const selectedTemplateId = availableTemplates.find(
    (template) => template.goalText === draft.goalText
  )?.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg border p-3"
        style={panelStyle}
      >
        <div className="text-sm font-bold">
          {draft.id
            ? t('projectDetail.goalDialog.editTitle')
            : t('projectDetail.goalDialog.addTitle')}
        </div>
        <div className="mt-3 space-y-2.5">
          {!draft.id ? (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold" style={subtleTextStyle}>
                {t('projectDetail.goalTemplates.label')}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {availableTemplates.map((template) => {
                  const selected = selectedTemplateId === template.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onChange(toggleMissionGoalTemplate(draft, template))}
                      className="flex h-8 min-w-0 cursor-pointer items-center gap-2 border px-2 text-left text-[11px] font-semibold"
                      style={
                        selected
                          ? {
                              background:
                                'color-mix(in srgb, var(--nw-primary) 12%, var(--nw-panel))',
                              borderColor: 'var(--nw-primary)',
                              borderRadius: 'var(--nw-control-radius)',
                              color: 'var(--nw-primary)',
                            }
                          : controlStyle
                      }
                    >
                      <span
                        aria-hidden
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                        style={{
                          background: selected ? 'var(--nw-primary)' : 'transparent',
                          borderColor: selected ? 'var(--nw-primary)' : 'var(--nw-border)',
                        }}
                      >
                        {selected ? (
                          <Check
                            aria-hidden
                            className="h-3 w-3"
                            style={{ color: 'var(--nw-primary-foreground, var(--nw-background))' }}
                          />
                        ) : null}
                      </span>
                      <span className="truncate">{template.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <label className="block text-xs font-semibold">
            {t('projectDetail.goalDialog.title')}
            <input
              value={draft.title}
              onChange={(event) => onChange({ ...draft, title: event.target.value })}
              className="mt-1 h-9 w-full border px-2"
              style={controlStyle}
            />
          </label>
          <label className="block text-xs font-semibold">
            {t('projectDetail.goalDialog.definition')}
            <textarea
              value={draft.goalText}
              onChange={(event) => onChange({ ...draft, goalText: event.target.value })}
              className="mt-1 min-h-28 w-full border px-2 py-2"
              style={controlStyle}
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(event) => onChange({ ...draft, active: event.target.checked })}
            />
            {t('projectDetail.goalDialog.active')}
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" onClick={onClose} disabled={busy} style={controlStyle}>
            {t('projectDetail.goalDialog.cancel')}
          </Button>
          <Button
            type="button"
            onClick={onSave}
            disabled={busy || !draft.title.trim() || !draft.goalText.trim()}
            style={primaryButtonStyle}
          >
            {t('projectDetail.goalDialog.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function GoalDetailModal({
  goal,
  missionCount,
  candidateCount,
  busy,
  onClose,
  onEdit,
  onToggle,
  onDelete,
  onGenerateTaskCandidates,
  onGenerateMissionCandidates,
}: {
  goal: MissionGoal;
  missionCount: number;
  candidateCount: number;
  busy: boolean;
  onClose: () => void;
  onEdit: (goal: MissionGoal) => void;
  onToggle: (goal: MissionGoal) => void;
  onDelete: (goal: MissionGoal) => void;
  onGenerateTaskCandidates: (goal: MissionGoal) => void;
  onGenerateMissionCandidates: (goal: MissionGoal) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="nightworkers-scrollbar max-h-[90vh] w-full max-w-2xl overflow-y-auto border p-4"
        style={panelStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-bold">{goal.title}</div>
            <div className="mt-1">
              <ActiveChip active={goal.active} />
            </div>
          </div>
          <IconActionButton
            label={t('projectDetail.mission.close')}
            onClick={onClose}
            disabled={busy}
          >
            <X className="h-3.5 w-3.5" />
          </IconActionButton>
        </div>
        <DrawerSection title={t('projectDetail.field.goalDefinition')} body={goal.goalText} />
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <KpiTile
            label={t('projectDetail.tree.kind.mission')}
            value={String(missionCount)}
            sub={t('projectDetail.mission.childCountSub')}
          />
          <KpiTile
            label={t('projectDetail.tree.kind.taskCandidate')}
            value={String(candidateCount)}
            sub={t('projectDetail.mission.childCountSub')}
          />
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button type="button" onClick={() => onEdit(goal)} disabled={busy} style={controlStyle}>
            <Pencil className="h-3.5 w-3.5" />
            {t('projectDetail.goalDialog.editTitle')}
          </Button>
          <Button type="button" onClick={() => onToggle(goal)} disabled={busy} style={controlStyle}>
            <Check className="h-3.5 w-3.5" />
            {goal.active ? t('projectDetail.status.inactive') : t('projectDetail.status.active')}
          </Button>
          <Button type="button" onClick={() => onDelete(goal)} disabled={busy} style={controlStyle}>
            <Trash2 className="h-3.5 w-3.5" />
            {t('projectDetail.goals.delete')}
          </Button>
          <Button
            type="button"
            onClick={() => onGenerateMissionCandidates(goal)}
            disabled={busy}
            style={controlStyle}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('projectDetail.mission.generateMissionCandidates')}
          </Button>
          <Button
            type="button"
            onClick={() => onGenerateTaskCandidates(goal)}
            disabled={busy}
            style={primaryButtonStyle}
          >
            <Zap className="h-3.5 w-3.5" />
            {t('projectDetail.mission.generate')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MissionCandidateModal({
  mission,
  goals,
  taskCandidateCount = 0,
  busy,
  onClose,
  onDecompose,
  onDelete,
}: {
  mission: Mission;
  goals: MissionGoal[];
  taskCandidateCount?: number;
  busy: boolean;
  onClose: () => void;
  onDecompose: (mission: Mission) => void;
  onDelete: (mission: Mission) => void;
}) {
  const { t } = useTranslation();
  const canDeleteMission = !isMissionDeleteInProgress(mission.status) && taskCandidateCount === 0;
  const sourceGoals = mission.sourceGoalIds
    .map((goalId) => goals.find((goal) => goal.id === goalId))
    .filter((goal): goal is MissionGoal => Boolean(goal));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="nightworkers-scrollbar max-h-[90vh] w-full max-w-2xl overflow-y-auto border p-4"
        style={panelStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-bold">{mission.title}</div>
            <div className="mt-1 text-xs" style={mutedTextStyle}>
              {t(`projectDetail.mission.status.${mission.status}`, {
                defaultValue: mission.status,
              })}
            </div>
          </div>
          <IconActionButton
            label={t('projectDetail.mission.close')}
            onClick={onClose}
            disabled={busy}
          >
            <X className="h-3.5 w-3.5" />
          </IconActionButton>
        </div>
        <DrawerSection title={t('projectDetail.mission.goalText')} body={mission.goalText} />
        {mission.statusReason ? (
          <DrawerSection title={t('projectDetail.mission.rationale')} body={mission.statusReason} />
        ) : null}
        {mission.nonGoals.length > 0 ? (
          <DrawerSection
            title={t('projectDetail.mission.nonGoals')}
            body={mission.nonGoals.join('\n')}
          />
        ) : null}
        <section className="mt-4">
          <div className="text-xs font-bold">{t('projectDetail.mission.linkedGoals')}</div>
          <div className="mt-2 space-y-2">
            {sourceGoals.length > 0 ? (
              sourceGoals.map((goal) => (
                <div key={goal.id} className="border p-2 text-xs" style={controlStyle}>
                  <div className="font-semibold">{goal.title}</div>
                  <div className="mt-1" style={mutedTextStyle}>
                    {goal.goalText}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-xs" style={mutedTextStyle}>
                {t('projectDetail.mission.noLinkedGoal')}
              </div>
            )}
          </div>
        </section>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            onClick={() => onDelete(mission)}
            disabled={busy || !canDeleteMission}
            title={
              taskCandidateCount > 0
                ? t('projectDetail.mission.deleteMissionBlockedByChildren')
                : undefined
            }
            style={controlStyle}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('projectDetail.mission.deleteMission')}
          </Button>
          <Button type="button" onClick={onClose} disabled={busy} style={controlStyle}>
            {t('projectDetail.mission.close')}
          </Button>
          <Button
            type="button"
            onClick={() => onDecompose(mission)}
            disabled={busy || mission.status === 'review_pending' || mission.status === 'active'}
            style={primaryButtonStyle}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {t('projectDetail.mission.decomposeToTaskCandidates')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TaskCandidateDetailModal({
  candidate,
  busy,
  onClose,
  onCreateTask,
  onDismiss,
}: {
  candidate: UnifiedTaskCandidate;
  busy: boolean;
  onClose: () => void;
  onCreateTask: (candidate: UnifiedTaskCandidate) => void;
  onDismiss: (candidate: UnifiedTaskCandidate) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="nightworkers-scrollbar max-h-[90vh] w-full max-w-2xl overflow-y-auto border p-4"
        style={panelStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-bold">{candidate.title}</div>
            <div className="mt-1 text-xs" style={mutedTextStyle}>
              {candidate.goalTitle || candidate.goalId || t('projectDetail.mission.noLinkedGoal')}
            </div>
          </div>
          <IconActionButton
            label={t('projectDetail.mission.close')}
            onClick={onClose}
            disabled={busy}
          >
            <X className="h-3.5 w-3.5" />
          </IconActionButton>
        </div>
        <DrawerSection title={t('projectDetail.mission.summary')} body={candidate.summary} />
        <DrawerSection title={t('projectDetail.mission.rationale')} body={candidate.rationale} />
        <DrawerSection title={t('projectDetail.mission.taskPrompt')} body={candidate.taskPrompt} />
        <DrawerSection
          title={t('projectDetail.mission.acceptanceCriteria')}
          body={candidate.acceptanceCriteria}
        />
        <DrawerSection
          title={t('projectDetail.mission.verificationPlan')}
          body={candidate.verificationPlan}
        />
        <div className="mt-4">
          <div className="text-xs font-bold">{t('projectDetail.mission.evidence')}</div>
          <div className="mt-2 space-y-2">
            {candidate.evidence.length > 0 ? (
              candidate.evidence.map((item, index) => (
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
              ))
            ) : (
              <div className="text-xs" style={mutedTextStyle}>
                —
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <KpiTile
            label={t('projectDetail.field.importance')}
            value={candidate.importancePercent === null ? '—' : `${candidate.importancePercent}%`}
            sub={t('projectDetail.mission.importanceSub')}
          />
          <KpiTile
            label={t('projectDetail.field.confidence')}
            value={candidate.confidencePercent === null ? '—' : `${candidate.confidencePercent}%`}
            sub={t('projectDetail.mission.confidenceSub')}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            onClick={() => onDismiss(candidate)}
            disabled={busy || candidate.status !== 'candidate'}
            style={controlStyle}
          >
            {t('projectDetail.mission.deleteCandidate')}
          </Button>
          <Button
            type="button"
            onClick={() => onCreateTask(candidate)}
            disabled={busy || candidate.status !== 'candidate'}
            style={primaryButtonStyle}
          >
            {t('projectDetail.mission.createSingleTask')}
          </Button>
        </div>
      </div>
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
  aside,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  aside?: React.ReactNode;
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
      {aside ? <div className="min-w-0 max-w-full">{aside}</div> : null}
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
