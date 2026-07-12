import { describe, expect, it, vi } from "vitest";
import {
	classifyTaskGenerationScale,
	generateTaskCandidates,
	TASK_GENERATION_LARGE_THRESHOLD_LINES,
} from "../api/modules/taskGeneration/task-generation-orchestrator.service";
import { generateTaskCandidatesResponseSchema } from "../shared/schemas/task-generation.schema";

function goal() {
	return {
		id: "11111111-1111-4111-8111-111111111111",
		repositoryId: "22222222-2222-4222-8222-222222222222",
		title: "BBSを作る",
		goalText: "BBS本体を実装する",
		active: true,
		source: "user",
		sortOrder: 0,
		interpretation: {
			scope: "feature_domain",
			intent: "build",
			source: "llm",
			confidencePercent: 90,
			reason: null,
		},
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

function estimate(changedLines: number) {
	return JSON.stringify({
		schemaVersion: "nightworkers.task-generation-estimate/v1",
		estimatedChangedLines: changedLines,
		estimatedFileCount: changedLines >= 2_000 ? 25 : 8,
		estimatedTaskCount: changedLines === 0 ? 0 : changedLines >= 2_000 ? 5 : 1,
		confidencePercent: 85,
		rationale: "repository signal と Goal から見積もった。",
		assumptions: ["既存基盤を再利用する"],
	});
}

function mission(id = "44444444-4444-4444-8444-444444444444") {
	return {
		id,
		repositoryId: goal().repositoryId,
		title: "BBS Mission",
		goalText: "BBS本体を複数Taskへ分解して実装する",
		nonGoals: [],
		status: "review_pending" as const,
		sourceGoalIds: [goal().id],
		latestPlanningResultId: "66666666-6666-4666-8666-666666666666",
		statusReason: "review_ready",
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

function proposal(
	id = "55555555-5555-4555-8555-555555555555",
	missionId = mission().id,
) {
	return {
		id,
		missionId,
		planningResultId: "66666666-6666-4666-8666-666666666666",
		repositoryId: goal().repositoryId,
		workPackageId: "wp-1",
		decompositionTaskId: `task-${id}`,
		status: "proposed" as const,
		title: "BBS APIを実装する",
		summary: "BBS APIを実装する",
		initialPrompt: "BBS APIを実装してください。",
		expectedOutcome: "APIが利用できる",
		implementationFocus: ["API"],
		acceptanceCriteria: ["APIが応答する"],
		verificationGate: ["bun run test"],
		dependencies: [],
		targetFilesOrModules: ["api"],
		risk: "medium" as const,
		approvalRequired: false,
		scheduling: {
			executionType: "normal" as const,
			reason: "独立して実行できる",
			sequenceGroupId: null,
			sequenceOrder: null,
			dependsOnTaskIds: [],
		},
		taskId: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

function dependencies(changedLines: number) {
	return {
		getRepository: vi.fn(async () => ({
			id: goal().repositoryId,
			name: "repo",
			localPath: "/tmp/repo",
			branch: "main",
		})),
		listMissionGoals: vi.fn(async () => [goal()]),
		buildProjectSignalSnapshot: vi.fn(async () => ({ repository: {} })),
		callStructuredJsonLLM: vi.fn(async () => estimate(changedLines)),
		generateMissionTaskCandidates: vi.fn(async () => ({
			batchId: "33333333-3333-4333-8333-333333333333",
			status: "completed" as const,
			candidates: [],
		})),
		generateMissionPlansFromGoals: vi.fn(async () => ({
			status: "completed" as const,
			missions: [mission()],
			proposals: [proposal()],
		})),
	};
}

describe("task generation orchestrator", () => {
	it("classifies the 2,000-line boundary deterministically", () => {
		expect(classifyTaskGenerationScale(499)).toBe("small");
		expect(classifyTaskGenerationScale(500)).toBe("medium");
		expect(
			classifyTaskGenerationScale(TASK_GENERATION_LARGE_THRESHOLD_LINES - 1),
		).toBe("medium");
		expect(
			classifyTaskGenerationScale(TASK_GENERATION_LARGE_THRESHOLD_LINES),
		).toBe("large");
	});

	it("generates Task Candidates directly below 2,000 lines", async () => {
		const deps = dependencies(1_999);
		const result = await generateTaskCandidates(
			{ repositoryId: goal().repositoryId },
			deps as never,
		);

		expect(result.generationPath).toBe("direct_task_candidates");
		expect(result.estimate.scale).toBe("medium");
		expect(deps.generateMissionTaskCandidates).toHaveBeenCalledWith({
			repositoryId: goal().repositoryId,
			goalIds: [goal().id],
			includeInactiveGoals: true,
		});
		expect(deps.generateMissionPlansFromGoals).not.toHaveBeenCalled();
		expect(generateTaskCandidatesResponseSchema.parse(result)).toEqual(result);
	});

	it("does not generate redundant candidates when no remaining changes are estimated", async () => {
		const deps = dependencies(0);
		const result = await generateTaskCandidates(
			{ repositoryId: goal().repositoryId },
			deps as never,
		);

		expect(result.estimate.estimatedTaskCount).toBe(0);
		expect(result.candidates).toEqual([]);
		expect(deps.generateMissionTaskCandidates).not.toHaveBeenCalled();
		expect(deps.generateMissionPlansFromGoals).not.toHaveBeenCalled();
		expect(generateTaskCandidatesResponseSchema.parse(result)).toEqual(result);
	});

	it("generates Missions and Task Candidates together at 2,000 lines or more", async () => {
		const deps = dependencies(2_000);
		const result = await generateTaskCandidates(
			{ repositoryId: goal().repositoryId },
			deps as never,
		);

		expect(result.generationPath).toBe("mission_decomposition");
		expect(result.estimate.scale).toBe("large");
		expect(deps.generateMissionTaskCandidates).not.toHaveBeenCalled();
		expect(deps.generateMissionPlansFromGoals).toHaveBeenCalledWith({
			repositoryId: goal().repositoryId,
			goalIds: [goal().id],
			includeInactiveGoals: true,
		});
		expect(deps.generateMissionPlansFromGoals).toHaveBeenCalledTimes(1);
		expect(result.missions).toHaveLength(1);
		expect(result.proposals).toHaveLength(1);
		expect(result.decompositionFailures).toEqual([]);
		expect(generateTaskCandidatesResponseSchema.parse(result)).toEqual(result);
	});

	it("does not hide combined generation failures", async () => {
		const deps = dependencies(2_500);
		deps.generateMissionPlansFromGoals.mockRejectedValueOnce(
			new Error("database connection lost"),
		);

		await expect(
			generateTaskCandidates(
				{ repositoryId: goal().repositoryId },
				deps as never,
			),
		).rejects.toThrow("database connection lost");
	});
});
