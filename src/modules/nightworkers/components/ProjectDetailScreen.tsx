import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectEvaluationScreen } from '@/modules/project-evaluation';
import type {
  Mission,
  MissionTaskProposal,
} from '../../../../shared/schemas/mission-planner.schema';
import type {
  MissionGoal,
  MissionTaskCandidate,
  ProjectDetailMetrics,
  ProjectQualityOverview,
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
import { coverageRowsFromSummary } from '../qualityRows';
import type { Task } from '../types';
import { emptyMetrics, readJsonResponse } from './project-detail/data';
import {
  buildExpandedTaskGenerationState,
  buildTaskGenerationTreeRows,
  buildUnifiedTaskCandidates,
  pruneExpandedTaskGenerationState,
} from './project-detail/mission-model';
import {
  GoalDetailModal,
  GoalEditorDialog,
  MissionCandidateModal,
  TaskCandidateDetailModal,
} from './project-detail/ProjectDetailDialogs';
import { TaskGenerationTreeTable } from './project-detail/ProjectDetailMissionTree';
import { ProjectDetailOverview } from './project-detail/ProjectDetailOverview';
import {
  coverageAxesFromQualityRun,
  e2eRowsFromSummary,
  QualityReportPanel,
} from './project-detail/ProjectDetailQuality';
import { StackProfilePanel } from './project-detail/ProjectDetailStack';
import { controlStyle, panelStyle, shellStyle, tableBorderStyle } from './project-detail/styles';
import type {
  CoverageAxis,
  DetailModalState,
  ExpandedState,
  GoalDraft,
  ModelUsageRow,
  ProjectDetailScreenProps,
  TopTokenTaskRow,
  UnifiedTaskCandidate,
} from './project-detail/types';
import { projectDetailTabs } from './project-detail/types';

export {
  applyMissionGoalTemplate,
  buildExpandedTaskGenerationState,
  buildTaskGenerationTreeRows,
  buildUnifiedTaskCandidates,
  toggleMissionGoalTemplate,
} from './project-detail/mission-model';
export { GoalEditorDialog } from './project-detail/ProjectDetailDialogs';
export { TaskGenerationTreeTable } from './project-detail/ProjectDetailMissionTree';
export {
  coverageAxesFromQualityRun,
  QualityReportPanel,
} from './project-detail/ProjectDetailQuality';

export function ProjectDetailScreen({
  project,
  sessionViews,
  activeTab,
  onActiveTabChange,
  onOpenSession,
  onEvaluationTasksCreated,
}: ProjectDetailScreenProps) {
  const { t } = useTranslation();
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
  const [expansionPreference, setExpansionPreference] = useState<'all' | 'custom'>('all');
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
  const allExpandedRows = useMemo(
    () =>
      buildExpandedTaskGenerationState({
        goals,
        missions,
        candidates: unifiedTaskCandidates,
      }),
    [goals, missions, unifiedTaskCandidates]
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
    setExpansionPreference('all');
    setExpandedRows({ goalIds: new Set(), missionIds: new Set() });
    loadProjectDetail().catch((error) => {
      if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [loadProjectDetail]);

  useEffect(() => {
    setExpandedRows((current) =>
      expansionPreference === 'all'
        ? allExpandedRows
        : pruneExpandedTaskGenerationState({ expanded: current, goals, missions })
    );
    setSelectedCandidateIds((current) =>
      current.filter((id) => unifiedTaskCandidates.some((candidate) => candidate.id === id))
    );
  }, [allExpandedRows, expansionPreference, goals, missions, unifiedTaskCandidates]);

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

  const toggleExpandedGoal = (goalId: string) => {
    setExpansionPreference('custom');
    setExpandedRows((current) => {
      const goalIds = new Set(current.goalIds);
      if (goalIds.has(goalId)) goalIds.delete(goalId);
      else goalIds.add(goalId);
      return { ...current, goalIds };
    });
  };

  const toggleExpandedMission = (missionId: string) => {
    setExpansionPreference('custom');
    setExpandedRows((current) => {
      const missionIds = new Set(current.missionIds);
      if (missionIds.has(missionId)) missionIds.delete(missionId);
      else missionIds.add(missionId);
      return { ...current, missionIds };
    });
  };

  const expandAllTaskGenerationRows = () => {
    setExpansionPreference('all');
    setExpandedRows(allExpandedRows);
  };

  const collapseAllTaskGenerationRows = () => {
    setExpansionPreference('custom');
    setExpandedRows({ goalIds: new Set(), missionIds: new Set() });
  };

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
              onClick={() => onActiveTabChange(tab.id)}
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
          <ProjectDetailOverview
            metrics={metrics}
            totalRuns={totalRuns}
            completedCount={completedCount}
            modelUsageRows={modelUsageRows}
            topTokenTasks={topTokenTasks}
            coverageAxes={coverageAxes}
            onOpenSession={onOpenSession}
          />
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
              onExpandAll={expandAllTaskGenerationRows}
              onCollapseAll={collapseAllTaskGenerationRows}
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
                  if (detailModal?.kind === 'goal' && detailModal.id === goal.id)
                    setDetailModal(null);
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
                  if (detailModal?.kind === 'mission' && detailModal.id === mission.id)
                    setDetailModal(null);
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
          goals={goals}
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
