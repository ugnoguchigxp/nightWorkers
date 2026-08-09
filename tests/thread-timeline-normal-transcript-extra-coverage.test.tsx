import { describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/nightworkers/components/ThreadTimeline", () => ({
	asNumber: (value: unknown) =>
		typeof value === "number" && Number.isFinite(value) ? value : undefined,
	asRecord: (value: unknown) =>
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {},
	asString: (value: unknown) => (typeof value === "string" ? value : ""),
	estimateReplacementStats: ({ needle }: { needle: string }) =>
		needle === "unestimated" ? undefined : { added: 2, deleted: 1 },
	getActivityChangedFiles: (event: Record<string, unknown>) =>
		(event.changedFiles as string[] | undefined) ?? [],
	getCodexCommandOutput: (event: Record<string, unknown>) =>
		(event.output as string | undefined) ?? "",
	getToolActivityModel: (event: Record<string, unknown>) => event.activityModel,
	getToolArguments: (payload: Record<string, unknown>) => payload.arguments,
	getToolName: (payload: Record<string, unknown>) => payload.toolName,
	getToolResult: (payload: Record<string, unknown>) => payload.result,
	parseApplyPatchSections: (content: string) =>
		content === "sections"
			? [
					{ path: "src/a.ts", added: 1, deleted: 0 },
					{ path: "src/a.ts", added: 2, deleted: 1 },
					{ path: "src/zero.ts", added: 0, deleted: 0 },
				]
			: [],
	parseUnifiedDiffSections: (content: string) =>
		content === "unified"
			? [
					{ path: "src/diff.ts", added: 1, deleted: 1 },
					{ path: "src/diff.ts", added: 2, deleted: 0 },
				]
			: [],
}));

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineActivityTranscript",
	() => ({
		getActivityDiffCode: (event: Record<string, unknown>) =>
			(event.activityDiff as string | undefined) ?? "",
		getEditToolCall: (event: Record<string, unknown>) => event.editCall,
		getEditToolCallDiff: (event: Record<string, unknown>) =>
			(event.editDiff as string | undefined) ?? "",
		isDiffActivity: (event: Record<string, unknown>) =>
			Boolean(event.diffActivity),
	}),
);

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineCodexToolCard",
	() => ({
		getCodexToolCardModel: (event: Record<string, unknown>) => event.codexCard,
		isNormalCodexToolCardVisible: (card: Record<string, unknown>) =>
			card.visible !== false,
	}),
);

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineContextStillCards",
	() => ({
		getContextStillToolCardModel: (event: Record<string, unknown>) =>
			event.contextCard,
	}),
);

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineImportProjectCard",
	() => ({
		getImportProjectToolCardModel: (event: Record<string, unknown>) =>
			event.importCard,
	}),
);

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineInspectionToolCard",
	() => ({
		getInspectionToolCardModel: (event: Record<string, unknown>) =>
			event.inspectionCard,
	}),
);

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineStreaming",
	() => ({
		stringValue: (value: unknown) => (typeof value === "string" ? value : ""),
	}),
);

import {
	buildNormalTranscriptItems,
	buildVisibleEditDiffSummary,
	getVisibleCliCommandSummary,
	getVisibleEditDiffCode,
	transcriptChildEvent,
} from "../src/modules/nightworkers/components/ThreadTimelineNormalTranscriptModel";

function event(overrides: Record<string, unknown> = {}) {
	return {
		id: "event",
		kind: "custom",
		runId: "run-1",
		seq: 1,
		payloadJson: {},
		...overrides,
	} as never;
}

function activity(id: string, value: ReturnType<typeof event>) {
	return { kind: "activity", id, event: value } as never;
}

describe("ThreadTimelineNormalTranscriptModel extra coverage", () => {
	it("filters turn types, patch envelopes, empty text, and both child shapes", () => {
		const visibleChild = event({
			id: "visible-child",
			codexCard: {
				providerItemId: "codex-child",
				lifecycle: "result",
				toolName: "read_file",
				summary: "read",
				visible: true,
			},
		});
		const invisibleChild = event({
			id: "invisible-child",
			codexCard: {
				providerItemId: "hidden",
				lifecycle: "started",
				toolName: "search",
				summary: "hidden",
				visible: false,
			},
		});
		const items = buildNormalTranscriptItems([
			{ kind: "user_turn", id: "user", text: "hello", events: [] } as never,
			{
				kind: "assistant_turn",
				id: "patch",
				text: "  *** Begin Patch\n+x ",
				children: [
					{ kind: "tool", events: [visibleChild] },
					{ kind: "event", event: invisibleChild },
				],
			} as never,
			{
				kind: "assistant_turn",
				id: "git-patch-empty",
				text: "diff --git a/a b/a",
				children: [],
			} as never,
			{
				kind: "assistant_turn",
				id: "plain-empty",
				text: "   ",
				children: [{ kind: "tool", events: [] }],
			} as never,
			{
				kind: "assistant_turn",
				id: "plain",
				text: "assistant answer",
				children: [],
			} as never,
		]);

		expect(items.map((item) => item.id)).toEqual(["user", "patch", "plain"]);
		expect((items[1] as { text: string }).text).toBe("");
		expect(
			transcriptChildEvent({ kind: "tool", events: [visibleChild] } as never),
		).toBe(visibleChild);
		expect(
			transcriptChildEvent({ kind: "event", event: invisibleChild } as never),
		).toBe(invisibleChild);
	});

	it("keeps each optional card type once and uses provider and fallback keys", () => {
		const codexProvider = event({
			codexCard: {
				providerItemId: "provider-1",
				lifecycle: "result",
				toolName: "read_file",
				summary: "one",
			},
		});
		const codexFallback = event({
			runId: "",
			seq: 8,
			codexCard: {
				providerItemId: "",
				lifecycle: "started",
				toolName: "search",
				summary: "fallback",
			},
		});
		const contextProvider = event({
			payloadJson: {
				runEvent: { data: { providerItemId: "context-provider" } },
			},
			contextCard: { kind: "compile" },
		});
		const contextFallback = event({
			runId: "",
			seq: 9,
			contextCard: { kind: "result" },
		});
		const importProvider = event({
			payloadJson: {
				runEvent: { data: { providerItemId: "import-provider" } },
			},
			importCard: { targetPath: "/repo", sourceSummary: "ignored" },
		});
		const importFallback = event({
			seq: 10,
			importCard: { targetPath: "", sourceSummary: "source" },
		});
		const inspectionStep = event({
			payloadJson: { runEvent: { runId: "nested-run", data: { step: 2 } } },
			inspectionCard: {
				toolName: "read",
				lifecycle: "result",
				target: "/a",
				query: "ignored",
			},
		});
		const inspectionFallback = event({
			runId: "",
			seq: 11,
			inspectionCard: {
				toolName: "search",
				lifecycle: "started",
				target: "",
				query: "needle",
			},
		});
		const events = [
			codexProvider,
			codexProvider,
			codexFallback,
			contextProvider,
			contextProvider,
			contextFallback,
			importProvider,
			importProvider,
			importFallback,
			inspectionStep,
			inspectionStep,
			inspectionFallback,
		];
		const items = buildNormalTranscriptItems(
			events.map((value, index) => activity(`card-${index}`, value)),
		);

		expect(items).toHaveLength(8);
	});

	it("deduplicates CLI commands using iteration, step, nested step, and command fallback", () => {
		const cli = (id: string, payloadJson: Record<string, unknown>) =>
			event({ id, kind: "tool.call", payloadJson });
		const commands = [
			cli("iteration", {
				toolName: "run_command",
				arguments: { command: "npm test" },
				runEvent: { runId: "nested", data: { iteration: 1 } },
			}),
			cli("iteration-duplicate", {
				toolName: "run_command",
				arguments: { command: "npm test" },
				runEvent: { runId: "nested", data: { iteration: 1 } },
			}),
			cli("step", {
				toolName: "run_verification",
				arguments: {},
				result: { payload: { command: "npm run check" } },
				runEvent: { data: { step: 2 } },
			}),
			cli("nested-step", {
				toolName: "command_execution",
				arguments: {},
				result: {},
				payload: { step: 3, command: "pwd" },
			}),
			cli("no-step", {
				toolName: "run_command",
				arguments: { command: "ls" },
			}),
		];
		const items = buildNormalTranscriptItems(
			commands.map((value, index) => activity(`cli-${index}`, value)),
		);

		expect(items).toHaveLength(4);
	});

	it("resolves CLI summaries from activity and every payload command source", () => {
		expect(getVisibleCliCommandSummary(event())).toBeNull();
		expect(
			getVisibleCliCommandSummary(
				event({ payloadJson: { toolName: "read_file" } }),
			),
		).toBeNull();
		expect(
			getVisibleCliCommandSummary(
				event({
					activityModel: {
						toolName: "run_command",
						arguments: { command: "activity command" },
						rawResult: {},
						resultPayload: {},
					},
					output: "activity output",
				}),
			),
		).toEqual({
			toolName: "run_command",
			command: "activity command",
			output: "activity output",
		});
		expect(
			getVisibleCliCommandSummary(
				event({
					payloadJson: {
						toolName: "run_verification",
						result: { payload: { command: "result command" } },
					},
				}),
			),
		).toEqual({
			toolName: "run_verification",
			command: "result command",
		});
		expect(
			getVisibleCliCommandSummary(
				event({
					payloadJson: {
						toolName: "command_execution",
						runEvent: { data: { command: "run event command" } },
					},
				}),
			),
		).toMatchObject({ command: "run event command" });
		expect(
			getVisibleCliCommandSummary(
				event({
					payloadJson: {
						toolName: "run_command",
						payload: { command: "payload command" },
					},
				}),
			),
		).toMatchObject({ command: "payload command" });
		expect(
			getVisibleCliCommandSummary(
				event({
					payloadJson: {
						toolName: "run_command",
						arguments: { command: "   " },
					},
				}),
			),
		).toBeNull();
	});

	it("builds apply_patch and replace_content summaries with all fallbacks", () => {
		const patch = event({
			editCall: {
				name: "apply_patch",
				arguments: { patchContent: "sections" },
			},
		});
		expect(buildVisibleEditDiffSummary(patch)).toEqual([
			{ path: "src/a.ts", added: 3, deleted: 1 },
		]);
		const emptyPatch = event({
			editCall: { name: "apply_patch", arguments: { patchContent: "empty" } },
			changedFiles: ["src/fallback.ts"],
		});
		expect(buildVisibleEditDiffSummary(emptyPatch)).toEqual([
			{
				path: "src/fallback.ts",
				added: 0,
				deleted: 0,
				changedOnly: true,
			},
		]);

		const replacements = [
			event({
				editCall: {
					name: "replace_content",
					arguments: {
						filePath: "src/from-args.ts",
						needle: "old",
						replacement: "new",
					},
				},
			}),
			event({
				activityModel: { resultPayload: { filePath: "src/from-result.ts" } },
				editCall: {
					name: "replace_content",
					arguments: { needle: "unestimated", replacement: "" },
				},
			}),
			event({
				editCall: {
					name: "replace_content",
					arguments: { needle: "", replacement: "" },
				},
			}),
		];
		expect(buildVisibleEditDiffSummary(replacements[0])).toEqual([
			{ path: "src/from-args.ts", added: 2, deleted: 1 },
		]);
		expect(buildVisibleEditDiffSummary(replacements[1])).toEqual([
			{ path: "src/from-result.ts", added: 0, deleted: 0 },
		]);
		expect(buildVisibleEditDiffSummary(replacements[2])?.[0]?.path).toBe(
			"unknown",
		);
	});

	it("handles diff code, incomplete Codex events, completed changes, and invalid changes", () => {
		expect(getVisibleEditDiffCode(event({ editDiff: "edit code" }))).toBe(
			"edit code",
		);
		expect(
			getVisibleEditDiffCode(
				event({ diffActivity: true, activityDiff: "activity code" }),
			),
		).toBe("activity code");
		expect(getVisibleEditDiffCode(event({ diffActivity: false }))).toBe("");

		const incomplete = event({
			kind: "file.diff",
			diffActivity: true,
			payloadJson: {
				payload: {
					provider: "codex",
					providerItemId: "file-1",
					providerEventType: "item.started",
					status: "in_progress",
				},
			},
		});
		expect(buildVisibleEditDiffSummary(incomplete)).toEqual([]);

		const unified = event({
			kind: "file.diff",
			diffActivity: true,
			activityDiff: "unified",
			payloadJson: { payload: { provider: "other" } },
		});
		expect(buildVisibleEditDiffSummary(unified)).toEqual([
			{ path: "src/diff.ts", added: 3, deleted: 1 },
		]);

		const completed = event({
			kind: "file.diff",
			diffActivity: true,
			changedFiles: [
				"src/add.ts",
				"src/update.ts",
				"src/delete.ts",
				"src/no-kind.ts",
			],
			payloadJson: {
				payload: {
					provider: "codex",
					providerItemId: "file-2",
					providerEventType: "item.completed",
					status: "completed",
					changes: [
						{ path: "src/add.ts", kind: "add" },
						{ filePath: "src/update.ts", kind: "update" },
						{ relativePath: "src/delete.ts", kind: "delete" },
						{ path: "", kind: "add" },
						{ path: "src/invalid.ts", kind: "move" },
					],
				},
			},
		});
		expect(buildVisibleEditDiffSummary(completed)).toEqual([
			{
				path: "src/add.ts",
				added: 0,
				deleted: 0,
				changedOnly: true,
				changeKind: "add",
			},
			{
				path: "src/update.ts",
				added: 0,
				deleted: 0,
				changedOnly: true,
				changeKind: "update",
			},
			{
				path: "src/delete.ts",
				added: 0,
				deleted: 0,
				changedOnly: true,
				changeKind: "delete",
			},
			{
				path: "src/no-kind.ts",
				added: 0,
				deleted: 0,
				changedOnly: true,
			},
		]);

		const runEventPayload = event({
			kind: "file.diff",
			diffActivity: true,
			changedFiles: ["src/run-event.ts"],
			payloadJson: {
				runEvent: {
					data: {
						provider: "codex",
						providerItemId: "file-3",
						providerEventType: "item.completed",
						status: "completed",
						changes: "invalid",
					},
				},
			},
		});
		expect(buildVisibleEditDiffSummary(runEventPayload)).toEqual([
			{
				path: "src/run-event.ts",
				added: 0,
				deleted: 0,
				changedOnly: true,
			},
		]);
		expect(buildVisibleEditDiffSummary(event())).toEqual([]);
	});

	it("deduplicates visible edit keys by provider id, call id, code, and summary", () => {
		const provider = event({
			payloadJson: { payload: { providerItemId: "edit-provider" } },
			editDiff: "same-code",
		});
		const call = event({
			activityModel: { callId: "call-1" },
			editDiff: "call-code",
		});
		const code = event({ editDiff: "raw-code" });
		const summaryOnly = event({
			editCall: {
				name: "apply_patch",
				arguments: { patchContent: "empty" },
			},
			changedFiles: ["src/summary.ts"],
		});
		const invisible = event({});
		const values = [
			provider,
			provider,
			call,
			call,
			code,
			code,
			summaryOnly,
			summaryOnly,
			invisible,
		];
		const items = buildNormalTranscriptItems(
			values.map((value, index) => activity(`edit-${index}`, value)),
		);
		expect(items).toHaveLength(4);
	});
});
