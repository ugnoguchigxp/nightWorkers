import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	asRecord,
	codexActivityData,
	findRuntimePromptSnapshotTimelineAnchorId,
	findRuntimePromptSnapshotTranscriptAnchorId,
	firstBoolean,
	firstDefined,
	firstRecord,
	firstString,
	formatCodexToolActivitySummary,
	getActivityChangedFiles,
	getActivityDiffPayload,
	getApplyPatchContent,
	getChangedFilesFromResult,
	getCodexCommandOutput,
	getToolActivityModel,
	getToolArguments,
	getToolName,
	getToolResult,
	inferToolActivityLifecycle,
	inferToolActivityStatus,
	isChangedFilesOnlyDiffActivity,
	isRecord,
	isRuntimePromptSnapshotAnchorEvent,
	isRuntimePromptSnapshotAnchorTaskEvent,
	nestedValue,
	normalizeStringArray,
	normalizeToolRawResult,
	normalizeToolResultPayload,
	TimelineDebugFragment,
	toMs,
	transcriptItemEvents,
	transcriptItemTimestamp,
} from "../src/modules/nightworkers/components/ThreadTimelineEventModel";

const createdAt = "2026-08-09T00:00:00.000Z";

function run(id = "run-1", withSnapshot = true) {
	return {
		id,
		taskId: "task-1",
		status: "running",
		workerKind: "native-local",
		timeoutSeconds: 60,
		contextSnapshot: withSnapshot ? { conversationContext: {} } : undefined,
		createdAt,
		updatedAt: createdAt,
	} as never;
}

function event(overrides: Record<string, unknown> = {}) {
	return {
		id: "event-1",
		taskId: "task-1",
		runId: "run-1",
		kind: "tool.result",
		source: "runtime",
		status: "completed",
		seq: 1,
		text: "",
		payloadJson: {},
		createdAt,
		visibility: "visible",
		...overrides,
	} as never;
}

describe("ThreadTimelineEventModel extra coverage", () => {
	it("renders the debug fragment with and without the optional snapshot slot", () => {
		expect(
			renderToStaticMarkup(
				createElement(
					TimelineDebugFragment,
					{ insertRuntimeSnapshot: false },
					createElement("span", null, "body"),
				),
			),
		).toContain("body");
		expect(
			renderToStaticMarkup(
				createElement(
					TimelineDebugFragment,
					{ insertRuntimeSnapshot: true },
					createElement("span", null, "body"),
				),
			),
		).toContain("body");
	});

	it("finds transcript and timeline anchors through each supported envelope", () => {
		const latestRun = run();
		const matching = event({
			id: "matching",
			kind: "run.status",
			payloadJson: { agentEventType: "run.started" },
		});
		const transcript = [
			{ kind: "user_turn", id: "user", events: [], text: "hello" },
			{ kind: "assistant_turn", id: "assistant", events: [], text: "hi" },
			{ kind: "activity", id: "anchor", event: matching },
		] as never;

		expect(findRuntimePromptSnapshotTranscriptAnchorId(transcript)).toBeNull();
		expect(
			findRuntimePromptSnapshotTranscriptAnchorId(
				transcript,
				run("run-1", false),
			),
		).toBeNull();
		expect(
			findRuntimePromptSnapshotTranscriptAnchorId(transcript, latestRun),
		).toBe("anchor");
		expect(
			findRuntimePromptSnapshotTranscriptAnchorId(
				[{ kind: "unknown", id: "unknown", event: event({ runId: "other" }) }],
				latestRun,
			),
		).toBeNull();

		const timeline = [
			{ kind: "message", id: "message", ts: 1, message: {} },
			{
				kind: "event",
				id: "nested-anchor",
				ts: 2,
				event: event({
					runId: null,
					taskRunId: null,
					payloadJson: {
						runEvent: {
							runId: "run-1",
							data: { agentEventType: "run.started" },
						},
					},
				}),
			},
		] as never;
		expect(findRuntimePromptSnapshotTimelineAnchorId(timeline)).toBeNull();
		expect(
			findRuntimePromptSnapshotTimelineAnchorId(timeline, run("run-1", false)),
		).toBeNull();
		expect(findRuntimePromptSnapshotTimelineAnchorId(timeline, latestRun)).toBe(
			"nested-anchor",
		);
		expect(findRuntimePromptSnapshotTimelineAnchorId([], latestRun)).toBeNull();

		expect(isRuntimePromptSnapshotAnchorEvent(matching, latestRun)).toBe(true);
		expect(
			isRuntimePromptSnapshotAnchorEvent(event({ runId: "other" }), latestRun),
		).toBe(false);
		expect(isRuntimePromptSnapshotAnchorTaskEvent(matching, latestRun)).toBe(
			true,
		);
		expect(
			isRuntimePromptSnapshotAnchorTaskEvent(
				event({
					runId: null,
					taskRunId: "run-1",
					payloadJson: { runEvent: { data: { agentEventType: 1 } } },
				}),
				latestRun,
			),
		).toBe(false);
	});

	it("normalizes transcript item events for every item kind", () => {
		const one = event({ id: "one" });
		const two = event({ id: "two" });
		expect(
			transcriptItemEvents({ kind: "user_turn", events: [one, two] } as never),
		).toEqual([one, two]);
		expect(
			transcriptItemEvents({ kind: "assistant_turn", events: [one] } as never),
		).toEqual([one]);
		expect(
			transcriptItemEvents({ kind: "activity", event: one } as never),
		).toEqual([one]);
		expect(
			transcriptItemEvents({ kind: "unknown", event: two } as never),
		).toEqual([two]);
		expect(transcriptItemEvents({ kind: "tool" } as never)).toEqual([]);
	});

	it("extracts apply-patch content from all legacy envelopes", () => {
		const patch = "*** Begin Patch\n*** End Patch";
		const shapes = [
			{ arguments: { patchContent: patch } },
			{ args: { patchContent: patch } },
			{ toolCall: { arguments: { patchContent: patch } } },
			{ decision: { toolCall: { arguments: { patchContent: patch } } } },
			{ runEvent: { data: { arguments: { patchContent: patch } } } },
			{
				runEvent: {
					data: { toolCall: { arguments: { patchContent: patch } } },
				},
			},
		];
		for (const shape of shapes) expect(getApplyPatchContent(shape)).toBe(patch);
		expect(
			getApplyPatchContent({ arguments: { patchContent: "" } }),
		).toBeNull();
		expect(getApplyPatchContent(null)).toBeNull();
	});

	it("builds tool activity models from direct, payload, decision, and run-event data", () => {
		const models = [
			getToolActivityModel({
				kind: "tool.call",
				seq: 7,
				toolName: "direct",
				arguments: { direct: true },
			}),
			getToolActivityModel({
				payloadJson: {
					seq: 8,
					payload: {
						toolCall: { name: "nested", arguments: { nested: true } },
						callId: "call-nested",
					},
				},
			}),
			getToolActivityModel({
				eventType: "tool_call",
				payloadJson: {
					decision: {
						toolCall: { name: "decision", arguments: { decision: true } },
					},
				},
			}),
			getToolActivityModel({
				payloadJson: {
					runEvent: {
						type: "tool.call_progress",
						seq: 9,
						data: {
							toolCall: { name: "runner", arguments: { runner: true } },
							callId: "call-runner",
						},
					},
				},
			}),
		];

		expect(models.map((model) => model?.toolName)).toEqual([
			"direct",
			"nested",
			"decision",
			"runner",
		]);
		expect(models[0]).toMatchObject({
			lifecycle: "started",
			status: "started",
			eventSeq: 7,
		});
		expect(models[1]).toMatchObject({ callId: "call-nested", eventSeq: 8 });
		expect(models[3]).toMatchObject({
			lifecycle: "progress",
			status: "running",
			callId: "call-runner",
			eventSeq: 9,
		});
		expect(
			getToolActivityModel({ payloadJson: { message: "none" } }),
		).toBeNull();
	});

	it("exercises tool lifecycle, result, argument, and name fallbacks", () => {
		expect(
			getToolActivityModel({
				status: "failed",
				payloadJson: { toolName: "failed", error: { message: "boom" } },
			}),
		).toMatchObject({ lifecycle: "failed", status: "failed" });
		expect(
			getToolActivityModel({
				payloadJson: {
					runEvent: {
						type: "tool.call_finished",
						data: { toolName: "failed-finish", error: { message: "boom" } },
					},
				},
			}),
		).toMatchObject({ lifecycle: "failed" });
		expect(
			getToolActivityModel({
				kind: "tool.result",
				payloadJson: { result: { toolName: "done", ok: true, value: 1 } },
			}),
		).toMatchObject({ lifecycle: "result", status: "ok" });
		expect(
			getToolActivityModel({
				eventType: "tool_result",
				payloadJson: { toolName: "legacy-result" },
			}),
		).toMatchObject({ lifecycle: "result" });
		expect(
			getToolActivityModel({ payloadJson: { toolName: "other" } }),
		).toMatchObject({ lifecycle: "other", status: "ok" });

		expect(getToolName({ result: { toolName: "result-name" } })).toBe(
			"result-name",
		);
		expect(getToolName({})).toBeNull();
		expect(getToolArguments({ arguments: { a: 1 } })).toEqual({ a: 1 });
		expect(getToolArguments({ args: { a: 2 } })).toEqual({ a: 2 });
		expect(getToolArguments({ toolCall: { arguments: { a: 3 } } })).toEqual({
			a: 3,
		});
		expect(
			getToolArguments({ decision: { toolCall: { arguments: { a: 4 } } } }),
		).toEqual({ a: 4 });
		expect(getToolArguments({ payload: { arguments: { a: 5 } } })).toEqual({
			a: 5,
		});
		expect(
			getToolArguments({ runEvent: { data: { toolArgs: { a: 6 } } } }),
		).toEqual({ a: 6 });
		expect(getToolArguments({})).toBeNull();

		expect(getToolResult({ result: { value: 1 } })).toEqual({ value: 1 });
		expect(
			getToolResult({ runEvent: { data: { result: { value: 2 } } } }),
		).toEqual({ value: 2 });
		expect(
			getToolResult({ runEvent: { data: { toolResult: { value: 3 } } } }),
		).toEqual({ value: 3 });
		expect(
			getToolResult({ payload: { ok: true, payload: { value: 4 } } }),
		).toEqual({ ok: true, payload: { value: 4 } });
		expect(getToolResult({ ok: false, payload: { value: 5 } })).toEqual({
			ok: false,
			payload: { value: 5 },
		});
		expect(getToolResult({})).toBeNull();
	});

	it("normalizes each tool-result payload representation", () => {
		expect(
			normalizeToolRawResult(
				{ result: { source: "direct" } },
				{ result: { source: "payload" } },
				{ result: { source: "run" } },
			),
		).toEqual({ source: "direct" });
		expect(
			normalizeToolRawResult({}, { result: { source: "payload" } }, {}),
		).toEqual({ source: "payload" });
		expect(
			normalizeToolRawResult({}, {}, { toolResult: { source: "tool" } }),
		).toEqual({ source: "tool" });

		const cases: Array<
			[
				Record<string, unknown>,
				Record<string, unknown>,
				Record<string, unknown>,
				Record<string, unknown>,
				Record<string, unknown>,
			]
		> = [
			[{ payload: { a: 1 } }, {}, {}, {}, { a: 1 }],
			[{ result: { payload: { a: 2 } } }, {}, {}, {}, { a: 2 }],
			[{ result: { a: 3 } }, {}, {}, {}, { a: 3 }],
			[{}, { ok: true, payload: { a: 4 } }, {}, {}, { a: 4 }],
			[{}, { payload: { ok: true, payload: { a: 5 } } }, {}, {}, { a: 5 }],
			[{}, {}, {}, { payload: { a: 6 } }, { a: 6 }],
			[{ a: 7 }, {}, {}, {}, { a: 7 }],
			[{}, { result: { a: 8 } }, {}, {}, { a: 8 }],
			[{}, {}, { result: { a: 9 } }, {}, { a: 9 }],
			[{}, {}, {}, {}, {}],
		];
		for (const [raw, payload, nestedPayload, runData, expected] of cases) {
			expect(
				normalizeToolResultPayload(raw, payload, nestedPayload, runData),
			).toEqual(expected);
		}
	});

	it("maps explicit lifecycle priorities and statuses", () => {
		const base = {
			kind: "custom",
			eventType: "custom",
			eventStatus: "completed",
			runEventType: "custom",
			hasError: false,
		};
		expect(inferToolActivityLifecycle({ ...base, eventStatus: "failed" })).toBe(
			"failed",
		);
		expect(
			inferToolActivityLifecycle({ ...base, eventType: "tool_failed" }),
		).toBe("failed");
		expect(inferToolActivityLifecycle({ ...base, ok: false })).toBe("failed");
		expect(
			inferToolActivityLifecycle({
				...base,
				hasError: true,
				runEventType: "tool.call_finished",
			}),
		).toBe("failed");
		expect(
			inferToolActivityLifecycle({
				...base,
				runEventType: "tool.call_finished",
			}),
		).toBe("result");
		expect(inferToolActivityLifecycle({ ...base, kind: "tool.result" })).toBe(
			"result",
		);
		expect(
			inferToolActivityLifecycle({ ...base, eventType: "tool_result" }),
		).toBe("result");
		expect(
			inferToolActivityLifecycle({
				...base,
				runEventType: "tool.call_progress",
			}),
		).toBe("progress");
		expect(
			inferToolActivityLifecycle({
				...base,
				runEventType: "tool.call_started",
			}),
		).toBe("started");
		expect(inferToolActivityLifecycle({ ...base, kind: "tool.call" })).toBe(
			"started",
		);
		expect(
			inferToolActivityLifecycle({ ...base, eventType: "tool_call" }),
		).toBe("started");
		expect(inferToolActivityLifecycle(base)).toBe("other");

		expect(inferToolActivityStatus("failed")).toBe("failed");
		expect(inferToolActivityStatus("started")).toBe("started");
		expect(inferToolActivityStatus("progress")).toBe("running");
		expect(inferToolActivityStatus("result")).toBe("ok");
	});

	it("formats Codex command summaries and diff/change-file variants", () => {
		const completed = event({
			kind: "tool.result",
			text: "fallback text",
			payloadJson: {
				payload: {
					toolName: "run_command",
					command: "npm test",
					status: "completed",
					exitCode: 0,
					aggregatedOutput: "\u001b[32mpassed\u001b[0m",
				},
			},
		});
		expect(formatCodexToolActivitySummary(completed)).toBe(
			"run_command | npm test | completed | exit=0\npassed",
		);
		expect(getCodexCommandOutput(completed)).toBe("passed");
		expect(
			formatCodexToolActivitySummary(
				event({
					kind: "tool.call",
					status: null,
					text: "",
					payloadJson: { exitCode: null },
				}),
			),
		).toContain("exit=pending");
		expect(
			formatCodexToolActivitySummary(
				event({ kind: "", status: "", text: "fallback", payloadJson: {} }),
			),
		).toBe("fallback");

		const diffShapes = [
			event({ payloadJson: { payload: { diff: "payload diff" } } }),
			event({ payloadJson: { code: "code diff" } }),
			event({ payloadJson: { runEvent: { data: { diff: "run diff" } } } }),
		];
		expect(diffShapes.map(getActivityDiffPayload)).toEqual([
			"payload diff",
			"code diff",
			"run diff",
		]);

		const changed = event({
			kind: "file.diff",
			payloadJson: { payload: { changedFiles: ["a.ts", 1, "b.ts"] } },
		});
		expect(getActivityChangedFiles(changed)).toEqual(["a.ts", "b.ts"]);
		expect(isChangedFilesOnlyDiffActivity(changed)).toBe(true);
		expect(
			isChangedFilesOnlyDiffActivity(
				event({
					kind: "file.diff",
					payloadJson: { payload: { diff: "+x", changedFiles: ["a.ts"] } },
				}),
			),
		).toBe(false);
		expect(
			getActivityChangedFiles(
				event({
					payloadJson: {
						runEvent: {
							data: { result: { payload: { changedFiles: ["c.ts", null] } } },
						},
					},
				}),
			),
		).toEqual(["c.ts"]);
		expect(getActivityChangedFiles(event())).toEqual([]);
		expect(
			getChangedFilesFromResult({ payload: { changedFiles: ["d.ts", 2] } }),
		).toEqual(["d.ts"]);
		expect(getChangedFilesFromResult({ changedFiles: ["e.ts"] })).toEqual([
			"e.ts",
		]);
	});

	it("covers record, scalar, array, and timestamp utility boundaries", () => {
		expect(codexActivityData({ payload: { value: 1 } })).toEqual({ value: 1 });
		expect(codexActivityData({ runEvent: { data: { value: 2 } } })).toEqual({
			value: 2,
		});
		expect(codexActivityData({ value: 3 })).toEqual({ value: 3 });
		expect(firstString(null, "", 1, "value")).toBe("value");
		expect(firstString(null, "")).toBeNull();
		expect(firstDefined(undefined, null, 0, "later")).toBe(0);
		expect(firstDefined(undefined, null)).toBeNull();
		expect(firstBoolean("false", false, true)).toBe(false);
		expect(firstBoolean("false", 0)).toBeUndefined();
		expect(firstRecord(null, [], { value: 1 })).toEqual({ value: 1 });
		expect(firstRecord(null, [])).toEqual({});
		expect(normalizeStringArray(["a", 1, "b", null])).toEqual(["a", "b"]);
		expect(normalizeStringArray("a")).toEqual([]);
		expect(nestedValue({ a: { b: 1 } }, ["a", "b"])).toBe(1);
		expect(nestedValue({ a: null }, ["a", "b"])).toBeUndefined();
		expect(isRecord({})).toBe(true);
		expect(isRecord([])).toBe(false);
		expect(isRecord(null)).toBe(false);
		expect(asRecord({ value: 1 })).toEqual({ value: 1 });
		expect(asRecord([])).toEqual({});

		expect(
			transcriptItemTimestamp({
				kind: "assistant_turn",
				events: [{ createdAt }],
			} as never),
		).toBe(Date.parse(createdAt));
		expect(
			transcriptItemTimestamp({
				kind: "activity",
				event: { createdAt },
			} as never),
		).toBe(Date.parse(createdAt));
		expect(
			transcriptItemTimestamp({ kind: "user_turn", events: [] } as never),
		).toBe(Number.MAX_SAFE_INTEGER);
		expect(toMs(undefined)).toBe(Number.MAX_SAFE_INTEGER);
		expect(toMs("invalid-date")).toBe(Number.MAX_SAFE_INTEGER);
		expect(toMs(createdAt)).toBe(Date.parse(createdAt));
	});
});
