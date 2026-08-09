import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	decomposeMission,
	deleteMission,
	dismissTaskProposal,
	evaluatePlanningResult,
	getMissionDetail,
	listMissions,
	listPlanningResults,
	listRepositoryTaskProposals,
	listTaskProposals,
	requestPlanningRevision,
} from "../api/modules/mission-planner/mission-planner.service";

const mocks = vi.hoisted(() => {
	const state = {
		plannerCalls: [] as Array<
			| {
					parsed: Record<string, unknown>;
					rawOutput: unknown;
					selectedModel: Record<string, unknown>;
					selection?: Record<string, unknown>;
					invokeSelection?: boolean;
			  }
			| { error: unknown }
		>,
		existingTaskRows: [] as Array<{ title: string }>,
	};
	const getRepository = vi.fn();
	const listMissionGoals = vi.fn();
	const buildSignal = vi.fn();
	const buildInputBundle = vi.fn();
	const getMission = vi.fn();
	const listMissions = vi.fn();
	const deleteMission = vi.fn();
	const hasOpenProposals = vi.fn();
	const getPlanningResult = vi.fn();
	const listTaskProposals = vi.fn();
	const listTaskProposalsForMission = vi.fn();
	const listActiveResults = vi.fn();
	const updateMission = vi.fn();
	const createRun = vi.fn();
	const updateRun = vi.fn();
	const createPlanningResult = vi.fn();
	const updatePlanningResult = vi.fn();
	const getRun = vi.fn();
	const listPlanningResults = vi.fn();
	const listRepositoryProposals = vi.fn();
	const getTaskProposal = vi.fn();
	const updateTaskProposal = vi.fn();
	const evaluate = vi.fn();
	const validate = vi.fn();
	const persistProposals = vi.fn();

	const callPlanner = vi.fn(
		async (input: { onSelection?: (selection: unknown) => void }) => {
			const next = state.plannerCalls.shift();
			if (!next) throw new Error("No planner call queued");
			if ("error" in next) throw next.error;
			if (next.invokeSelection) {
				input.onSelection?.(next.selection ?? next.selectedModel);
			}
			return next;
		},
	);

	const selectWhere = vi.fn(async () => state.existingTaskRows);
	const selectFrom = vi.fn(() => ({ where: selectWhere }));
	const db = {
		select: vi.fn(() => ({ from: selectFrom })),
		transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
			callback({ id: "tx" }),
		),
	};

	return {
		state,
		db,
		getRepository,
		listMissionGoals,
		buildSignal,
		buildInputBundle,
		getMission,
		listMissions,
		deleteMission,
		hasOpenProposals,
		getPlanningResult,
		listTaskProposals,
		listTaskProposalsForMission,
		listActiveResults,
		updateMission,
		createRun,
		updateRun,
		createPlanningResult,
		updatePlanningResult,
		getRun,
		listPlanningResults,
		listRepositoryProposals,
		getTaskProposal,
		updateTaskProposal,
		callPlanner,
		evaluate,
		validate,
		persistProposals,
		selectWhere,
	};
});

vi.mock("../api/db/client", () => ({ db: mocks.db }));
vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getRepository: mocks.getRepository,
}));
vi.mock("../api/modules/taskGeneration/task-generation.repository", () => ({
	listMissionGoals: mocks.listMissionGoals,
}));
vi.mock("../api/modules/taskGeneration/task-generation-signal.service", () => ({
	buildProjectSignalSnapshot: mocks.buildSignal,
}));
vi.mock("../api/modules/mission-planner/mission-planner.prompts", () => ({
	buildMissionDraftSystemPrompt: vi.fn(() => "draft-system"),
	buildMissionDraftUserPrompt: vi.fn(() => "draft-user"),
	buildMissionPlannerInputBundle: mocks.buildInputBundle,
	buildMissionStructureSystemPrompt: vi.fn(() => "structure-system"),
	buildMissionStructureUserPrompt: vi.fn(() => "structure-user"),
	buildMissionTaskProposalsSystemPrompt: vi.fn(() => "tasks-system"),
	buildMissionTaskProposalsUserPrompt: vi.fn(() => "tasks-user"),
}));
vi.mock("../api/modules/mission-planner/mission-planner.repository", () => ({
	getMission: mocks.getMission,
	listMissions: mocks.listMissions,
	deleteMission: mocks.deleteMission,
	hasOpenTaskProposalsForMission: mocks.hasOpenProposals,
	getPlanningResult: mocks.getPlanningResult,
	listTaskProposals: mocks.listTaskProposals,
	listTaskProposalsForMission: mocks.listTaskProposalsForMission,
	listActivePlanningResultsForMission: mocks.listActiveResults,
	updateMission: mocks.updateMission,
	createRunningDecompositionRun: mocks.createRun,
	updateDecompositionRun: mocks.updateRun,
	createPlanningResult: mocks.createPlanningResult,
	updatePlanningResult: mocks.updatePlanningResult,
	getDecompositionRun: mocks.getRun,
	listPlanningResults: mocks.listPlanningResults,
	listRepositoryTaskProposals: mocks.listRepositoryProposals,
	getTaskProposal: mocks.getTaskProposal,
	updateTaskProposal: mocks.updateTaskProposal,
}));
vi.mock(
	"../api/modules/mission-planner/mission-planner-evaluation.service",
	() => ({
		callMissionPlannerJson: mocks.callPlanner,
		evaluateMissionDecomposition: mocks.evaluate,
	}),
);
vi.mock(
	"../api/modules/mission-planner/mission-planner-persistence.service",
	() => ({
		persistReviewPendingProposals: mocks.persistProposals,
	}),
);
vi.mock("../api/modules/mission-planner/mission-planner-validation", () => ({
	validateMissionPlanningResult: mocks.validate,
}));
vi.mock(
	"../api/modules/mission-planner/mission-planner-generation.service",
	() => ({
		missionDraftSchema: { name: "missionDraftSchema" },
		missionStructureSchema: { name: "missionStructureSchema" },
		missionTaskProposalsStageSchema: {
			name: "missionTaskProposalsStageSchema",
		},
		createMission: vi.fn(),
		generateMissionCandidatesFromGoals: vi.fn(),
		generateMissionPlansFromGoals: vi.fn(),
	}),
);
vi.mock(
	"../api/modules/mission-planner/mission-planner-proposal-materialization.service",
	() => ({ createTasksFromMissionTaskProposals: vi.fn() }),
);

beforeEach(() => {
	vi.clearAllMocks();
	mocks.state.plannerCalls.length = 0;
	mocks.state.existingTaskRows = [{ title: "Existing task" }];
	mocks.getRepository.mockResolvedValue(repository());
	mocks.listMissionGoals.mockResolvedValue([
		{ id: "goal-selected", active: false },
		{ id: "goal-active", active: true },
		{ id: "goal-inactive", active: false },
	]);
	mocks.buildSignal.mockResolvedValue({ version: 1, source: "signal" });
	mocks.buildInputBundle.mockImplementation((input) => ({
		missionId: input.mission.id,
		projectSignalSnapshot: input.signal,
		goals: input.sourceGoals,
	}));
	mocks.getMission.mockResolvedValue(mission());
	mocks.listMissions.mockResolvedValue([mission()]);
	mocks.deleteMission.mockResolvedValue(mission());
	mocks.hasOpenProposals.mockResolvedValue(false);
	mocks.getPlanningResult.mockResolvedValue(planningResult());
	mocks.listTaskProposals.mockResolvedValue([{ id: "proposal-1" }]);
	mocks.listTaskProposalsForMission.mockResolvedValue([
		{ id: "mission-proposal" },
	]);
	mocks.listActiveResults.mockResolvedValue([]);
	mocks.updateMission.mockImplementation(async (_id, update) => ({
		...mission(),
		...update,
	}));
	mocks.createRun.mockResolvedValue(decompositionRun());
	mocks.updateRun.mockResolvedValue(decompositionRun());
	mocks.createPlanningResult.mockResolvedValue(planningResult());
	mocks.updatePlanningResult.mockImplementation(async (_id, update) => ({
		...planningResult(),
		...update,
	}));
	mocks.getRun.mockResolvedValue(decompositionRun());
	mocks.listPlanningResults.mockResolvedValue([planningResult()]);
	mocks.listRepositoryProposals.mockResolvedValue([{ id: "proposal-1" }]);
	mocks.getTaskProposal.mockResolvedValue(taskProposal());
	mocks.updateTaskProposal.mockImplementation(async (_id, update) => ({
		...taskProposal(),
		...update,
	}));
	mocks.validate.mockReturnValue(checks("pass"));
	mocks.evaluate.mockResolvedValue(evaluation("review_ready"));
	mocks.persistProposals.mockResolvedValue([]);
});

describe("Mission retrieval, deletion, and detail mapping", () => {
	it("requires an existing repository before listing missions", async () => {
		mocks.getRepository.mockResolvedValueOnce(null);
		await expect(listMissions("missing-repository")).rejects.toMatchObject({
			statusCode: 404,
			message: "Repository not found",
		});
		expect(mocks.listMissions).not.toHaveBeenCalled();
	});

	it("lists missions after repository validation", async () => {
		const rows = [mission(), mission({ id: "mission-2" })];
		mocks.listMissions.mockResolvedValueOnce(rows);
		await expect(listMissions("repository-1")).resolves.toBe(rows);
		expect(mocks.getRepository).toHaveBeenCalledWith("repository-1");
	});

	it("rejects deletion for a missing mission", async () => {
		mocks.getMission.mockResolvedValueOnce(null);
		await expect(deleteMission("missing")).rejects.toMatchObject({
			statusCode: 404,
			message: "Mission not found",
		});
	});

	it.each([
		"decomposing",
		"evaluating",
	])("rejects deletion while mission status is %s", async (status) => {
		mocks.getMission.mockResolvedValueOnce(mission({ status }));
		await expect(deleteMission("mission-1")).rejects.toMatchObject({
			statusCode: 400,
			details: { missionId: "mission-1", status },
		});
		expect(mocks.hasOpenProposals).not.toHaveBeenCalled();
	});

	it("rejects deletion while open task proposals exist", async () => {
		mocks.hasOpenProposals.mockResolvedValueOnce(true);
		await expect(deleteMission("mission-1")).rejects.toMatchObject({
			statusCode: 400,
			details: { missionId: "mission-1" },
		});
		expect(mocks.deleteMission).not.toHaveBeenCalled();
	});

	it("maps a missing delete result to not-found", async () => {
		mocks.deleteMission.mockResolvedValueOnce(null);
		await expect(deleteMission("mission-1")).rejects.toMatchObject({
			statusCode: 404,
		});
	});

	it("returns the deleted mission", async () => {
		const deleted = mission({ status: "draft" });
		mocks.deleteMission.mockResolvedValueOnce(deleted);
		await expect(deleteMission("mission-1")).resolves.toBe(deleted);
	});

	it("rejects missing mission detail", async () => {
		mocks.getMission.mockResolvedValueOnce(null);
		await expect(getMissionDetail("missing")).rejects.toMatchObject({
			statusCode: 404,
		});
	});

	it("loads latest planning result and its proposals", async () => {
		const result = planningResult();
		mocks.getPlanningResult.mockResolvedValueOnce(result);
		const detail = await getMissionDetail("mission-1");
		expect(detail.latestPlanningResult).toBe(result);
		expect(mocks.listTaskProposals).toHaveBeenCalledWith(result.id);
		expect(mocks.listTaskProposalsForMission).not.toHaveBeenCalled();
	});

	it.each([
		["no latest id", mission({ latestPlanningResultId: null })],
		["stale latest id", mission()],
	] as const)("falls back to mission proposals for %s", async (variant, row) => {
		mocks.getMission.mockResolvedValueOnce(row);
		if (variant === "stale latest id") {
			mocks.getPlanningResult.mockResolvedValueOnce(null);
		}
		const detail = await getMissionDetail(row.id);
		expect(detail.latestPlanningResult).toBeNull();
		expect(mocks.listTaskProposalsForMission).toHaveBeenCalledWith(row.id);
	});
});

describe("Mission decomposition", () => {
	it("rejects a missing mission", async () => {
		mocks.getMission.mockResolvedValueOnce(null);
		await expect(
			decomposeMission({ missionId: "missing" }),
		).rejects.toMatchObject({
			statusCode: 404,
		});
	});

	it("rejects a concurrent review-pending result unless forced", async () => {
		mocks.listActiveResults.mockResolvedValueOnce([
			{ status: "draft" },
			{ status: "review_pending" },
		]);
		await expect(
			decomposeMission({ missionId: "mission-1" }),
		).rejects.toMatchObject({
			statusCode: 409,
			code: "MISSION_REVIEW_PENDING",
		});
		expect(mocks.createRun).not.toHaveBeenCalled();
	});

	it("forces decomposition and uses explicitly selected source goals", async () => {
		queuePlannerStages({
			blockingClarification: true,
			questions: ["Need scope?"],
		});
		const row = mission({ sourceGoalIds: ["goal-selected"] });
		mocks.getMission.mockResolvedValue(row);
		const detail = await decomposeMission({ missionId: row.id, force: true });
		expect(mocks.listActiveResults).not.toHaveBeenCalled();
		expect(mocks.buildSignal).toHaveBeenCalledWith({
			repository: repository(),
			goals: [{ id: "goal-selected", active: false }],
		});
		expect(detail.mission.id).toBe(row.id);
		expect(mocks.updateMission).toHaveBeenCalledWith(
			row.id,
			expect.objectContaining({
				status: "needs_clarification",
				statusReason: "Need scope?",
			}),
			expect.any(Object),
		);
	});

	it("uses active goals and null clarification reason when questions are empty", async () => {
		queuePlannerStages({ blockingClarification: true, questions: [] });
		await decomposeMission({ missionId: "mission-1" });
		expect(mocks.buildSignal).toHaveBeenCalledWith({
			repository: repository(),
			goals: [{ id: "goal-active", active: true }],
		});
		expect(mocks.updateMission).toHaveBeenCalledWith(
			"mission-1",
			expect.objectContaining({
				status: "needs_clarification",
				statusReason: null,
			}),
			expect.any(Object),
		);
	});

	it("persists deterministic validation failure without provider evaluation", async () => {
		queuePlannerStages();
		mocks.validate.mockReturnValueOnce(checks("fail"));
		const detail = await decomposeMission({ missionId: "mission-1" });
		expect(mocks.evaluate).not.toHaveBeenCalled();
		expect(mocks.updatePlanningResult).toHaveBeenCalledWith(
			"result-1",
			expect.objectContaining({
				status: "needs_revision",
				statusReason: "Deterministic validation failed.",
			}),
			expect.any(Object),
		);
		expect(detail.mission.id).toBe("mission-1");
	});

	it("persists review-ready proposals and all provider selections", async () => {
		queuePlannerStages({ mixedSelectionCallbacks: true });
		mocks.evaluate.mockResolvedValueOnce(evaluation("review_ready"));
		const detail = await decomposeMission({ missionId: "mission-1" });
		expect(detail.mission.id).toBe("mission-1");
		expect(mocks.persistProposals).toHaveBeenCalledWith(
			expect.objectContaining({
				mission: expect.objectContaining({ id: "mission-1" }),
				planningResult: expect.objectContaining({ status: "review_pending" }),
			}),
			expect.any(Object),
		);
		const selectedModels = mocks.updateRun.mock.calls
			.map((call) => call[1]?.selectedModels)
			.filter(Boolean)
			.at(-1);
		expect(selectedModels).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ stage: "mission_draft" }),
				expect.objectContaining({ stage: "structure" }),
				expect.objectContaining({ stage: "task_proposals" }),
				expect.objectContaining({ stage: "evaluation" }),
			]),
		);
	});

	it.each([
		["needs_human_approval", "review_pending", "review_pending"],
		["needs_clarification", "needs_clarification", "needs_clarification"],
		["blocked", "blocked", "blocked"],
		["unexpected_verdict", "draft", "needs_revision"],
	] as const)("maps %s evaluation to mission=%s and result=%s", async (verdict, missionStatus, resultStatus) => {
		queuePlannerStages();
		mocks.evaluate.mockResolvedValueOnce(evaluation(verdict));
		await decomposeMission({ missionId: "mission-1" });
		expect(mocks.updatePlanningResult).toHaveBeenCalledWith(
			"result-1",
			expect.objectContaining({ status: resultStatus, statusReason: verdict }),
			expect.any(Object),
		);
		expect(mocks.updateMission).toHaveBeenCalledWith(
			"mission-1",
			expect.objectContaining({ status: missionStatus, statusReason: verdict }),
			expect.any(Object),
		);
	});

	it("does not persist proposals when the updated result is absent", async () => {
		queuePlannerStages();
		mocks.updatePlanningResult.mockResolvedValueOnce(null);
		await decomposeMission({ missionId: "mission-1" });
		expect(mocks.persistProposals).not.toHaveBeenCalled();
	});

	it("maps a missing normalized mission to a failed run", async () => {
		queuePlannerStages();
		mocks.updateMission
			.mockResolvedValueOnce(mission({ status: "decomposing" }))
			.mockResolvedValueOnce(null);
		await expect(
			decomposeMission({ missionId: "mission-1" }),
		).rejects.toMatchObject({
			statusCode: 400,
			message: "Mission decomposition failed",
			details: { message: "Mission not found" },
		});
		expect(mocks.updateRun).toHaveBeenCalledWith(
			"run-1",
			expect.objectContaining({
				status: "failed",
				errorMessage: "Mission not found",
			}),
			expect.any(Object),
		);
	});

	it.each([
		["Error", new Error("provider unavailable"), "provider unavailable"],
		["non-Error", "provider offline", "provider offline"],
	] as const)("contains a %s provider failure and blocks the mission", async (_variant, error, message) => {
		mocks.state.plannerCalls.push({ error });
		await expect(
			decomposeMission({ missionId: "mission-1" }),
		).rejects.toMatchObject({
			statusCode: 400,
			details: { message },
		});
		expect(mocks.updateMission).toHaveBeenCalledWith(
			"mission-1",
			{ status: "blocked", statusReason: message },
			expect.any(Object),
		);
	});

	it("contains proposal persistence failures", async () => {
		queuePlannerStages();
		mocks.persistProposals.mockRejectedValueOnce(
			new Error("proposal conflict"),
		);
		await expect(
			decomposeMission({ missionId: "mission-1" }),
		).rejects.toMatchObject({
			statusCode: 400,
			details: { message: "proposal conflict" },
		});
	});

	it("propagates pre-run repository resolution failures", async () => {
		mocks.getRepository.mockResolvedValueOnce(null);
		await expect(
			decomposeMission({ missionId: "mission-1" }),
		).rejects.toMatchObject({
			statusCode: 404,
			message: "Repository not found",
		});
		expect(mocks.createRun).not.toHaveBeenCalled();
	});
});

describe("planning-result evaluation", () => {
	it("rejects a missing planning result", async () => {
		mocks.getPlanningResult.mockResolvedValueOnce(null);
		await expect(evaluatePlanningResult("missing")).rejects.toMatchObject({
			statusCode: 404,
			message: "Mission planning result not found",
		});
	});

	it("rejects a missing mission", async () => {
		mocks.getMission.mockResolvedValueOnce(null);
		await expect(evaluatePlanningResult("result-1")).rejects.toMatchObject({
			statusCode: 404,
			message: "Mission not found",
		});
	});

	it("rejects a missing decomposition run", async () => {
		mocks.getRun.mockResolvedValueOnce(null);
		await expect(evaluatePlanningResult("result-1")).rejects.toMatchObject({
			statusCode: 404,
			message: "Mission decomposition run not found",
		});
	});

	it.each([
		["absent bundle", undefined],
		["absent signal", {}],
		["null signal", { projectSignalSnapshot: null }],
		["primitive signal", { projectSignalSnapshot: "signal" }],
	] as const)("rejects evaluation with %s", async (_variant, inputBundle) => {
		mocks.getRun.mockResolvedValueOnce(decompositionRun({ inputBundle }));
		await expect(evaluatePlanningResult("result-1")).rejects.toMatchObject({
			statusCode: 400,
			message: expect.stringContaining("without input bundle signal"),
		});
		expect(mocks.evaluate).not.toHaveBeenCalled();
	});

	it("uses stored deterministic checks and returns a failed validation update", async () => {
		const failed = checks("fail");
		mocks.getPlanningResult.mockResolvedValueOnce(
			planningResult({ deterministicChecks: failed }),
		);
		const updated = planningResult({
			status: "needs_revision",
			deterministicChecks: failed,
		});
		mocks.updatePlanningResult.mockResolvedValueOnce(updated);
		await expect(evaluatePlanningResult("result-1")).resolves.toBe(updated);
		expect(mocks.validate).not.toHaveBeenCalled();
		expect(mocks.evaluate).not.toHaveBeenCalled();
	});

	it("validates when checks are absent and maps an absent failure update", async () => {
		mocks.validate.mockReturnValueOnce(checks("fail"));
		mocks.updatePlanningResult.mockResolvedValueOnce(null);
		await expect(evaluatePlanningResult("result-1")).rejects.toMatchObject({
			statusCode: 404,
			message: "Mission planning result not found",
		});
		expect(mocks.validate).toHaveBeenCalled();
	});

	it("evaluates, persists retry observation, and creates review proposals", async () => {
		mocks.evaluate.mockResolvedValueOnce(evaluation("needs_human_approval"));
		const updated = planningResult({ status: "review_pending" });
		mocks.updatePlanningResult.mockResolvedValueOnce(updated);
		await expect(evaluatePlanningResult("result-1")).resolves.toBe(updated);
		expect(mocks.evaluate).toHaveBeenCalledWith(
			expect.objectContaining({
				mission: expect.objectContaining({ id: "mission-1" }),
				signal: { version: 1 },
				existingTaskTitles: ["Existing task"],
			}),
		);
		expect(mocks.updateRun).toHaveBeenCalledWith(
			"run-1",
			{
				stageOutputs: expect.objectContaining({
					evaluation: expect.any(Object),
				}),
				selectedModels: expect.arrayContaining([
					expect.objectContaining({ stage: "mission_draft" }),
					expect.objectContaining({ stage: "evaluation" }),
				]),
			},
			expect.any(Object),
		);
		expect(mocks.persistProposals).toHaveBeenCalled();
	});

	it("skips proposal persistence for non-review status", async () => {
		mocks.evaluate.mockResolvedValueOnce(evaluation("blocked"));
		mocks.updatePlanningResult.mockResolvedValueOnce(
			planningResult({ status: "blocked" }),
		);
		await evaluatePlanningResult("result-1");
		expect(mocks.persistProposals).not.toHaveBeenCalled();
	});

	it("rolls back evaluation when the result disappears in the transaction", async () => {
		mocks.updatePlanningResult.mockResolvedValueOnce(null);
		await expect(evaluatePlanningResult("result-1")).rejects.toMatchObject({
			statusCode: 404,
			message: "Mission planning result not found",
		});
		expect(mocks.updateRun).not.toHaveBeenCalled();
	});

	it("propagates evaluation provider exceptions", async () => {
		mocks.evaluate.mockRejectedValueOnce(
			new Error("evaluation provider failed"),
		);
		await expect(evaluatePlanningResult("result-1")).rejects.toThrow(
			"evaluation provider failed",
		);
	});
});

describe("planning-result and proposal updates", () => {
	it("lists planning results for an existing mission", async () => {
		const rows = [planningResult()];
		mocks.listPlanningResults.mockResolvedValueOnce(rows);
		await expect(listPlanningResults("mission-1")).resolves.toBe(rows);
	});

	it("rejects planning-result listing for a missing mission", async () => {
		mocks.getMission.mockResolvedValueOnce(null);
		await expect(listPlanningResults("missing")).rejects.toMatchObject({
			statusCode: 404,
		});
	});

	it("requests a revision and resets the mission to draft", async () => {
		const updated = planningResult({ status: "needs_revision" });
		mocks.updatePlanningResult.mockResolvedValueOnce(updated);
		await expect(
			requestPlanningRevision({
				planningResultId: "result-1",
				reason: "Scope changed",
			}),
		).resolves.toBe(updated);
		expect(mocks.updateMission).toHaveBeenCalledWith("mission-1", {
			status: "draft",
			statusReason: "Scope changed",
		});
	});

	it("rejects revision for a missing or concurrently removed result", async () => {
		mocks.getPlanningResult.mockResolvedValueOnce(null);
		await expect(
			requestPlanningRevision({ planningResultId: "missing", reason: "retry" }),
		).rejects.toMatchObject({ statusCode: 404 });

		mocks.updatePlanningResult.mockResolvedValueOnce(null);
		await expect(
			requestPlanningRevision({
				planningResultId: "result-1",
				reason: "retry",
			}),
		).rejects.toMatchObject({ statusCode: 404 });
		expect(mocks.updateMission).toHaveBeenCalledWith("mission-1", {
			status: "draft",
			statusReason: "retry",
		});
	});

	it("lists proposals for an existing planning result", async () => {
		const rows = [{ id: "proposal-1" }];
		mocks.listTaskProposals.mockResolvedValueOnce(rows);
		await expect(listTaskProposals("result-1")).resolves.toBe(rows);
	});

	it("rejects proposal listing for a missing planning result", async () => {
		mocks.getPlanningResult.mockResolvedValueOnce(null);
		await expect(listTaskProposals("missing")).rejects.toMatchObject({
			statusCode: 404,
		});
	});

	it.each([
		undefined,
		"dismissed",
	])("lists repository proposals with optional status %s", async (status) => {
		const input = { repositoryId: "repository-1", status };
		await expect(listRepositoryTaskProposals(input)).resolves.toEqual([
			{ id: "proposal-1" },
		]);
		expect(mocks.listRepositoryProposals).toHaveBeenCalledWith(input);
	});

	it("rejects repository proposal listing for a missing repository", async () => {
		mocks.getRepository.mockResolvedValueOnce(null);
		await expect(
			listRepositoryTaskProposals({ repositoryId: "missing" }),
		).rejects.toMatchObject({ statusCode: 404 });
	});

	it("dismisses a proposed task candidate", async () => {
		const dismissed = taskProposal({ status: "dismissed" });
		mocks.updateTaskProposal.mockResolvedValueOnce(dismissed);
		await expect(dismissTaskProposal("proposal-1")).resolves.toBe(dismissed);
		expect(mocks.updateTaskProposal).toHaveBeenCalledWith("proposal-1", {
			status: "dismissed",
		});
	});

	it("rejects missing, task-created, and concurrently removed proposals", async () => {
		mocks.getTaskProposal.mockResolvedValueOnce(null);
		await expect(dismissTaskProposal("missing")).rejects.toMatchObject({
			statusCode: 404,
		});

		mocks.getTaskProposal.mockResolvedValueOnce(
			taskProposal({ status: "task_created" }),
		);
		await expect(dismissTaskProposal("proposal-1")).rejects.toMatchObject({
			statusCode: 400,
			message: "Task-created proposals cannot be dismissed",
		});

		mocks.updateTaskProposal.mockResolvedValueOnce(null);
		await expect(dismissTaskProposal("proposal-1")).rejects.toMatchObject({
			statusCode: 404,
		});
	});

	it("propagates repository exceptions", async () => {
		mocks.listPlanningResults.mockRejectedValueOnce(
			new Error("database offline"),
		);
		await expect(listPlanningResults("mission-1")).rejects.toThrow(
			"database offline",
		);
	});
});

function repository() {
	return { id: "repository-1", name: "Repository", localPath: "/repo" };
}

function mission(overrides: Record<string, unknown> = {}) {
	return {
		id: "mission-1",
		repositoryId: "repository-1",
		title: "Mission",
		goalText: "Improve reliability",
		nonGoals: [],
		status: "draft",
		sourceGoalIds: [],
		latestPlanningResultId: "result-1",
		statusReason: null,
		...overrides,
	};
}

function planningResult(overrides: Record<string, unknown> = {}) {
	return {
		id: "result-1",
		missionId: "mission-1",
		repositoryId: "repository-1",
		decompositionRunId: "run-1",
		status: "draft",
		planningResult: planningResultJson(),
		deterministicChecks: null,
		evaluation: null,
		statusReason: null,
		...overrides,
	};
}

function decompositionRun(overrides: Record<string, unknown> = {}) {
	return {
		id: "run-1",
		missionId: "mission-1",
		repositoryId: "repository-1",
		status: "running",
		inputBundle: { projectSignalSnapshot: { version: 1 } },
		stageOutputs: { missionDraft: { draft: true } },
		selectedModels: [selection("mission_draft")],
		...overrides,
	};
}

function taskProposal(overrides: Record<string, unknown> = {}) {
	return { id: "proposal-1", status: "proposed", ...overrides };
}

function selection(stage: string) {
	return {
		stage,
		providerId: "fixture",
		providerEndpointId: "fixture-endpoint",
		model: `${stage}-model`,
		source: "primary",
	};
}

function checks(status: "pass" | "fail") {
	return { status, checks: [{ key: "fixture", status }] };
}

function evaluation(verdict: string) {
	return {
		parsed: {
			schemaVersion: "nightworkers.mission-decomposition-evaluation/v1",
			verdict,
			confidence: "high",
			dimensions: [],
			courseCorrections: [],
		},
		rawOutput: { verdict },
		selectedModel: selection("evaluation"),
	};
}

function queuePlannerStages(
	input: {
		blockingClarification?: boolean;
		questions?: string[];
		mixedSelectionCallbacks?: boolean;
	} = {},
) {
	const result = planningResultJson();
	mocks.state.plannerCalls.push({
		parsed: {
			schemaVersion: "nightworkers.mission-draft/v1",
			mission: result.mission,
			blockingClarification: input.blockingClarification ?? false,
			clarificationQuestions: input.questions ?? [],
			riskNotes: [],
		},
		rawOutput: { stage: "draft" },
		selectedModel: selection("mission_draft"),
		invokeSelection: input.mixedSelectionCallbacks,
	});
	if (input.blockingClarification) return;
	mocks.state.plannerCalls.push(
		{
			parsed: {
				schemaVersion: "nightworkers.mission-structure/v1",
				objectives: result.objectives,
				workPackages: result.workPackages,
				replanningUnits: result.replanningUnits,
			},
			rawOutput: { stage: "structure" },
			selectedModel: selection("structure"),
			invokeSelection: input.mixedSelectionCallbacks,
		},
		{
			parsed: {
				schemaVersion: "nightworkers.mission-task-proposals/v1",
				taskProposals: result.taskProposals,
			},
			rawOutput: { stage: "task_proposals" },
			selectedModel: selection("task_proposals"),
			invokeSelection: input.mixedSelectionCallbacks,
		},
	);
}

function planningResultJson() {
	return {
		schemaVersion: "nightworkers.mission-decomposition-result/v1",
		mission: {
			title: "Reliability mission",
			goal: "Improve queue reliability.",
			nonGoals: ["Do not replace the queue."],
		},
		objectives: [
			{
				id: "objective-1",
				title: "Stable execution",
				completionCriteria: ["Runs complete reliably."],
				verificationGate: ["Focused tests pass."],
			},
		],
		workPackages: [
			{
				id: "package-1",
				title: "Backend work",
				purpose: "Implement reliability safeguards.",
				relatedObjectiveIds: ["objective-1"],
				suggestedPlanMode: false,
				risk: "medium",
				approvalRequired: false,
				verificationGate: ["Focused tests pass."],
			},
		],
		taskProposals: [
			{
				id: "task-1",
				title: "Implement safeguards",
				summary: "Add reliability safeguards.",
				purpose: "Prevent failed runs.",
				workPackageId: "package-1",
				dependencies: [],
				targetFilesOrModules: ["api/modules/mission-planner"],
				initialPrompt: "Implement the accepted reliability safeguards.",
				expectedOutcome: "Runs complete reliably.",
				implementationFocus: ["service"],
				acceptanceCriteria: ["The new behavior is covered."],
				verificationGate: ["Run focused tests."],
				risk: "medium",
				approvalRequired: false,
				scheduling: {
					executionType: "normal",
					reason: "Independent work.",
					sequenceGroupId: null,
					sequenceOrder: null,
					dependsOnTaskIds: [],
				},
			},
		],
		replanningUnits: [
			{
				id: "replan-1",
				trigger: "Validation fails.",
				scope: "work_package",
				targetId: "package-1",
				action: "pause",
			},
		],
	};
}
