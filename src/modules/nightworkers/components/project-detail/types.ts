import type { Mission } from "../../../../../shared/schemas/mission-planner.schema";
import type {
	MissionGoal,
	MissionTaskCandidate,
} from "../../../../../shared/schemas/project-detail.schema";
import type { Repository, Task, WorkbenchSessionView } from "../../types";

export type ProjectDetailScreenProps = {
	project: Repository;
	sessionViews: WorkbenchSessionView[];
	activeTab: ProjectDetailTab;
	onActiveTabChange: (tab: ProjectDetailTab) => void;
	onOpenSession: (sessionId: string) => void;
	onEvaluationTasksCreated?: (tasks: Task[]) => Promise<void> | void;
};

export type ProjectDetailTab =
	| "overview"
	| "mission"
	| "evaluation"
	| "quality"
	| "stack";

export const projectDetailTabs = [
	{ id: "overview", labelKey: "projectDetail.tab.overview" },
	{ id: "mission", labelKey: "projectDetail.tab.mission" },
	{ id: "evaluation", labelKey: "projectDetail.tab.evaluation" },
	{ id: "quality", labelKey: "projectDetail.tab.quality" },
	{ id: "stack", labelKey: "projectDetail.tab.stack" },
] satisfies { id: ProjectDetailTab; labelKey: string }[];

export type ModelUsageRow = {
	model: string;
	role: string;
	calls: number;
	tokens: number;
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	reasoningOutputTokens: number;
	outputTokensPerSecond: number | null;
	cost: string;
};
export type TopTokenTaskRow = {
	title: string;
	phase: string;
	tokens: number;
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	reasoningOutputTokens: number;
	outputTokensPerSecond: number | null;
	cost: string;
	sessionId?: string;
};
export type CoverageAxis = { labelKey: string; value: number };
export type CandidateRowSource =
	| "mission_task_candidate"
	| "mission_task_proposal";
export type TaskCandidateOrigin = "goal_generation" | "mission_decomposition";
export type TaskCandidateSourceRef =
	| { source: "mission_task_candidate"; id: string }
	| { source: "mission_task_proposal"; id: string };
export type UnifiedTaskCandidateStatus =
	| "candidate"
	| "task_created"
	| "dismissed";
export type UnifiedTaskCandidate = {
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
	candidateKind: MissionTaskCandidate["candidateKind"];
	moduleRouting: MissionTaskCandidate["moduleRouting"];
	constraintGoalIds: string[];
	planModeOpenQuestions: string[];
	tokenSize: string | null;
	complexity: string | null;
	taskPrompt: string;
	acceptanceCriteria: string;
	verificationPlan: string;
	status: UnifiedTaskCandidateStatus;
	taskId: string | null;
	createdAt: string | Date;
};
export type TaskGenerationTreeRow =
	| {
			kind: "goal";
			id: string;
			depth: 0;
			goal: MissionGoal | null;
			childCounts: { missions: number; taskCandidates: number };
	  }
	| {
			kind: "mission";
			id: string;
			depth: 1;
			parentGoalId: string;
			mission: Mission;
			childCounts: { taskCandidates: number };
	  }
	| {
			kind: "task_candidate";
			id: string;
			depth: 1 | 2;
			parentGoalId: string | null;
			parentMissionId: string | null;
			candidate: UnifiedTaskCandidate;
	  };
export type ExpandedState = {
	goalIds: Set<string>;
	missionIds: Set<string>;
};
export type DetailModalState =
	| { kind: "goal"; id: string }
	| { kind: "mission"; id: string }
	| { kind: "task_candidate"; id: string }
	| null;
export type E2EResultRow = {
	suite: string;
	status: string;
	tests: string;
	duration: string;
	lastFailure: string;
};
export type GoalDraft = {
	id?: string;
	title: string;
	goalText: string;
	active: boolean;
};
