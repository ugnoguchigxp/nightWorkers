import { describe, expect, it } from "vitest";
import {
	getToolDiffActivityKind,
	normalizeActivityKind,
	runEventToActivityKind,
	runEventToActivityStatus,
	runEventToActivityText,
	runEventToActivityTurnId,
	schemaFirstAgentEventType,
	schemaFirstPayload,
	shouldProjectRunEventToActivity,
	taskMessageRoleToActivityKind,
	taskMessageRoleToActivitySource,
} from "../api/modules/nightworkers/nightworkers.activity.repository";

describe("nightworkers activity mapping coverage", () => {
	it("normalizes activity kinds, roles, sources, and tool diffs", () => {
		expect(normalizeActivityKind("tool.call")).toBe("tool.call");
		expect(normalizeActivityKind("custom")).toBe("unknown.activity");
		expect(
			["user", "assistant", "tool", "system"].map(
				taskMessageRoleToActivityKind,
			),
		).toEqual([
			"user.message",
			"assistant.message",
			"tool.result",
			"system.info",
		]);
		expect(
			["user", "assistant", "tool", "system"].map(
				taskMessageRoleToActivitySource,
			),
		).toEqual(["user", "assistant", "tool", "system"]);
		expect(getToolDiffActivityKind(null)).toBeNull();
		expect(getToolDiffActivityKind({ intent: "other" })).toBeNull();
		expect(
			getToolDiffActivityKind({ intent: "tool_diff", toolName: "apply_patch" }),
		).toBe("file.patch");
		expect(
			getToolDiffActivityKind({
				intent: "tool_diff",
				toolName: "replace_content",
			}),
		).toBe("file.diff");
		expect(
			getToolDiffActivityKind({ intent: "tool_diff", toolName: "unknown" }),
		).toBe("file.diff");
	});

	it("maps every agent event family to an activity kind", () => {
		const cases: Array<[string, string]> = [
			["model.response_finished", "assistant.raw_output"],
			["round1.parsed", "llm.schema_result"],
			["round2.parsed", "llm.schema_result"],
			["round1.prompt_built", "llm.request"],
			["round2.prompt_built", "llm.request"],
			["procedure.loaded", "runtime.state"],
			["tool.validation_failed", "tool.error"],
			["run.started", "run.status"],
			["run.completed", "run.status"],
			["run.needs_human", "run.status"],
			["run.failed", "system.error"],
		];
		for (const [agentEventType, expected] of cases)
			expect(runEventToActivityKind(null, null, agentEventType)).toBe(expected);
	});

	it("maps every host event family and legacy fallback", () => {
		const cases: Array<[string, string]> = [
			["model.response_delta", "assistant.delta"],
			["model.response_finished", "llm.response_final"],
			["model.request_started", "llm.request"],
			["model.provider_activity_detected", "llm.provider_activity"],
			["model.provider_tool_call_detected", "llm.provider_activity"],
			["model.provider_activity_rejected", "llm.provider_activity"],
			["model.response_parse_failed", "llm.error"],
			["supervisor.decision", "llm.decision_json"],
			["tool.call_started", "tool.call"],
			["tool.call_progress", "tool.call"],
			["tool.call_finished", "tool.result"],
			["tool.policy_blocked", "tool.error"],
			["git.diff_collected", "file.diff"],
			["verification.started", "verification.output"],
			["verification.finished", "verification.output"],
			["run.custom", "run.status"],
			["turn.custom", "run.status"],
			["safety.blocked", "runtime.decision"],
			["system.error", "system.error"],
			["system.ready", "system.info"],
		];
		for (const [eventType, expected] of cases)
			expect(runEventToActivityKind(eventType)).toBe(expected);
		expect(runEventToActivityKind("other", "error")).toBe("system.error");
		expect(runEventToActivityKind("other", "state_change")).toBe(
			"runtime.state",
		);
		expect(runEventToActivityKind("other", "checkpoint")).toBe("runtime.state");
		expect(runEventToActivityKind()).toBe("unknown.activity");
	});

	it("extracts schema-first event types and payload precedence", () => {
		expect(schemaFirstAgentEventType(null)).toBeNull();
		expect(schemaFirstAgentEventType({ agentEventType: "direct" })).toBe(
			"direct",
		);
		expect(
			schemaFirstAgentEventType({
				runEvent: { data: { agentEventType: "nested" } },
			}),
		).toBe("nested");
		expect(schemaFirstAgentEventType({ runEvent: [] })).toBeNull();
		expect(schemaFirstPayload(null)).toEqual({});
		expect(
			schemaFirstPayload({
				payload: { direct: true },
				runEvent: { data: { payload: { nested: true } } },
			}),
		).toEqual({ direct: true });
		expect(
			schemaFirstPayload({ runEvent: { data: { payload: { nested: true } } } }),
		).toEqual({ nested: true });
		expect(
			schemaFirstPayload({ runEvent: { data: { field: "fallback" } } }),
		).toEqual({ field: "fallback" });
		expect(schemaFirstPayload({ runEvent: "bad" })).toEqual({});
	});

	it("selects all projection-worthy event variants", () => {
		for (const agentEventType of [
			"round1.prompt_built",
			"round2.prompt_built",
			"round1.parsed",
			"round2.parsed",
			"procedure.loaded",
			"model.response_finished",
			"tool.started",
			"tool.finished",
			"tool.failed",
			"tool.validation_failed",
			"job.switched",
		])
			expect(shouldProjectRunEventToActivity({ agentEventType })).toBe(true);
		for (const eventType of [
			"model.request_started",
			"model.response_finished",
			"model.response_parse_failed",
			"supervisor.decision",
			"tool.call_started",
			"tool.call_progress",
			"tool.call_finished",
			"tool.policy_blocked",
			"git.diff_collected",
			"run.runtime_started",
			"run.runtime_finished",
			"turn.started",
			"turn.finished",
		])
			expect(shouldProjectRunEventToActivity({ eventType })).toBe(true);
		expect(
			shouldProjectRunEventToActivity({
				eventType: "other",
				agentEventType: "other",
			}),
		).toBe(false);
	});

	it("formats model, schema, prompt, procedure, validation, and tool agent text", () => {
		expect(
			runEventToActivityText({
				eventType: "model.response_finished",
				message: "fallback",
				payload: { payload: { text: "text" } },
			}),
		).toBe("text");
		expect(
			runEventToActivityText({
				eventType: "model.response_finished",
				message: "fallback",
				payload: { payload: { rawContent: "raw" } },
			}),
		).toBe("raw");
		expect(
			runEventToActivityText({
				agentEventType: "model.response_finished",
				message: "fallback",
				payload: { rawContent: "agent raw" },
			}),
		).toBe("agent raw");
		expect(
			runEventToActivityText({
				agentEventType: "round1.parsed",
				message: "",
				payload: { payload: { ok: true } },
			}),
		).toContain('"ok": true');
		expect(
			runEventToActivityText({
				agentEventType: "round2.prompt_built",
				message: "fallback",
				payload: { payload: { systemPrompt: "prompt" } },
			}),
		).toBe("prompt");
		expect(
			runEventToActivityText({
				agentEventType: "procedure.loaded",
				message: "",
				payload: {},
			}),
		).toBe("procedure.loaded");
		expect(
			runEventToActivityText({
				agentEventType: "tool.validation_failed",
				message: "",
				payload: {},
			}),
		).toBe("tool validation failed");
		expect(
			runEventToActivityText({
				agentEventType: "tool.started",
				message: "",
				payload: { payload: { toolName: "read_file" } },
			}),
		).toBe("read_file started");
		expect(
			runEventToActivityText({
				agentEventType: "tool.finished",
				message: "done",
				payload: {},
			}),
		).toBe("done");
		expect(
			runEventToActivityText({
				agentEventType: "tool.failed",
				message: "",
				payload: {},
			}),
		).toBe("tool.failed");
	});

	it("formats rich, sparse, long, and circular tool call payloads", () => {
		const rich = runEventToActivityText({
			eventType: "tool.call_finished",
			message: "fallback",
			payload: {
				payload: {
					toolName: "todo",
					command: "update",
					status: "running",
					exitCode: null,
					arguments: {
						runId: "r1",
						operation: "done",
						todoId: "t1",
						title: "Title",
						status: "done",
						autoStartNext: false,
					},
					error: " failed ",
					result: { ok: true },
					aggregatedOutput: " output ",
				},
			},
		});
		expect(rich).toContain("todo | update | running | exit=pending");
		expect(rich).toContain(
			"todoId=t1 title=Title status=done autoStartNext=false",
		);
		expect(rich).toContain("error: failed");
		expect(rich).toContain("output");

		const sparse = runEventToActivityText({
			eventType: "tool.call_started",
			message: "message",
			payload: { payload: { arguments: { arbitrary: "x" } } },
		});
		expect(sparse).toContain('args: {"arbitrary":"x"}');
		const long = runEventToActivityText({
			eventType: "tool.call_progress",
			message: "",
			payload: { payload: { result: { text: "x".repeat(400) } } },
		});
		expect(long).toContain("…");
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(
			runEventToActivityText({
				eventType: "tool.call_finished",
				message: "fallback",
				payload: { payload: { arguments: circular, result: circular } },
			}),
		).toBe("tool\nargs: ");
	});

	it("formats diff, job switch, finalize, run, and default text", () => {
		expect(
			runEventToActivityText({
				eventType: "git.diff_collected",
				message: "none",
				payload: { payload: { changedFiles: ["a.ts", 1, "b.ts"] } },
			}),
		).toBe("Changed files (2)\na.ts\nb.ts");
		expect(
			runEventToActivityText({
				eventType: "git.diff_collected",
				message: "none",
				payload: { payload: { changedFiles: [] } },
			}),
		).toBe("none");
		expect(
			runEventToActivityText({
				agentEventType: "job.switched",
				message: "",
				payload: { payload: { nextJobType: "verify" } },
			}),
		).toBe("jobType -> verify");
		expect(
			runEventToActivityText({
				agentEventType: "finalize.received",
				message: "fallback",
				payload: { payload: { message: "final" } },
			}),
		).toBe("final");
		expect(
			runEventToActivityText({
				agentEventType: "run.failed",
				message: "fallback",
				payload: { payload: { error: "boom" } },
			}),
		).toBe("boom");
		expect(
			runEventToActivityText({
				agentEventType: "run.completed",
				message: "",
				payload: {},
			}),
		).toBe("run.completed");
		expect(
			runEventToActivityText({
				eventType: "other",
				message: "plain",
				payload: {},
			}),
		).toBe("plain");
	});

	it("maps status and turn IDs", () => {
		expect(runEventToActivityStatus({ agentEventType: "tool.started" })).toBe(
			"started",
		);
		expect(runEventToActivityStatus({ agentEventType: "tool.failed" })).toBe(
			"failed",
		);
		expect(runEventToActivityStatus({ agentEventType: "round1.invalid" })).toBe(
			"failed",
		);
		expect(runEventToActivityStatus({ agentEventType: "round2.invalid" })).toBe(
			"failed",
		);
		expect(
			runEventToActivityStatus({ agentEventType: "tool.validation_failed" }),
		).toBe("failed");
		expect(
			runEventToActivityStatus({ eventType: "model.response_delta" }),
		).toBe("delta");
		expect(runEventToActivityStatus({ legacyType: "error" })).toBe("failed");
		expect(runEventToActivityStatus({})).toBe("completed");
		expect(
			runEventToActivityTurnId({ runId: "r1", agentEventType: "anything" }),
		).toBe("assistant:r1");
		expect(
			runEventToActivityTurnId({
				runId: "r1",
				eventType: "model.response_delta",
			}),
		).toBe("assistant:r1");
		expect(
			runEventToActivityTurnId({
				runId: "r1",
				eventType: "model.response_finished",
			}),
		).toBe("assistant:r1");
		expect(
			runEventToActivityTurnId({ runId: "r1", eventType: "other" }),
		).toBeUndefined();
	});
});
