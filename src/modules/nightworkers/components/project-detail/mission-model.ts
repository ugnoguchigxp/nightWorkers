import {
	type MissionGoalTemplate,
	missionGoalTemplates,
} from "../../../../../shared/mission-goal-templates";
import type {
	Mission,
	MissionTaskProposal,
} from "../../../../../shared/schemas/mission-planner.schema";
import type {
	MissionGoal,
	MissionTaskCandidate,
} from "../../../../../shared/schemas/project-detail.schema";
import type {
	CandidateRowSource,
	ExpandedState,
	GoalDraft,
	TaskGenerationTreeRow,
	UnifiedTaskCandidate,
	UnifiedTaskCandidateStatus,
} from "./types";

function candidateRowId(source: CandidateRowSource, id: string) {
	return `${source}:${id}`;
}

export const unassignedGoalId = "__unassigned__";

function normalizeCandidateStatus(
	status: MissionTaskCandidate["status"],
): UnifiedTaskCandidateStatus {
	if (status === "task_created" || status === "dismissed") return status;
	return "candidate";
}

function normalizeProposalStatus(
	status: MissionTaskProposal["status"],
): UnifiedTaskCandidateStatus {
	if (status === "task_created" || status === "dismissed") return status;
	return "candidate";
}

function toTimestamp(value: string | Date) {
	const timestamp =
		value instanceof Date ? value.getTime() : new Date(value).getTime();
	return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareNewestFirst(
	a: { createdAt: string | Date },
	b: { createdAt: string | Date },
) {
	return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
}

function taskCandidateKindPriority(
	kind: MissionTaskCandidate["candidateKind"],
) {
	switch (kind) {
		case "feature_entrypoint":
			return 0;
		case "investigation":
			return 1;
		case "feature_followup":
			return 2;
		case "constraint_enablement":
			return 3;
		case "constraint_verification":
			return 4;
	}
}

function compareTaskCandidates(
	a: UnifiedTaskCandidate,
	b: UnifiedTaskCandidate,
) {
	const priorityDelta =
		taskCandidateKindPriority(a.candidateKind) -
		taskCandidateKindPriority(b.candidateKind);
	if (priorityDelta !== 0) return priorityDelta;
	return compareNewestFirst(a, b);
}

export function isMissionDeleteInProgress(status: Mission["status"]) {
	return status === "decomposing" || status === "evaluating";
}

export function buildUnifiedTaskCandidates(
	candidates: MissionTaskCandidate[],
	proposals: MissionTaskProposal[],
): UnifiedTaskCandidate[] {
	return [
		...candidates.map(
			(candidate): UnifiedTaskCandidate => ({
				id: candidateRowId("mission_task_candidate", candidate.id),
				repositoryId: candidate.repositoryId,
				goalId: candidate.goalId,
				goalTitle: candidate.goalTitle ?? null,
				missionId: null,
				origin: "goal_generation",
				sourceRef: { source: "mission_task_candidate", id: candidate.id },
				title: candidate.title,
				summary: candidate.summary,
				rationale: candidate.rationale,
				evidence: candidate.evidence,
				evaluationContribution: candidate.evaluationContribution,
				importancePercent: candidate.importancePercent,
				confidencePercent: candidate.confidencePercent,
				candidateKind: candidate.candidateKind,
				moduleRouting: candidate.moduleRouting,
				constraintGoalIds: candidate.constraintGoalIds,
				planModeOpenQuestions: candidate.planModeOpenQuestions,
				tokenSize: candidate.tokenSize,
				complexity: candidate.complexity,
				taskPrompt: candidate.taskPrompt,
				acceptanceCriteria: candidate.acceptanceCriteria,
				verificationPlan: candidate.verificationPlan,
				status: normalizeCandidateStatus(candidate.status),
				taskId: candidate.taskId,
				createdAt: candidate.createdAt,
			}),
		),
		...proposals.map(
			(proposal): UnifiedTaskCandidate => ({
				id: candidateRowId("mission_task_proposal", proposal.id),
				repositoryId: proposal.repositoryId,
				goalId: null,
				goalTitle: null,
				missionId: proposal.missionId,
				origin: "mission_decomposition",
				sourceRef: { source: "mission_task_proposal", id: proposal.id },
				title: proposal.title,
				summary: proposal.summary,
				rationale: proposal.expectedOutcome,
				evidence: proposal.targetFilesOrModules.map((path) => ({
					source: "mission_decomposition",
					label: "Target",
					value: path,
				})),
				evaluationContribution: null,
				importancePercent: null,
				confidencePercent: null,
				candidateKind: "feature_followup",
				moduleRouting: {
					primaryModule: null,
					secondaryModules: [],
					confidencePercent: 0,
					reason: null,
				},
				constraintGoalIds: [],
				planModeOpenQuestions: [],
				tokenSize: null,
				complexity: null,
				taskPrompt: proposal.initialPrompt,
				acceptanceCriteria: proposal.acceptanceCriteria.join("\n"),
				verificationPlan: proposal.verificationGate.join("\n"),
				status: normalizeProposalStatus(proposal.status),
				taskId: proposal.taskId,
				createdAt: proposal.createdAt,
			}),
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
		pushToMap(
			missionsByGoal,
			mission.sourceGoalIds[0] ?? unassignedGoalId,
			mission,
		);
	}
	for (const candidate of candidates) {
		if (candidate.missionId) {
			pushToMap(candidatesByMission, candidate.missionId, candidate);
		} else {
			pushToMap(
				candidatesByGoal,
				candidate.goalId ?? unassignedGoalId,
				candidate,
			);
		}
	}

	const sortedGoals = [...goals].sort(
		(a, b) =>
			a.sortOrder - b.sortOrder ||
			toTimestamp(a.createdAt) - toTimestamp(b.createdAt),
	);

	const pushGoalGroup = (goal: MissionGoal | null) => {
		const goalId = goal?.id ?? unassignedGoalId;
		const goalMissions = [...(missionsByGoal.get(goalId) ?? [])].sort(
			compareNewestFirst,
		);
		const goalCandidates = [...(candidatesByGoal.get(goalId) ?? [])].sort(
			compareTaskCandidates,
		);
		rows.push({
			kind: "goal",
			id: goalId,
			depth: 0,
			goal,
			childCounts: {
				missions: goalMissions.length,
				taskCandidates: goalCandidates.length,
			},
		});
		if (!expanded.goalIds.has(goalId)) return;
		for (const mission of goalMissions) {
			const missionCandidates = [
				...(candidatesByMission.get(mission.id) ?? []),
			].sort(compareTaskCandidates);
			rows.push({
				kind: "mission",
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
							kind: "task_candidate",
							id: candidate.id,
							depth: 2,
							parentGoalId: goalId,
							parentMissionId: mission.id,
							candidate,
						}),
					),
				);
			}
		}
		rows.push(
			...goalCandidates.map(
				(candidate): TaskGenerationTreeRow => ({
					kind: "task_candidate",
					id: candidate.id,
					depth: 1,
					parentGoalId: goalId === unassignedGoalId ? null : goalId,
					parentMissionId: null,
					candidate,
				}),
			),
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

export function buildExpandedTaskGenerationState({
	goals,
	missions,
	candidates,
}: {
	goals: MissionGoal[];
	missions: Mission[];
	candidates: UnifiedTaskCandidate[];
}): ExpandedState {
	const goalIds = new Set<string>();
	const missionIds = new Set<string>();

	for (const goal of goals) {
		const hasChildren =
			missions.some((mission) => mission.sourceGoalIds[0] === goal.id) ||
			candidates.some(
				(candidate) => !candidate.missionId && candidate.goalId === goal.id,
			);
		if (hasChildren) goalIds.add(goal.id);
	}

	const hasUnassigned =
		missions.some((mission) => mission.sourceGoalIds.length === 0) ||
		candidates.some((candidate) => !candidate.missionId && !candidate.goalId);
	if (hasUnassigned) goalIds.add(unassignedGoalId);

	for (const mission of missions) {
		if (candidates.some((candidate) => candidate.missionId === mission.id)) {
			missionIds.add(mission.id);
		}
	}

	return { goalIds, missionIds };
}

export function pruneExpandedTaskGenerationState({
	expanded,
	goals,
	missions,
}: {
	expanded: ExpandedState;
	goals: MissionGoal[];
	missions: Mission[];
}): ExpandedState {
	const goalIds = new Set(goals.map((goal) => goal.id));
	const missionIds = new Set(missions.map((mission) => mission.id));
	return {
		goalIds: new Set(
			[...expanded.goalIds].filter(
				(id) => id === unassignedGoalId || goalIds.has(id),
			),
		),
		missionIds: new Set(
			[...expanded.missionIds].filter((id) => missionIds.has(id)),
		),
	};
}

export function applyMissionGoalTemplate(
	draft: GoalDraft,
	template: MissionGoalTemplate,
): GoalDraft {
	const titleMatchesTemplate = missionGoalTemplates.some(
		(item) => item.title === draft.title,
	);
	return {
		...draft,
		title:
			draft.title.trim() && !titleMatchesTemplate
				? draft.title
				: template.title,
		goalText: template.goalText,
	};
}

export function toggleMissionGoalTemplate(
	draft: GoalDraft,
	template: MissionGoalTemplate,
): GoalDraft {
	if (draft.goalText !== template.goalText)
		return applyMissionGoalTemplate(draft, template);
	return {
		...draft,
		title: draft.title === template.title ? "" : draft.title,
		goalText: "",
	};
}
