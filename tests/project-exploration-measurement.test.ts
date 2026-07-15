import { describe, expect, it } from "vitest";
import {
	measureProjectExplorationRun,
	summarizeProjectExplorationPair,
} from "../api/modules/ontology/exploration/project-exploration-measurement";

describe("project exploration measurement", () => {
	it("measures only successful exploration calls before the first source mutation", () => {
		const catalogPayload = {
			ok: true,
			status: "completed",
			freshness: { status: "fresh" },
			likelyFiles: [{ path: "src/a.ts" }, { path: "src/b.ts" }],
			relatedTests: [{ path: "src/a.test.ts" }],
			verificationCandidates: [{ command: "bun test", candidateOnly: true }],
		};
		const catalogText = JSON.stringify(catalogPayload);
		const events = [
			event(1, "list_dir", true, {}),
			event(2, "read_file", true, { filePath: "src/a.ts" }),
			event(3, "read_file", false, { filePath: "src/b.ts" }),
			event(
				4,
				"project_exploration_catalog",
				true,
				{},
				{ status: "completed" },
			),
			event(
				5,
				"project_exploration_catalog",
				true,
				{},
				{ status: "completed", catalog: catalogPayload },
			),
			event(6, "apply_patch", false, {}),
			event(7, "search_files", true, { query: "service" }),
			event(8, "apply_patch", true, {}),
			event(9, "read_file", true, { filePath: "src/after.ts" }),
			event(10, "todo_list", true, {
				command: { op: "replace_plan" },
			}),
			event(11, "run_verification", false, {}),
			event(12, "completion_check", true, {}),
		];
		const result = measureProjectExplorationRun({
			run: runFixture(true),
			events: events.reverse(),
			usageRecords: [
				{ inputTokens: 100, cachedInputTokens: 25, usageMode: "measured" },
				{ inputTokens: 50, cachedInputTokens: null, usageMode: "estimated" },
			],
		});
		expect(result).toEqual({
			runId: "run-1",
			taskId: "task-1",
			repositoryId: "repo-1",
			mode: "catalog",
			generationId: null,
			preparationDurationMs: 20,
			preparationReused: true,
			preparationPollCount: 1,
			fallbackReason: null,
			catalogAvailable: true,
			catalogCalled: true,
			catalogCallCount: 2,
			catalogFailureCount: 0,
			catalogResponseBytes:
				Buffer.byteLength(catalogText, "utf8") +
				Buffer.byteLength("{}", "utf8"),
			catalogFileCount: 2,
			catalogTestCount: 1,
			catalogVerificationCount: 1,
			broadExplorationCallsBeforeCatalog: 1,
			catalogCalledBeforeBroadExploration: false,
			listDirCallsBeforeMutation: 1,
			searchCallsBeforeMutation: 1,
			readFileCallsBeforeMutation: 1,
			uniqueFilesReadBeforeMutation: 1,
			totalInputTokens: 150,
			totalCachedInputTokens: 25,
			usageMode: "mixed",
			timeToFirstMutationMs: 8000,
			taskCompleted: true,
			verificationPassed: true,
			replanCount: 1,
			warnings: [
				"catalog_called_after_broad_exploration",
				"catalog_result_invalid",
			],
		});
	});

	it("counts failed catalog attempts before mutation", () => {
		const result = measureProjectExplorationRun({
			run: runFixture(true),
			events: [
				event(
					1,
					"project_exploration_catalog",
					false,
					{},
					{ status: "unavailable", audit: { responseBytes: 123 } },
				),
				event(2, "apply_patch", true, {}),
			],
			usageRecords: [],
		});
		expect(result).toMatchObject({
			catalogCalled: true,
			catalogCallCount: 1,
			catalogFailureCount: 1,
			catalogResponseBytes: 123,
			warnings: ["catalog_call_failed"],
		});
	});

	it("keeps baseline tokens unavailable and ignores failed mutation boundaries", () => {
		const result = measureProjectExplorationRun({
			run: runFixture(false, "running"),
			events: [
				event(1, "apply_patch", false, {}),
				event(2, "read_file", true, { filePath: "src/a.ts" }),
			],
			usageRecords: [],
		});
		expect(result).toMatchObject({
			mode: "baseline",
			generationId: null,
			preparationDurationMs: null,
			preparationReused: null,
			preparationPollCount: null,
			fallbackReason: "disabled",
			catalogCalled: false,
			catalogFailureCount: 0,
			readFileCallsBeforeMutation: 1,
			totalInputTokens: null,
			totalCachedInputTokens: null,
			usageMode: "unavailable",
			timeToFirstMutationMs: null,
			taskCompleted: false,
			verificationPassed: null,
		});
	});

	it("includes the catalog call itself in paired exploratory reduction", () => {
		const baseline = measureProjectExplorationRun({
			run: runFixture(false),
			events: [
				event(1, "list_dir", true, {}),
				event(2, "search_files", true, {}),
				event(3, "read_file", true, { filePath: "a.ts" }),
				event(4, "apply_patch", true, {}),
			],
			usageRecords: [
				{ inputTokens: 100, cachedInputTokens: 10, usageMode: "measured" },
			],
		});
		const catalog = {
			...baseline,
			runId: "run-2",
			mode: "catalog" as const,
			catalogCallCount: 1,
			listDirCallsBeforeMutation: 0,
			searchCallsBeforeMutation: 0,
			readFileCallsBeforeMutation: 1,
			totalInputTokens: 70,
		};
		const summary = summarizeProjectExplorationPair({ baseline, catalog });
		expect(summary.exploratoryToolCalls).toEqual({
			baseline: 3,
			catalog: 2,
			reductionRate: 1 / 3,
		});
		expect(summary.totalInputTokens.reductionRate).toBe(0.3);
	});
});

function runFixture(available: boolean, status = "completed") {
	return {
		id: "run-1",
		taskId: "task-1",
		repositoryId: "repo-1",
		startedAt: new Date("2026-07-14T00:00:00.000Z"),
		status,
		contextSnapshot: {
			projectExplorationCatalog: available
				? {
						version: 2,
						available: true,
						serverId: "server-1",
						preparedAt: "2026-07-14T00:00:00.000Z",
						preparationStatus: "ready",
						freshness: {
							status: "current",
							sourceRevisionKind: "git",
							sourceRevisionValue: "abc123",
						},
						readiness: {
							codeStructure: "available",
							reasonCodes: [],
						},
						preparation: {
							reused: true,
							durationMs: 20,
							pollCount: 1,
						},
						toolName: "vuln_get_project_exploration_catalog",
					}
				: { version: 2, available: false, reason: "disabled" },
		},
	};
}

function event(
	seq: number,
	toolName: string,
	ok: boolean,
	args: Record<string, unknown>,
	result?: unknown,
) {
	return {
		seq,
		timestamp: new Date(
			`2026-07-14T00:00:${String(seq).padStart(2, "0")}.000Z`,
		),
		payloadJson: {
			runEvent: {
				type: "tool.call_finished",
				seq,
				timestamp: `2026-07-14T00:00:${String(seq).padStart(2, "0")}.000Z`,
				data: { toolName, arguments: args, ok, result },
			},
		},
	};
}
