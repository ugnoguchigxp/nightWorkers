import { describe, expect, it, vi } from "vitest";
import * as repo from "../../api/modules/nightworkers/nightworkers.repository";
import { dispatchNativeApiToolCall } from "../../api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher";
import { getNativeApiToolDefinitions } from "../../api/services/agent-runtime/native-api-runner/native-api-tool-registry";
import type { AgentRuntimeEvent } from "../../api/services/agent-runtime/types";
import { buildContext, createSink } from "./helpers";
import "./setup";

describe("NativeApiRunner tool registry and dispatcher gates", () => {
	it("does not expose todo_list list as a model-visible operation", () => {
		const todoTool = getNativeApiToolDefinitions().find(
			(tool) => tool.name === "todo_list",
		);

		expect(todoTool?.inputSchema).toMatchObject({
			properties: {
				operation: {
					enum: ["replace", "start", "done", "block", "fail"],
				},
				todoListReplaceReason: {
					enum: [
						"initial_plan",
						"scope_changed",
						"estimate_changed",
						"newly_required_work",
						"blocked_replan",
					],
				},
			},
		});
	});

	it("rejects todo_list list as progress evidence at dispatch time", async () => {
		const result = await dispatchNativeApiToolCall({
			toolCall: {
				id: "call-todos",
				name: "todo_list",
				arguments: { operation: "list" },
			},
			context: buildContext(),
			sink: createSink(),
			state: { readFiles: [], specificationRead: true },
		});

		expect(result.kind).toBe("continue");
		expect(result.toolResult).toMatchObject({
			ok: false,
			error: {
				code: "INVALID_TOOL_ARGS",
			},
		});
		expect(result.toolResult.error?.message).toContain("operation=start");
	});

	it("restricts model-visible tools in planning mode", () => {
		const toolNames = getNativeApiToolDefinitions({
			executionMode: "planning",
		}).map((tool) => tool.name);

		expect(toolNames).toEqual(
			expect.arrayContaining([
				"read_current_specification",
				"list_dir",
				"read_file",
				"search_files",
				"git_status",
				"list_mcp_tools",
				"context_initial_instructions",
				"context_compile",
				"context_decision",
				"new_context",
				"finalize_answer",
			]),
		);
		expect(toolNames).not.toContain("apply_patch");
		expect(toolNames).not.toContain("replace_content");
		expect(toolNames).not.toContain("import_project");
		expect(toolNames).not.toContain("run_verification");
		expect(toolNames).not.toContain("todo_list");
	});

	it("exposes todo_list in review mode so Review Run Todos can progress", () => {
		const toolNames = getNativeApiToolDefinitions({
			executionMode: "review",
			currentTodo: {
				taskType: "inspection",
				procedureId: "review.read_plan_spec",
			},
		}).map((tool) => tool.name);

		expect(toolNames).toEqual(
			expect.arrayContaining([
				"read_current_specification",
				"git_diff",
				"run_verification",
				"context_decision",
				"todo_list",
				"finalize_answer",
			]),
		);
		expect(toolNames).not.toContain("apply_patch");
		expect(toolNames).not.toContain("replace_content");
		expect(toolNames).not.toContain("import_project");
	});

	it("keeps core coding tools visible while hiding one-shot procedure tools by default", () => {
		const toolNames = getNativeApiToolDefinitions({
			executionMode: "implementation",
			currentTodo: {
				taskType: "implementation",
				procedureId: null,
			},
		}).map((tool) => tool.name);

		expect(toolNames).toEqual(
			expect.arrayContaining([
				"read_current_specification",
				"list_dir",
				"read_file",
				"search_files",
				"apply_patch",
				"replace_content",
				"run_verification",
				"git_status",
				"git_diff",
				"context_decision",
				"todo_list",
				"new_context",
				"finalize_answer",
			]),
		);
		expect(toolNames).not.toContain("import_project");
		expect(toolNames).not.toContain("context_initial_instructions");
		expect(toolNames).not.toContain("context_compile");
		expect(toolNames).not.toContain("compile_eval");
		expect(toolNames).not.toContain("register_candidates");
		expect(toolNames).not.toContain("mcp_call_tool");
	});

	it("exposes one-shot procedure tools only for matching current Todos", () => {
		const importTools = getNativeApiToolDefinitions({
			executionMode: "implementation",
			currentTodo: { taskType: "import", procedureId: "import_project" },
		}).map((tool) => tool.name);
		const contextTools = getNativeApiToolDefinitions({
			executionMode: "implementation",
			currentTodo: {
				taskType: "context_compile",
				procedureId: "contextstill.context_compile",
			},
		}).map((tool) => tool.name);
		const legacyKnowledgeTools = getNativeApiToolDefinitions({
			executionMode: "implementation",
			currentTodo: {
				taskType: "knowledge_capture",
				procedureId: "contextstill.register_candidates",
			},
		}).map((tool) => tool.name);
		const closeoutTools = getNativeApiToolDefinitions({
			executionMode: "implementation",
			currentTodo: {
				taskType: "compile_eval",
				procedureId: "contextstill.compile_eval",
			},
		}).map((tool) => tool.name);

		expect(importTools).toContain("import_project");
		expect(contextTools).toContain("context_compile");
		expect(legacyKnowledgeTools).not.toContain("register_candidates");
		expect(closeoutTools).toContain("compile_eval");
		expect(closeoutTools).not.toContain("import_project");
	});

	it("exposes generic MCP calls only when ontology MCP is enabled", () => {
		const defaultTools = getNativeApiToolDefinitions({
			executionMode: "implementation",
		}).map((tool) => tool.name);
		const ontologyTools = getNativeApiToolDefinitions({
			executionMode: "implementation",
			ontologyMcpEnabled: true,
		}).map((tool) => tool.name);

		expect(defaultTools).not.toContain("list_mcp_tools");
		expect(defaultTools).not.toContain("mcp_call_tool");
		expect(ontologyTools).toContain("list_mcp_tools");
		expect(ontologyTools).toContain("mcp_call_tool");
	});

	it("exposes Codex-style new_context as an empty model-visible tool", () => {
		const newContextTool = getNativeApiToolDefinitions().find(
			(tool) => tool.name === "new_context",
		);

		expect(newContextTool).toMatchObject({
			name: "new_context",
			description:
				"Start a new context window without summarizing conversation history.",
			inputSchema: {
				type: "object",
				properties: {},
				required: [],
				additionalProperties: false,
			},
		});
	});

	it("exposes compile_eval with the contextStill-required closeout fields when closeout is current", () => {
		const compileEvalTool = getNativeApiToolDefinitions({
			currentTodo: {
				taskType: "compile_eval",
				procedureId: "contextstill.compile_eval",
			},
		}).find((tool) => tool.name === "compile_eval");

		expect(compileEvalTool?.inputSchema).toMatchObject({
			required: [
				"actionability",
				"body",
				"clarity",
				"coverage",
				"outcome",
				"relevance",
				"specificity",
			],
		});
	});

	it("marks the dispatch state when new_context is called", async () => {
		const result = await dispatchNativeApiToolCall({
			toolCall: { id: "call-new-context", name: "new_context", arguments: {} },
			context: buildContext(),
			sink: createSink(),
			state: { readFiles: [], specificationRead: true },
		});

		expect(result.kind).toBe("continue");
		expect(result.state).toMatchObject({
			newContextWindowRequested: true,
		});
		expect(result.toolResult).toMatchObject({
			ok: true,
			payload: {
				newContextWindowRequested: true,
			},
		});
	});

	it("rejects mutating tools in planning mode even if the provider asks for them", async () => {
		const result = await dispatchNativeApiToolCall({
			toolCall: {
				id: "call-patch",
				name: "apply_patch",
				arguments: { patchContent: "*** Begin Patch\n*** End Patch\n" },
			},
			context: buildContext({ runtimeOptions: { executionMode: "planning" } }),
			sink: createSink(),
			state: { readFiles: [], specificationRead: true },
		});

		expect(result.kind).toBe("continue");
		expect(result.toolResult).toMatchObject({
			ok: false,
			error: {
				code: "TOOL_NOT_ALLOWED_FOR_MODE",
			},
		});
	});

	it("includes original tool arguments in native/api worker tool finished events", async () => {
		const events: AgentRuntimeEvent[] = [];
		const result = await dispatchNativeApiToolCall({
			toolCall: {
				id: "call-read-file",
				name: "read_file",
				arguments: {
					filePath: "package.json",
					startLine: 1,
					endLine: 5,
					compressionMode: "off",
				},
			},
			context: buildContext(),
			sink: createSink(events),
			state: { readFiles: [], specificationRead: true },
		});

		expect(result.kind).toBe("continue");
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "tool_call_finished",
					payload: expect.objectContaining({
						callId: "call-read-file",
						toolName: "read_file",
						arguments: expect.objectContaining({
							filePath: "package.json",
							startLine: 1,
							endLine: 5,
						}),
						ok: true,
						result: expect.objectContaining({
							totalLines: expect.any(Number),
							linesReturned: 5,
						}),
					}),
				}),
			]),
		);
	});

	it("rejects empty context_compile input before any MCP dispatch", async () => {
		const result = await dispatchNativeApiToolCall({
			toolCall: { id: "call-context", name: "context_compile", arguments: {} },
			context: buildContext(),
			sink: createSink(),
			state: { readFiles: [], specificationRead: true },
		});

		expect(result.kind).toBe("continue");
		expect(result.toolResult).toMatchObject({
			ok: false,
			error: {
				code: "INVALID_TOOL_ARGS",
			},
		});
	});

	it("rejects empty context_decision input before any MCP dispatch", async () => {
		const result = await dispatchNativeApiToolCall({
			toolCall: {
				id: "call-decision",
				name: "context_decision",
				arguments: {},
			},
			context: buildContext(),
			sink: createSink(),
			state: { readFiles: [], specificationRead: true },
		});

		expect(result.kind).toBe("continue");
		expect(result.toolResult).toMatchObject({
			ok: false,
			error: {
				code: "INVALID_TOOL_ARGS",
			},
		});
	});

	it("blocks context_initial_instructions until read_current_specification has succeeded", async () => {
		const result = await dispatchNativeApiToolCall({
			toolCall: {
				id: "call-initial",
				name: "context_initial_instructions",
				arguments: {},
			},
			context: buildContext(),
			sink: createSink(),
			state: { readFiles: [], specificationRead: false },
		});

		expect(result.kind).toBe("continue");
		expect(result.toolResult).toMatchObject({
			ok: false,
			error: {
				code: "SPECIFICATION_REQUIRED",
			},
		});
	});

	it("blocks context_compile until read_current_specification has succeeded", async () => {
		const result = await dispatchNativeApiToolCall({
			toolCall: {
				id: "call-context",
				name: "context_compile",
				arguments: { goal: "implement native API runner" },
			},
			context: buildContext(),
			sink: createSink(),
			state: { readFiles: [], specificationRead: false },
		});

		expect(result.kind).toBe("continue");
		expect(result.toolResult).toMatchObject({
			ok: false,
			error: {
				code: "SPECIFICATION_REQUIRED",
			},
		});
	});

	it("returns actionable Todo recovery hints when finalize_answer is blocked by open Todos", async () => {
		(repo.listTaskRunTodosForRun as never).mockResolvedValue([
			{
				seq: 3,
				title: "Implement Todo list UI",
				taskType: "implementation",
				status: "running",
				procedureId: null,
			},
			{
				seq: 4,
				title: "Verify Todo list UI",
				taskType: "verification",
				status: "pending",
				procedureId: "quality_gate_verify",
			},
		]);

		const result = await dispatchNativeApiToolCall({
			toolCall: {
				id: "call-final",
				name: "finalize_answer",
				arguments: { finalReport: "done" },
			},
			context: buildContext(),
			sink: createSink(),
			state: { readFiles: [], specificationRead: true },
		});

		expect(result.kind).toBe("continue");
		expect(result.toolResult).toMatchObject({
			ok: false,
			error: {
				code: "OPEN_TODOS_REMAIN",
				details: {
					nextAction: {
						operation: "done",
						seq: 3,
						example: "todo_list operation=done seq=3",
					},
				},
			},
			payload: {
				openTodos: [
					expect.objectContaining({
						seq: 3,
						title: "Implement Todo list UI",
					}),
					expect.objectContaining({
						seq: 4,
						title: "Verify Todo list UI",
					}),
				],
			},
		});
		expect(result.toolResult.content).toContain(
			"todo_list operation=done seq=3",
		);
	});

	it("blocks finalize_answer while the required migration execution Todo remains open", async () => {
		(repo.listTaskRunTodosForRun as never).mockResolvedValue([
			{
				seq: 4,
				title: "DB migration を実行する",
				taskType: "data_migration",
				status: "pending",
				procedureId: "data_migration.apply_migration",
			},
		]);

		const result = await dispatchNativeApiToolCall({
			toolCall: {
				id: "call-final",
				name: "finalize_answer",
				arguments: { finalReport: "done" },
			},
			context: buildContext({
				runtimeOptions: {
					executionMode: "implementation",
					jobType: "data_migration",
				},
			}),
			sink: createSink(),
			state: { readFiles: [], specificationRead: true },
		});

		expect(result.kind).toBe("continue");
		expect(result.toolResult).toMatchObject({
			ok: false,
			error: {
				code: "OPEN_TODOS_REMAIN",
				details: {
					nextAction: {
						operation: "start",
						seq: 4,
						example: "todo_list operation=start seq=4",
					},
				},
			},
		});
		expect(result.toolResult.content).toContain(
			"data_migration.apply_migration",
		);
	});

	it("closes the final completion_report Todo when finalize_answer succeeds", async () => {
		const completionTodo = {
			id: "todo-final",
			seq: 9,
			title: "完了報告を行う",
			taskType: "completion_report",
			status: "pending",
			procedureId: "final_completion_report",
			startedAt: null,
		};
		vi.mocked(repo.listTaskRunTodosForRun)
			.mockResolvedValueOnce([completionTodo] as never)
			.mockResolvedValueOnce([] as never);

		const result = await dispatchNativeApiToolCall({
			toolCall: {
				id: "call-final",
				name: "finalize_answer",
				arguments: {
					summary: "done",
					finalReport: "Todo List implementation is complete.",
				},
			},
			context: buildContext(),
			sink: createSink(),
			state: { readFiles: [], specificationRead: true },
		});

		expect(result).toMatchObject({
			kind: "final",
			summary: "done",
			finalReport: "Todo List implementation is complete.",
		});
		expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
			"todo-final",
			{
				status: "passed",
				startedAt: expect.any(Date),
				completedAt: expect.any(Date),
			},
			{ notifyTaskId: "task-1", notifyRunId: "run-1" },
		);
	});
});
