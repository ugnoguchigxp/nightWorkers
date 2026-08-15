import { describe, expect, it } from "vitest";
import type { ExplorationReductionMeasurement } from "../api/modules/ontology/exploration/project-exploration-measurement";
import { parsePilotOptions } from "../scripts/project-exploration-pilot/options";
import {
	buildPilotReport,
	pilotPromptDigest,
} from "../scripts/project-exploration-pilot/report";
import {
	PILOT_TASKS,
	type PilotTask,
} from "../scripts/project-exploration-pilot/tasks";

describe("project exploration paired pilot modules", () => {
	it("parses normalized CLI options without depending on process cwd", () => {
		const options = parsePilotOptions(
			[
				"--repository-root",
				"target",
				"--producer-root",
				"producer",
				"--from-pair",
				"2",
				"--pair-count",
				"3",
				"--thinking-depth",
				"high",
				"--cooldown-seconds",
				"0",
				"--dedicated-database",
				"--output",
				"reports/pilot.json",
			],
			"/workspace",
		);

		expect(options).toMatchObject({
			repositoryRoot: "/workspace/target",
			producerRoot: "/workspace/producer",
			fromPair: 2,
			pairCount: 3,
			thinkingDepth: "high",
			cooldownSeconds: 0,
			dedicatedDatabase: true,
			output: "/workspace/reports/pilot.json",
		});
	});

	it("rejects missing paths and invalid bounded numeric options", () => {
		expect(() => parsePilotOptions([], "/workspace")).toThrow(
			"--repository-root is required",
		);
		expect(() =>
			parsePilotOptions(
				[
					"--repository-root",
					"target",
					"--producer-root",
					"producer",
					"--pair-count",
					"0",
				],
				"/workspace",
			),
		).toThrow("Expected a positive integer");
		expect(() =>
			parsePilotOptions(
				[
					"--repository-root",
					"target",
					"--producer-root",
					"producer",
					"--thinking-depth",
					"ultra",
				],
				"/workspace",
			),
		).toThrow("Unsupported thinking depth: ultra");
	});

	it("keeps the fixed ten-task catalog and prompt digest deterministic", () => {
		expect(PILOT_TASKS).toHaveLength(10);
		expect(new Set(PILOT_TASKS.map((task) => task.id)).size).toBe(10);
		expect(pilotPromptDigest(PILOT_TASKS[0])).toMatch(/^[a-f0-9]{64}$/);
		expect(pilotPromptDigest(PILOT_TASKS[0])).toBe(
			pilotPromptDigest({ ...PILOT_TASKS[0] }),
		);
	});

	it("returns GO only for complete paired evidence that passes every gate", () => {
		const task = PILOT_TASKS[0];
		const pairs = Array.from({ length: 10 }, (_value, index) =>
			pair(task, index, {
				baseline: measurement("baseline", {
					listDirCallsBeforeMutation: 10,
					totalInputTokens: 1_000,
				}),
				catalog: measurement("catalog", {
					listDirCallsBeforeMutation: 5,
					catalogCallCount: 1,
					catalogCalled: true,
					catalogCalledBeforeBroadExploration: true,
					totalInputTokens: 700,
				}),
			}),
		);

		const report = buildPilotReport(reportInput(task, pairs));

		expect(report.decision).toBe("GO");
		expect(report.aggregate.gates).toEqual(
			expect.objectContaining({
				minimumTenPairs: true,
				explorationReduction: true,
				inputTokenReduction: true,
			}),
		);
	});

	it("separates insufficient evidence from a measured NO-GO", () => {
		const task = PILOT_TASKS[0];
		const incomplete = buildPilotReport(reportInput(task, [pair(task, 0)]));
		expect(incomplete.decision).toBe("INSUFFICIENT_EVIDENCE");

		const measuredPairs = Array.from({ length: 10 }, (_value, index) =>
			pair(task, index),
		);
		const noGo = buildPilotReport(reportInput(task, measuredPairs));
		expect(noGo.decision).toBe("NO-GO");
		expect(noGo.aggregate.gates.explorationReduction).toBe(false);
	});
});

function measurement(
	mode: "baseline" | "catalog",
	overrides: Partial<ExplorationReductionMeasurement> = {},
): ExplorationReductionMeasurement {
	return {
		runId: `${mode}-run`,
		taskId: `${mode}-task`,
		repositoryId: "repository-1",
		mode,
		generationId: null,
		preparationDurationMs: null,
		preparationReused: null,
		preparationPollCount: null,
		fallbackReason: null,
		catalogAvailable: mode === "catalog",
		catalogCalled: mode === "catalog",
		catalogCallCount: mode === "catalog" ? 1 : 0,
		catalogFailureCount: 0,
		catalogResponseBytes: 0,
		catalogFileCount: 0,
		catalogTestCount: 0,
		catalogVerificationCount: 0,
		broadExplorationCallsBeforeCatalog: 0,
		catalogCalledBeforeBroadExploration: mode === "catalog" ? true : null,
		listDirCallsBeforeMutation: 10,
		searchCallsBeforeMutation: 0,
		readFileCallsBeforeMutation: 0,
		uniqueFilesReadBeforeMutation: 0,
		totalInputTokens: 1_000,
		totalCachedInputTokens: 0,
		usageMode: "measured",
		timeToFirstMutationMs: 1,
		taskCompleted: true,
		verificationPassed: true,
		replanCount: 0,
		warnings: [],
		...overrides,
	};
}

function pair(
	task: PilotTask,
	index: number,
	overrides: {
		baseline?: ExplorationReductionMeasurement;
		catalog?: ExplorationReductionMeasurement;
	} = {},
) {
	return {
		pairId: `${task.id}-${index}`,
		baseline: { measurement: overrides.baseline ?? measurement("baseline") },
		catalog: { measurement: overrides.catalog ?? measurement("catalog") },
		controls: {
			sameBaseRef: true,
			samePrompt: true,
			sameRoute: true,
			independentWorktrees: true,
		},
	};
}

function reportInput(task: PilotTask, pairs: ReturnType<typeof pair>[]) {
	return {
		pilotId: "pilot-1",
		selectedTasks: [task],
		pairs,
		repositoryId: "repository-1",
		repositoryRoot: "/workspace/target",
		targetHead: "target-head",
		consumerHead: "consumer-head",
		consumerDirty: false,
		consumerDiffHash: "diff-hash",
		mcpServerId: "mcp-1",
		dedicatedDatabase: true,
		databasePath: "/runtime/pilot.sqlite",
	};
}
