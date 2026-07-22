import type {
	Mission,
	MissionDecompositionPlanningResult,
	MissionDeterministicCheckReport,
} from "../../../shared/schemas/mission-planner.schema";
import type {
	MissionGoal,
	ProjectSignalSnapshot,
} from "../../../shared/schemas/task-generation.schema";
import { p } from "../../systemContexts/catalog";
import type { buildTaskGenerationSystemContext } from "../taskGeneration/task-generation-prompt-context";

export function buildMissionPlannerInputBundle(input: {
	mission: Mission;
	sourceGoals: MissionGoal[];
	signal: ProjectSignalSnapshot;
	contextStillGuardrails?: unknown;
}) {
	return {
		schemaVersion: "nightworkers.mission-planner-input/v1",
		mission: {
			id: input.mission.id,
			title: input.mission.title,
			goalText: input.mission.goalText,
			nonGoals: input.mission.nonGoals,
			sourceGoalIds: input.mission.sourceGoalIds,
		},
		sourceGoals: input.sourceGoals.map((goal) => ({
			id: goal.id,
			title: goal.title,
			goalText: goal.goalText,
			active: goal.active,
		})),
		projectSignalSnapshot: input.signal,
		contextStillGuardrails: input.contextStillGuardrails ?? null,
		createdAt: new Date().toISOString(),
	};
}

export function buildMissionDraftSystemPrompt() {
	return p("missionPlanner.draft", {});
}

export function buildMissionDraftUserPrompt(input: { inputBundle: unknown }) {
	return JSON.stringify(
		{
			instruction:
				"Mission draft を作成してください。blockingClarification が true の場合は task decomposition に進めません。",
			requiredOutput: {
				schemaVersion: "nightworkers.mission-draft/v1",
				mission: { title: "string", goal: "string", nonGoals: ["string"] },
				blockingClarification: "boolean",
				clarificationQuestions: ["string"],
				riskNotes: ["string"],
			},
			inputBundle: input.inputBundle,
		},
		null,
		2,
	);
}

export function buildMissionCandidatesSystemPrompt() {
	return p("missionPlanner.candidates", {});
}

export function buildMissionCandidatesUserPrompt(input: {
	inputBundle: unknown;
	existingMissions: Array<{ id: string; title: string; status: string }>;
}) {
	return JSON.stringify(
		{
			instruction:
				"Mission 候補を作成してください。既存 Mission と title が重なる候補は返さないでください。",
			requiredOutput: {
				schemaVersion: "nightworkers.mission-candidates/v1",
				candidates: [
					{
						title: "string",
						goalText: "string",
						nonGoals: ["string"],
						sourceGoalIds: ["MissionGoal.id"],
						rationale: "string",
					},
				],
			},
			generationRules: [
				"Mission は Goal の言い換えではなく、Goal 達成に向けた中間目標または workflow 単位にする。",
				"Task まで細かくしない。Task proposal は後続の分解で作る。",
				"sourceGoalIds は必ず1件以上入れ、inputBundle.sourceGoals に含まれる id だけを使う。",
				"Goal 本体の実装状態は projectSignalSnapshot.repositorySnapshot から判断する。",
				"根拠が薄い場合は、大きすぎる Mission を作らず、確認しやすい候補へ分割する。",
			],
			existingMissions: input.existingMissions,
			inputBundle: input.inputBundle,
		},
		null,
		2,
	);
}

export function buildMissionPlansSystemPrompt(
	generationContext: ReturnType<typeof buildTaskGenerationSystemContext>,
) {
	return p("missionPlanner.plans", { generationContext });
}

export function buildMissionPlansUserPrompt(input: {
	inputBundle: unknown;
	existingMissions: Array<{
		id: string;
		title: string;
		status: string;
		hasTaskCandidates: boolean;
	}>;
	existingTaskTitles: string[];
}) {
	return JSON.stringify(
		{
			instruction:
				"Mission と、各 Mission に属する Task Candidate を同時に生成してください。Mission だけを返してはいけません。",
			requiredOutput: "nightworkers.mission-plans/v1",
			generationRules: [
				"各 plan の mission を Mission として保存する。",
				"各 Mission に taskCandidates を1件以上含める。",
				"sourceGoalIds は inputBundle.sourceGoals に含まれる id だけを使う。",
				"不明点は候補生成の停止理由にせず、Task Candidate の Plan Mode で確認する事項として書く。",
				"existingMissions に同名 Mission があっても hasTaskCandidates が false なら、その Mission を候補付きに回復する plan を返してよい。",
				"hasTaskCandidates が true の既存 Mission と同じ title の plan は返さない。",
				"initialPrompt には目的、対象範囲、非目標、実装方針、完了条件、検証、注意点を含める。",
			],
			existingMissions: input.existingMissions,
			existingTaskTitles: input.existingTaskTitles,
			inputBundle: input.inputBundle,
		},
		null,
		2,
	);
}

export function buildMissionStructureSystemPrompt() {
	return p("missionPlanner.structure", {});
}

export function buildMissionStructureUserPrompt(input: {
	missionDraft: unknown;
	inputBundle: unknown;
}) {
	return JSON.stringify(
		{
			instruction:
				"Mission draft と repository signal から structure decomposition を作成してください。",
			requiredOutput: {
				schemaVersion: "nightworkers.mission-structure/v1",
				objectives: ["MissionDecompositionPlanningResult.objectives item"],
				workPackages: ["MissionDecompositionPlanningResult.workPackages item"],
				replanningUnits: [
					"MissionDecompositionPlanningResult.replanningUnits item",
				],
			},
			missionDraft: input.missionDraft,
			inputBundle: input.inputBundle,
		},
		null,
		2,
	);
}

export function buildMissionTaskProposalsSystemPrompt() {
	return p("missionPlanner.task-proposals", {});
}

export function buildMissionTaskProposalsUserPrompt(input: {
	missionDraft: unknown;
	structure: unknown;
	inputBundle: unknown;
	existingTaskTitles: string[];
}) {
	return JSON.stringify(
		{
			instruction:
				"Task proposals を作成してください。既存 Task title と重複しないようにしてください。",
			requiredOutput: {
				schemaVersion: "nightworkers.mission-task-proposals/v1",
				taskProposals: [
					"MissionDecompositionPlanningResult.taskProposals item",
				],
			},
			missionDraft: input.missionDraft,
			structure: input.structure,
			inputBundle: input.inputBundle,
			existingTaskTitles: input.existingTaskTitles,
		},
		null,
		2,
	);
}

export function buildMissionEvaluationSystemPrompt() {
	return p("missionPlanner.evaluation", {});
}

export function buildMissionEvaluationUserPrompt(input: {
	mission: Mission;
	planningResult: MissionDecompositionPlanningResult;
	deterministicChecks: MissionDeterministicCheckReport;
	signal: ProjectSignalSnapshot;
	existingTaskTitles: string[];
}) {
	return JSON.stringify(
		{
			instruction: "Mission Decomposition Evaluation を返してください。",
			mission: input.mission,
			planningResult: input.planningResult,
			deterministicChecks: input.deterministicChecks,
			projectSignalSnapshot: input.signal,
			existingTaskTitles: input.existingTaskTitles,
			requiredOutput: "nightworkers.mission-decomposition-evaluation/v1",
		},
		null,
		2,
	);
}
