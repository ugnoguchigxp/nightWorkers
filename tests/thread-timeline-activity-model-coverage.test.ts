import { describe, expect, it } from "vitest";
import {
	activityCodeFilename,
	activityCodeLanguage,
	activityDisplaySummary,
	activityDisplayTitle,
	childEventId,
	fallbackEventText,
	formatLlmOutputJson,
	getActivityCode,
	getActivityDiffCode,
	getEditToolCall,
	getEditToolCallDiff,
	isDiffActivity,
	isHighVolumeActivity,
	isLlmOutputActivity,
	schemaFirstAgentEventType,
} from "../src/modules/nightworkers/components/ThreadTimelineActivityModel";

function event(
	kind: string,
	payloadJson: unknown = {},
	overrides: Record<string, unknown> = {},
) {
	return {
		id: `${kind}-${Math.random()}`,
		taskId: "task-1",
		runId: "run-1",
		kind,
		source: "runtime",
		status: "completed",
		seq: 1,
		text: "",
		payloadJson,
		createdAt: "2026-01-01T00:00:00.000Z",
		visibility: "visible",
		...overrides,
	} as never;
}

describe("thread timeline activity model coverage", () => {
	it("identifies child event ids and fallback text", () => {
		expect(
			childEventId({
				kind: "tool",
				events: [{ id: "one" }, { id: "two" }],
			} as never),
		).toBe("one-two");
		expect(
			childEventId({ kind: "activity", event: { id: "single" } } as never),
		).toBe("single");
		expect(fallbackEventText()).toBe("");
		expect(fallbackEventText(event("custom", {}, { text: "visible" }))).toBe(
			"visible",
		);
		expect(fallbackEventText(event("custom", { key: "value" }))).toContain(
			'"key": "value"',
		);
	});

	it("extracts edit calls from activity models and every fallback envelope", () => {
		const patch =
			"*** Begin Patch\n*** Add File: src/a.ts\n+hello\n*** Delete File: old.ts\n*** Update File: src/b.ts\n*** End Patch";
		const applyShapes = [
			{
				payload: {
					toolCall: { name: "apply_patch", arguments: { patchContent: patch } },
				},
			},
			{ payload: { name: "apply_patch", arguments: { patchContent: patch } } },
			{
				runEvent: {
					data: {
						payload: {
							toolCall: {
								name: "apply_patch",
								arguments: { patchContent: patch },
							},
						},
					},
				},
			},
			{
				runEvent: {
					data: {
						toolCall: {
							name: "apply_patch",
							arguments: { patchContent: patch },
						},
					},
				},
			},
			{
				runEvent: {
					data: { name: "apply_patch", arguments: { patchContent: patch } },
				},
			},
			{ name: "apply_patch", arguments: { patchContent: patch } },
		];
		for (const shape of applyShapes) {
			const activity = event("assistant.raw_output", shape);
			expect(getEditToolCall(activity)?.name).toBe("apply_patch");
			expect(getEditToolCallDiff(activity)).toContain("+++ src/a.ts");
			expect(getActivityCode(activity)).toContain("--- src/b.ts");
		}

		const textActivity = event(
			"assistant.raw_output",
			{},
			{
				text: JSON.stringify({
					toolCall: {
						name: "replace_content",
						arguments: {
							filePath: "src/file.ts",
							needle: "before",
							replacement: "after",
						},
					},
				}),
			},
		);
		expect(getEditToolCallDiff(textActivity)).toContain("- before");
		expect(getEditToolCallDiff(textActivity)).toContain("+ after");

		const missingArgs = event("custom", {
			name: "replace_content",
			arguments: [],
		});
		expect(getEditToolCallDiff(missingArgs)).toContain("unknown");
		expect(getEditToolCall(event("custom", { name: "read_file" }))).toBeNull();
		expect(getEditToolCall(event("custom", null))).toBeNull();
		expect(getEditToolCallDiff(event("custom"))).toBe("");
	});

	it("extracts code from procedure, prompts, model output, runtime payloads, and terminal results", () => {
		const cases: Array<[ReturnType<typeof event>, string]> = [
			[
				event("custom", {
					agentEventType: "procedure.loaded",
					payload: { procedure: "# Procedure" },
				}),
				"# Procedure",
			],
			[
				event("custom", {
					agentEventType: "procedure.loaded",
					procedure: "fallback procedure",
				}),
				"fallback procedure",
			],
			[event("custom", { rawContent: "raw top" }), "raw top"],
			[event("custom", { systemPrompt: "system top" }), "system top"],
			[event("custom", { userPrompt: "user top" }), "user top"],
			[
				event("llm.response_final", { payload: { text: "final text" } }),
				"final text",
			],
			[
				event("custom", { payload: { rawContent: "raw nested" } }),
				"raw nested",
			],
			[
				event("custom", { payload: { systemPrompt: "system nested" } }),
				"system nested",
			],
			[
				event("custom", { payload: { userPrompt: "user nested" } }),
				"user nested",
			],
			[event("runtime.snapshot", { payload: { value: 1 } }), '"value": 1'],
			[event("custom", { code: "const value = 1" }), "const value = 1"],
			[
				event("custom", {
					agentEventType: "model.response_delta",
					text: "delta",
				}),
				"delta",
			],
			[
				event("llm.delta", { runEvent: { data: { text: "run delta" } } }),
				"run delta",
			],
			[
				event("custom", { runEvent: { data: { rawContent: "run raw" } } }),
				"run raw",
			],
			[
				event("custom", {
					runEvent: {
						data: {
							result: { payload: { stdout: "\u001b[31mstdout\u001b[0m" } },
						},
					},
				}),
				"stdout",
			],
			[
				event("custom", {
					runEvent: { data: { result: { payload: { stderr: "stderr" } } } },
				}),
				"stderr",
			],
		];
		for (const [activity, expected] of cases) {
			expect(getActivityCode(activity)).toContain(expected);
		}
		expect(getActivityCode(event("custom"))).toBe("");
		expect(
			getActivityDiffCode(
				event("file.diff", { payload: { diff: "@@ patch" } }),
			),
		).toContain("patch");
	});

	it("formats LLM output from code, text, payload, and run-event data", () => {
		expect(
			formatLlmOutputJson(
				event("llm.schema_result", { rawContent: '{"ok":true}' }),
				{},
			),
		).toContain('"ok": true');
		expect(
			formatLlmOutputJson(
				event("llm.response_final", {}, { text: '{"answer":1}' }),
				{},
			),
		).toContain('"answer": 1');
		expect(
			formatLlmOutputJson(event("custom", {}, { text: "plain text" }), {}),
		).toBe("plain text");
		expect(
			formatLlmOutputJson(event("custom"), { payload: { a: 1 } }),
		).toContain('"a": 1');
		expect(
			formatLlmOutputJson(event("custom"), { runEvent: { data: { b: 2 } } }),
		).toContain('"b": 2');
		expect(formatLlmOutputJson(event("custom"), null)).toBe("{}");
	});

	it("chooses filenames and languages for all activity classes", () => {
		const apply = event("custom", {
			name: "apply_patch",
			arguments: { patchContent: "+x" },
		});
		const replace = event("custom", {
			name: "replace_content",
			arguments: {},
		});
		expect(activityCodeFilename(apply)).toBe("apply_patch.patch");
		expect(activityCodeFilename(replace)).toBe("replace_content.diff");
		expect(activityCodeLanguage(apply)).toBe("diff");

		const filenameCases: Array<[ReturnType<typeof event>, string, string]> = [
			[
				event("custom", {
					agentEventType: "procedure.loaded",
					payload: { procedurePath: "skills/SKILL.md" },
				}),
				"skills/SKILL.md",
				"markdown",
			],
			[
				event("custom", { agentEventType: "procedure.loaded" }),
				"procedure.md",
				"markdown",
			],
			[event("file.patch"), "activity.patch", "diff"],
			[event("file.diff"), "activity.diff", "diff"],
			[event("llm.response_final"), "assistant-response.txt", "text"],
			[event("decision.json"), "activity.json", "json"],
			[event("llm.schema_result"), "activity.json", "json"],
			[
				event("custom", { agentEventType: "round1.prompt_built" }),
				"prompt.txt",
				"text",
			],
			[event("custom"), "custom", "text"],
		];
		for (const [activity, filename, language] of filenameCases) {
			expect(activityCodeFilename(activity)).toBe(filename);
			expect(activityCodeLanguage(activity)).toBe(language);
		}
	});

	it("maps work records and every schema-first event title", () => {
		for (const [card, title] of [
			[{ type: "command", executionMode: "background" }, "Background command"],
			[{ type: "command", executionMode: "foreground" }, "Command"],
			[{ type: "file" }, "File edit"],
			[{ type: "failure" }, "Needs attention"],
		] as const) {
			expect(
				activityDisplayTitle(
					event("custom", { workRecordCard: card }),
					"Fallback",
				),
			).toBe(title);
		}
		const titles: Record<string, string> = {
			"run.started": "Run started",
			"round1.prompt_built": "Round 1 prompt",
			"round1.parsed": "Round 1 jobType",
			"procedure.loaded": "Procedure loaded",
			"round2.prompt_built": "Round 2 prompt",
			"round2.parsed": "Round 2 toolCall",
			"round2.invalid": "Round 2 invalid",
			"model.request_started": "LLM request",
			"model.response_finished": "LLM raw output",
			"tool.started": "Tool started",
			"tool.finished": "Tool result",
			"tool.failed": "Tool failed",
			"tool.validation_failed": "Tool validation failed",
			"job.switched": "Job switched",
			"finalize.received": "Final answer",
			"run.completed": "Run completed",
			"run.needs_human": "Needs human",
			"run.failed": "Run failed",
		};
		for (const [agentEventType, title] of Object.entries(titles)) {
			expect(
				activityDisplayTitle(event("custom", { agentEventType }), "Fallback"),
			).toBe(title);
		}
		expect(activityDisplayTitle(event("custom"), "Fallback")).toBe("Fallback");
	});

	it("summarizes LLM usage, work records, tools, final text, diffs, and fallbacks", () => {
		expect(
			activityDisplaySummary(
				event("llm.usage", {
					payload: {
						inputTokens: 1200.9,
						cachedInputTokens: "200",
						outputTokens: "bad",
					},
				}),
			),
		).toContain("Input:");
		expect(activityDisplaySummary(event("llm.usage", { payload: {} }))).toBe(
			"completed",
		);
		expect(
			activityDisplaySummary(
				event("custom", {
					payload: {
						workRecordCard: { type: "command" },
						command: "bun test",
						status: "completed",
						exitCode: 0,
						cwd: "/repo",
						stopReason: "done",
						outputSummary: "passed",
					},
				}),
			),
		).toContain("exit=0");
		expect(
			activityDisplaySummary(
				event("custom", {
					workRecordCard: { type: "file" },
					command: "edit",
					status: "done",
					exitCode: 1,
				}),
			),
		).toContain("exit=1");

		const summaries: Array<[ReturnType<typeof event>, string]> = [
			[
				event("custom", {
					agentEventType: "round1.parsed",
					payload: { jobType: "implementation" },
				}),
				"implementation",
			],
			[
				event("custom", {
					agentEventType: "round2.parsed",
					payload: {
						toolCall: {
							name: "read_file",
							arguments: { filePath: "src/a.ts" },
						},
					},
				}),
				"read_file: src/a.ts",
			],
			[
				event("custom", {
					agentEventType: "tool.started",
					payload: {
						toolCall: {
							name: "run_command",
							arguments: { command: "bun test" },
						},
					},
				}),
				"run_command: bun test",
			],
			[
				event("custom", {
					agentEventType: "tool.started",
					payload: {
						toolCall: { name: "search", arguments: { query: "needle" } },
					},
				}),
				"search: needle",
			],
			[
				event("custom", {
					agentEventType: "tool.started",
					payload: { toolCall: { arguments: [] } },
				}),
				"toolCall",
			],
			[
				event("custom", {
					agentEventType: "tool.finished",
					payload: { toolName: "read_file" },
				}),
				"read_file",
			],
			[
				event(
					"custom",
					{ agentEventType: "tool.finished" },
					{ text: "finished fallback" },
				),
				"finished fallback",
			],
			[
				event("custom", {
					agentEventType: "finalize.received",
					payload: { message: "final message" },
				}),
				"final message",
			],
			[
				event("llm.response_final", { payload: { rawContent: "raw final" } }),
				"raw final",
			],
			[
				event("custom", {
					agentEventType: "procedure.loaded",
					payload: { procedurePath: "SKILL.md" },
				}),
				"SKILL.md",
			],
			[
				event(
					"custom",
					{ agentEventType: "procedure.loaded" },
					{ text: "procedure text" },
				),
				"procedure text",
			],
			[
				event(
					"custom",
					{ agentEventType: "round1.prompt_built" },
					{ text: "prompt text" },
				),
				"prompt text",
			],
			[event("custom", {}, { text: "plain" }), "plain"],
			[event("custom", {}, { text: "", ingestError: "invalid" }), "invalid"],
			[event("custom", {}, { text: "", status: "failed" }), "failed"],
		];
		for (const [activity, summary] of summaries) {
			expect(activityDisplaySummary(activity)).toBe(summary);
		}
	});

	it("classifies output, diff, schema, and high-volume activities", () => {
		for (const kind of [
			"assistant.raw_output",
			"llm.schema_result",
			"llm.decision_json",
			"llm.response_delta",
			"llm.response_final",
		]) {
			expect(isLlmOutputActivity(event(kind))).toBe(true);
		}
		expect(isLlmOutputActivity(event("custom"))).toBe(false);
		expect(isDiffActivity(event("file.patch"))).toBe(true);
		expect(isDiffActivity(event("file.diff"))).toBe(true);
		expect(isDiffActivity(event("custom"))).toBe(false);
		expect(
			schemaFirstAgentEventType(
				event("custom", { agentEventType: "run.started" }),
			),
		).toBe("run.started");
		expect(
			schemaFirstAgentEventType(event("custom", { agentEventType: 1 })),
		).toBe("");
		expect(
			isHighVolumeActivity(
				event("custom", { agentEventType: "model.response_finished" }),
			),
		).toBe(true);
		expect(
			isHighVolumeActivity(
				event("custom", { agentEventType: "round1.prompt_built" }),
			),
		).toBe(true);
		expect(isHighVolumeActivity(event("assistant.raw_output"))).toBe(true);
		expect(isHighVolumeActivity(event("custom"))).toBe(false);
	});
});
