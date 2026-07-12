import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	Mission,
	MissionTaskProposal,
} from "../../../shared/schemas/mission-planner.schema";
import type {
	GenerateTaskCandidatesResponse,
	MissionGoal,
	MissionTaskCandidate,
} from "../../../shared/schemas/task-generation.schema";
import type { ProjectStackProfile } from "../../../shared/schemas/tech-stack.schema";
import { readJsonResponse } from "../nightworkers/components/project-detail/data";
import type { Task } from "../nightworkers/types";
import {
	createMissionGoal,
	createTasksFromMissionCandidates,
	createTasksFromMissionTaskProposals,
	decomposeMission,
	deleteMission,
	deleteMissionGoal,
	dismissMissionTaskProposal,
	fetchMissionGoals,
	fetchMissions,
	fetchMissionTaskCandidates,
	fetchRepositoryMissionTaskProposals,
	generateTaskCandidates,
	updateMissionGoal,
	updateMissionTaskCandidate,
} from "./api/taskGenerationCommands";
import {
	GoalDetailModal,
	GoalEditorDialog,
	MissionCandidateModal,
	TaskCandidateDetailModal,
} from "./components/TaskGenerationDialogs";
import { TaskGenerationTreeTable } from "./components/TaskGenerationTreeTable";
import {
	buildExpandedTaskGenerationState,
	buildTaskGenerationTreeRows,
	buildUnifiedTaskCandidates,
	countMissionsForGoal,
	pruneExpandedTaskGenerationState,
} from "./taskGenerationModel";
import type {
	DetailModalState,
	ExpandedState,
	GoalDraft,
	UnifiedTaskCandidate,
} from "./types";

export type TaskGenerationPanelProps = {
	repositoryId: string;
	stackProfile?: ProjectStackProfile | null;
	onTasksCreated?: (tasks: Task[]) => Promise<void> | void;
};

export function TaskGenerationPanel({
	repositoryId,
	stackProfile,
	onTasksCreated,
}: TaskGenerationPanelProps) {
	const [goals, setGoals] = useState<MissionGoal[]>([]);
	const [missions, setMissions] = useState<Mission[]>([]);
	const [candidates, setCandidates] = useState<MissionTaskCandidate[]>([]);
	const [proposalCandidates, setProposalCandidates] = useState<
		MissionTaskProposal[]
	>([]);
	const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);
	const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>(
		[],
	);
	const [expandedRows, setExpandedRows] = useState<ExpandedState>({
		goalIds: new Set(),
		missionIds: new Set(),
	});
	const [detailModal, setDetailModal] = useState<DetailModalState>(null);
	const [expansionPreference, setExpansionPreference] = useState<
		"all" | "custom"
	>("all");
	const [busyAction, setBusyAction] = useState<string | null>(null);
	const [message, setMessage] = useState("");
	const [messageKind, setMessageKind] = useState<"error" | "success" | null>(
		null,
	);

	const unifiedTaskCandidates = useMemo(
		() => buildUnifiedTaskCandidates(candidates, proposalCandidates),
		[candidates, proposalCandidates],
	);
	const treeRows = useMemo(
		() =>
			buildTaskGenerationTreeRows({
				goals,
				missions,
				candidates: unifiedTaskCandidates,
				expanded: expandedRows,
			}),
		[expandedRows, goals, missions, unifiedTaskCandidates],
	);
	const selectedCandidates = useMemo(
		() =>
			selectedCandidateIds
				.map((id) =>
					unifiedTaskCandidates.find((candidate) => candidate.id === id),
				)
				.filter(
					(candidate): candidate is UnifiedTaskCandidate =>
						candidate?.status === "candidate",
				),
		[selectedCandidateIds, unifiedTaskCandidates],
	);
	const allExpandedRows = useMemo(
		() =>
			buildExpandedTaskGenerationState({
				goals,
				missions,
				candidates: unifiedTaskCandidates,
			}),
		[goals, missions, unifiedTaskCandidates],
	);

	const loadTaskGeneration = useCallback(async () => {
		const [goalsRes, missionsRes, candidatesRes, proposalsRes] =
			await Promise.all([
				fetchMissionGoals(repositoryId),
				fetchMissions(repositoryId),
				fetchMissionTaskCandidates(repositoryId),
				fetchRepositoryMissionTaskProposals(repositoryId),
			]);
		setGoals(await readJsonResponse<MissionGoal[]>(goalsRes));
		setMissions(await readJsonResponse<Mission[]>(missionsRes));
		setCandidates(
			await readJsonResponse<MissionTaskCandidate[]>(candidatesRes),
		);
		setProposalCandidates(
			await readJsonResponse<MissionTaskProposal[]>(proposalsRes),
		);
	}, [repositoryId]);

	useEffect(() => {
		let cancelled = false;
		setMessage("");
		setExpansionPreference("all");
		setExpandedRows({ goalIds: new Set(), missionIds: new Set() });
		loadTaskGeneration().catch((error) => {
			if (!cancelled)
				setMessage(error instanceof Error ? error.message : String(error));
		});
		return () => {
			cancelled = true;
		};
	}, [loadTaskGeneration]);

	useEffect(() => {
		setExpandedRows((current) =>
			expansionPreference === "all"
				? allExpandedRows
				: pruneExpandedTaskGenerationState({
						expanded: current,
						goals,
						missions,
					}),
		);
		setSelectedCandidateIds((current) =>
			current.filter((id) =>
				unifiedTaskCandidates.some((candidate) => candidate.id === id),
			),
		);
	}, [
		allExpandedRows,
		expansionPreference,
		goals,
		missions,
		unifiedTaskCandidates,
	]);

	useEffect(() => {
		if (!detailModal) return;
		if (
			detailModal.kind === "goal" &&
			!goals.some((goal) => goal.id === detailModal.id)
		) {
			setDetailModal(null);
		}
		if (
			detailModal.kind === "mission" &&
			!missions.some((mission) => mission.id === detailModal.id)
		) {
			setDetailModal(null);
		}
		if (
			detailModal.kind === "task_candidate" &&
			!unifiedTaskCandidates.some(
				(candidate) => candidate.id === detailModal.id,
			)
		) {
			setDetailModal(null);
		}
	}, [detailModal, goals, missions, unifiedTaskCandidates]);

	const runAction = useCallback(
		async (label: string, action: () => Promise<void>) => {
			setBusyAction(label);
			setMessage("");
			setMessageKind(null);
			try {
				await action();
				await loadTaskGeneration();
			} catch (error) {
				setMessage(error instanceof Error ? error.message : String(error));
				setMessageKind("error");
			} finally {
				setBusyAction(null);
			}
		},
		[loadTaskGeneration],
	);

	const requestTaskCandidateGeneration = useCallback(
		async (goalIds?: string[]) => {
			const result = await readJsonResponse<GenerateTaskCandidatesResponse>(
				await generateTaskCandidates(repositoryId, goalIds ? { goalIds } : {}),
			);
			if (result.status === "needs_attention") {
				setMessage(
					result.decompositionFailures
						.map((failure) => failure.message)
						.join("\n"),
				);
			}
			return result;
		},
		[repositoryId],
	);

	const saveGoalDraft = () =>
		goalDraft
			? runAction("goal:save", async () => {
					if (goalDraft.id) {
						await readJsonResponse(
							await updateMissionGoal(repositoryId, goalDraft.id, {
								title: goalDraft.title,
								goalText: goalDraft.goalText,
								active: goalDraft.active,
							}),
						);
					} else {
						await readJsonResponse(
							await createMissionGoal(repositoryId, goalDraft),
						);
					}
					setGoalDraft(null);
				})
			: undefined;

	const createTasksFromUnifiedCandidates = useCallback(
		async (selected: UnifiedTaskCandidate[]) => {
			const createdTasks: Task[] = [];
			const directCandidateIds = selected
				.filter(
					(candidate) =>
						candidate.sourceRef.source === "mission_task_candidate",
				)
				.map((candidate) => candidate.sourceRef.id);
			const proposalIds = selected
				.filter(
					(candidate) => candidate.sourceRef.source === "mission_task_proposal",
				)
				.map((candidate) => candidate.sourceRef.id);

			if (directCandidateIds.length > 0) {
				const response = await createTasksFromMissionCandidates(repositoryId, {
					candidateIds: directCandidateIds,
					mode: "draft",
				});
				const payload = await readJsonResponse<{ tasks: Task[] }>(response);
				createdTasks.push(...payload.tasks);
			}
			if (proposalIds.length > 0) {
				const response = await createTasksFromMissionTaskProposals({
					proposalIds,
					mode: "draft",
				});
				const payload = await readJsonResponse<{ tasks: Task[] }>(response);
				createdTasks.push(...payload.tasks);
			}
			if (createdTasks.length > 0) await onTasksCreated?.(createdTasks);
		},
		[onTasksCreated, repositoryId],
	);

	const dismissUnifiedCandidate = (candidate: UnifiedTaskCandidate) =>
		runAction(`candidate:dismiss:${candidate.id}`, async () => {
			if (candidate.sourceRef.source === "mission_task_candidate") {
				await readJsonResponse(
					await updateMissionTaskCandidate(candidate.sourceRef.id, {
						status: "dismissed",
					}),
				);
			} else {
				await readJsonResponse(
					await dismissMissionTaskProposal(candidate.sourceRef.id),
				);
			}
			setSelectedCandidateIds((current) =>
				current.filter((id) => id !== candidate.id),
			);
			if (
				detailModal?.kind === "task_candidate" &&
				detailModal.id === candidate.id
			) {
				setDetailModal(null);
			}
		});

	const toggleExpandedGoal = (goalId: string) => {
		setExpansionPreference("custom");
		setExpandedRows((current) => {
			const goalIds = new Set(current.goalIds);
			if (goalIds.has(goalId)) goalIds.delete(goalId);
			else goalIds.add(goalId);
			return { ...current, goalIds };
		});
	};

	const toggleExpandedMission = (missionId: string) => {
		setExpansionPreference("custom");
		setExpandedRows((current) => {
			const missionIds = new Set(current.missionIds);
			if (missionIds.has(missionId)) missionIds.delete(missionId);
			else missionIds.add(missionId);
			return { ...current, missionIds };
		});
	};

	const detailGoal =
		detailModal?.kind === "goal"
			? goals.find((goal) => goal.id === detailModal.id)
			: null;
	const detailMission =
		detailModal?.kind === "mission"
			? missions.find((mission) => mission.id === detailModal.id)
			: null;
	const detailCandidate =
		detailModal?.kind === "task_candidate"
			? unifiedTaskCandidates.find(
					(candidate) => candidate.id === detailModal.id,
				)
			: null;

	return (
		<>
			{message ? (
				<div
					className="mb-4 border px-3 py-2 text-xs"
					style={{
						color:
							messageKind === "success"
								? "var(--nw-success)"
								: "var(--nw-danger)",
					}}
					role="status"
				>
					{message}
				</div>
			) : null}
			<section className="space-y-4">
				<TaskGenerationTreeTable
					rows={treeRows}
					expanded={expandedRows}
					selectedIds={selectedCandidateIds}
					busy={Boolean(busyAction)}
					busyAction={busyAction}
					selectedCount={selectedCandidates.length}
					onAddGoal={() =>
						setGoalDraft({ title: "", goalText: "", active: true })
					}
					onCreateSelected={() =>
						void runAction("candidate:create-tasks", async () => {
							await createTasksFromUnifiedCandidates(selectedCandidates);
							setSelectedCandidateIds([]);
						})
					}
					onGenerateTaskCandidates={() =>
						void runAction("goal:generate-task-candidates", async () => {
							await requestTaskCandidateGeneration();
						})
					}
					onExpandAll={() => {
						setExpansionPreference("all");
						setExpandedRows(allExpandedRows);
					}}
					onCollapseAll={() => {
						setExpansionPreference("custom");
						setExpandedRows({ goalIds: new Set(), missionIds: new Set() });
					}}
					onToggleGoal={toggleExpandedGoal}
					onToggleMission={toggleExpandedMission}
					onToggleSelected={(candidateId) =>
						setSelectedCandidateIds((current) =>
							current.includes(candidateId)
								? current.filter((id) => id !== candidateId)
								: [...current, candidateId],
						)
					}
					onOpenGoal={(goal) => {
						if (goal) setDetailModal({ kind: "goal", id: goal.id });
					}}
					onOpenMission={(mission) =>
						setDetailModal({ kind: "mission", id: mission.id })
					}
					onOpenCandidate={(candidate) =>
						setDetailModal({ kind: "task_candidate", id: candidate.id })
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
						void runAction("goal:save", async () => {
							await readJsonResponse(
								await updateMissionGoal(repositoryId, goal.id, {
									active: !goal.active,
								}),
							);
						})
					}
					onDeleteGoal={(goal) =>
						void runAction("goal:delete", async () => {
							await readJsonResponse(
								await deleteMissionGoal(repositoryId, goal.id),
							);
							if (detailModal?.kind === "goal" && detailModal.id === goal.id)
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
							if (
								detailModal?.kind === "mission" &&
								detailModal.id === mission.id
							)
								setDetailModal(null);
						})
					}
					onCreateCandidate={(candidate) =>
						void runAction("candidate:create-tasks", async () => {
							await createTasksFromUnifiedCandidates([candidate]);
							setSelectedCandidateIds((current) =>
								current.filter((id) => id !== candidate.id),
							);
						})
					}
					onDismissCandidate={(candidate) =>
						void dismissUnifiedCandidate(candidate)
					}
				/>
			</section>
			{goalDraft ? (
				<GoalEditorDialog
					draft={goalDraft}
					busy={busyAction === "goal:save"}
					stackProfile={stackProfile}
					onChange={setGoalDraft}
					onClose={() => setGoalDraft(null)}
					onSave={saveGoalDraft}
				/>
			) : null}
			{detailGoal ? (
				<GoalDetailModal
					goal={detailGoal}
					missionCount={countMissionsForGoal(missions, detailGoal.id)}
					candidateCount={
						unifiedTaskCandidates.filter(
							(candidate) =>
								!candidate.missionId && candidate.goalId === detailGoal.id,
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
						void runAction("goal:save", async () => {
							await readJsonResponse(
								await updateMissionGoal(repositoryId, goal.id, {
									active: !goal.active,
								}),
							);
						})
					}
					onDelete={(goal) =>
						void runAction("goal:delete", async () => {
							await readJsonResponse(
								await deleteMissionGoal(repositoryId, goal.id),
							);
							setDetailModal(null);
						})
					}
					onGenerateTaskCandidates={(goal) =>
						void runAction(
							`goal:generate-task-candidates:${goal.id}`,
							async () => {
								await requestTaskCandidateGeneration([goal.id]);
								setExpandedRows((current) => ({
									...current,
									goalIds: new Set([...current.goalIds, goal.id]),
								}));
							},
						)
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
						void runAction("candidate:create-tasks", async () => {
							await createTasksFromUnifiedCandidates([candidate]);
							setSelectedCandidateIds((current) =>
								current.filter((id) => id !== candidate.id),
							);
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
						unifiedTaskCandidates.filter(
							(candidate) => candidate.missionId === detailMission.id,
						).length
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
		</>
	);
}
