import { describe, expect, it } from "vitest";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { getAllowedToolsForJobType } from "../api/services/supervisor/prompt";
import { executeWorkerTool } from "../api/services/worker-tools/dispatcher";
import {
	listRecentSpecificationsTool,
	readCurrentSpecificationTool,
} from "../api/services/worker-tools/read-current-specification";
import { todoListTool } from "../api/services/worker-tools/todo-list";

describe("read_current_specification worker tool", () => {
	it("reads the latest feature_plan markdown for a task without external MCP settings", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: read spec ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: read current specification",
			description: "Read specification artifact",
			status: "draft",
		});

		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# Blueprint\n\nNot the spec.",
			messageType: "markdown_document",
			payloadJson: {
				intent: "app_blueprint",
				appBlueprint: { id: "bp-1", name: "Blueprint" },
			},
		});
		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# Data Model\n\nNot the feature plan.",
			messageType: "markdown_document",
			payloadJson: {
				artifactKind: "plan_mode_dedicated_view",
				view: "data_model",
				artifactType: "data_model",
				title: "Data Model",
			},
		});
		const specMessage = await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# Feature Plan\n\nUse this document.",
			messageType: "markdown_document",
			payloadJson: {
				intent: "feature_plan",
				title: "Feature Plan",
				questionnaireSessionId: "11111111-1111-4111-8111-111111111111",
				generation: {
					source: "llm",
					context: {
						blueprintSummaryIncluded: true,
						dataModelReferenceIncluded: true,
					},
				},
				markdownDocumentData: {
					title: "Feature Plan",
					content: "# Feature Plan\n\nUse this document.",
				},
			},
		});

		const dispatch = await executeWorkerTool({
			toolName: "read_current_specification",
			args: {},
			repoRoot: "/Users/y.noguchi/Code/nightWorkers",
			taskId: task.id,
			readFiles: [],
		});

		expect(dispatch.result.ok).toBe(true);
		expect(dispatch.result.payload).toMatchObject({
			taskId: task.id,
			found: true,
			messageId: specMessage.id,
			title: "Feature Plan",
			content: "# Feature Plan\n\nUse this document.",
			sources: {
				questionnaireSessionId: "11111111-1111-4111-8111-111111111111",
				blueprintSummaryIncluded: true,
				dataModelReferenceIncluded: true,
			},
		});
		expect(String((dispatch.result.payload as never).digest)).toMatch(
			/^sha256:/,
		);
	});

	it("keeps legacy draft_spec markdown readable during artifact migration", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: read legacy spec ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: read legacy current specification",
			description: "Read legacy specification artifact",
			status: "draft",
		});

		const specMessage = await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# Legacy Specification\n\nUse this legacy document.",
			messageType: "markdown_document",
			payloadJson: {
				intent: "draft_spec",
				title: "Legacy Specification",
				generation: {
					context: {
						dbDdlReferenceIncluded: true,
					},
				},
			},
		});

		const dispatch = await executeWorkerTool({
			toolName: "read_current_specification",
			args: {},
			repoRoot: "/Users/y.noguchi/Code/nightWorkers",
			taskId: task.id,
			readFiles: [],
		});

		expect(dispatch.result.ok).toBe(true);
		expect(dispatch.result.payload).toMatchObject({
			taskId: task.id,
			found: true,
			messageId: specMessage.id,
			title: "Legacy Specification",
			content: "# Legacy Specification\n\nUse this legacy document.",
			sources: {
				dataModelReferenceIncluded: true,
				dbDdlReferenceIncluded: true,
			},
		});
	});

	it("optionally assembles Plan Mode artifact contracts with the current specification", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: read spec design context ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: read current specification with design context",
			description:
				"Read specification artifact and assembled Plan Mode contracts",
			status: "draft",
		});

		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# Blueprint\n\nTodo screen.",
			messageType: "markdown_document",
			payloadJson: {
				intent: "mock_blueprint",
				title: "Todo Blueprint",
				mockBlueprint: {
					name: "Todo Blueprint",
					screens: [{ name: "Todo List", path: "/todos", sections: [] }],
				},
			},
		});
		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# API Contract\n\nPOST /api/todos",
			messageType: "markdown_document",
			payloadJson: {
				intent: "plan_mode_dedicated_view",
				artifactKind: "plan_mode_api_contract",
				view: "api_io_contract",
				title: "Todo API Contract",
				apiContract: {
					artifactKind: "plan_mode_api_contract",
					view: "api_io_contract",
					title: "Todo API Contract",
					openapi: {
						openapi: "3.1.0",
						info: { title: "Todo API", version: "0.1.0" },
						paths: {
							"/api/todos": {
								post: {
									operationId: "createTodo",
									summary: "Create todo task",
								},
							},
						},
						components: { schemas: {} },
					},
				},
			},
		});
		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# Feature Plan\n\n## 目的\nTodo を実装する。",
			messageType: "markdown_document",
			payloadJson: {
				intent: "feature_plan",
				title: "Feature Plan",
				markdownDocumentData: {
					title: "Feature Plan",
					content: "# Feature Plan\n\n## 目的\nTodo を実装する。",
				},
			},
		});

		const result = await readCurrentSpecificationTool({
			taskId: task.id,
			includeDesignContext: true,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.content).toContain("## 目的");
		expect(
			result.payload.assembledDesignContext?.sections.map(
				(section) => section.kind,
			),
		).toEqual(expect.arrayContaining(["blueprint", "api_io_contract"]));
		expect(
			result.payload.assembledDesignContext?.sections.find(
				(section) => section.kind === "api_io_contract",
			)?.content,
		).toContain("POST /api/todos (createTodo)");
		expect(result.payload.sources).toMatchObject({
			assembledDesignContextIncluded: true,
		});
		expect(result.payload.sources.sourceMessageIds).toEqual(
			expect.arrayContaining([expect.any(String)]),
		);
	});

	it("returns compact specification view by default and full markdown on explicit request", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: read compact spec ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: read compact current specification",
			status: "draft",
		});
		const longContent = [
			"# Feature Plan",
			"",
			"## Purpose",
			"Keep this purpose.",
			...Array.from({ length: 900 }, (_, index) => `Noise line ${index}`),
			"## Verification",
			"Run bun run verify.",
			...Array.from({ length: 900 }, (_, index) => `Tail noise ${index}`),
		].join("\n");
		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: longContent,
			messageType: "markdown_document",
			payloadJson: {
				intent: "feature_plan",
				title: "Feature Plan",
				markdownDocumentData: {
					title: "Feature Plan",
					content: longContent,
				},
			},
		});

		const compact = await readCurrentSpecificationTool({ taskId: task.id });
		const full = await readCurrentSpecificationTool({
			taskId: task.id,
			view: "full",
		});

		expect(compact.ok).toBe(true);
		expect(compact.payload.view).toBe("compact");
		expect(compact.payload.content).toContain("[specification-compact-view]");
		expect(compact.payload.content).toContain("## Purpose");
		expect(compact.payload.content).toContain("## Verification");
		expect(compact.payload.content.length).toBeLessThan(longContent.length);
		expect(compact.payload.fullContentChars).toBe(longContent.length);
		expect(compact.payload.fullContentDigest).toMatch(/^sha256:/);

		expect(full.ok).toBe(true);
		expect(full.payload.view).toBe("full");
		expect(full.payload.content).toBe(longContent);
		expect(full.payload.fullContentChars).toBe(longContent.length);
		expect(full.payload.digest).toBe(compact.payload.digest);
	});

	it("keeps Japanese feature-plan contract sections in compact views", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: read compact jp spec ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: read compact Japanese current specification",
			status: "draft",
		});
		const longContent = [
			"# Feature Plan",
			"",
			"## 目的",
			"Todo を実装する。",
			...Array.from({ length: 900 }, (_, index) => `Noise line ${index}`),
			"## スコープ",
			"- 対象: Todo CRUD",
			"## タスク分類",
			"標準タスク",
			"## 実装計画",
			"1. API Contract artifact を正として route を実装する。",
			"## 検証計画",
			"`bun run verify` を実行する。",
			"## 完了条件",
			"検証が成功している。",
			...Array.from({ length: 900 }, (_, index) => `Tail noise ${index}`),
		].join("\n");
		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: longContent,
			messageType: "markdown_document",
			payloadJson: {
				intent: "feature_plan",
				title: "Feature Plan",
				markdownDocumentData: {
					title: "Feature Plan",
					content: longContent,
				},
			},
		});

		const compact = await readCurrentSpecificationTool({ taskId: task.id });

		expect(compact.ok).toBe(true);
		expect(compact.payload.content).toContain("## 目的");
		expect(compact.payload.content).toContain("## スコープ");
		expect(compact.payload.content).toContain("## タスク分類");
		expect(compact.payload.content).toContain("## 実装計画");
		expect(compact.payload.content).toContain("## 検証計画");
		expect(compact.payload.content).toContain("## 完了条件");
		expect(compact.payload.content.length).toBeLessThan(longContent.length);
	});

	it("returns found=false when no specification has been generated", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: no spec ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: no current specification",
			description: "No specification artifact",
			status: "draft",
		});

		const dispatch = await executeWorkerTool({
			toolName: "read_current_specification",
			args: { taskId: task.id },
			repoRoot: "/Users/y.noguchi/Code/nightWorkers",
			readFiles: [],
		});

		expect(dispatch.result.ok).toBe(true);
		expect(dispatch.result.payload).toMatchObject({
			taskId: task.id,
			found: false,
			content: "",
			messageId: null,
		});
	});

	it("lists recent feature plans for Codex MCP discovery", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: list specs ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: listed current specification",
			status: "draft",
		});

		const specMessage = await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# Listed Feature Plan\n\nUse this document.",
			messageType: "markdown_document",
			payloadJson: {
				intent: "feature_plan",
				markdownDocumentData: {
					title: "Listed Feature Plan",
					content: "# Listed Feature Plan\n\nUse this document.",
				},
			},
		});

		const result = await listRecentSpecificationsTool({ limit: 20 });

		expect(result.ok).toBe(true);
		expect(result.payload.specifications).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					taskId: task.id,
					taskTitle: "TEST: listed current specification",
					messageId: specMessage.id,
					title: "Listed Feature Plan",
				}),
			]),
		);
	});

	it("is available to implementation-oriented supervisor jobs", () => {
		const majorTools = getAllowedToolsForJobType("major_code_edit").map(
			(tool) => tool.name,
		);
		expect(
			getAllowedToolsForJobType("minor_code_edit").map((tool) => tool.name),
		).toContain("read_current_specification");
		expect(majorTools).toContain("read_current_specification");
		expect(majorTools).toContain("import_project");
		expect(majorTools).toContain("todo_list");
		expect(majorTools.filter((tool) => tool.startsWith("todo_"))).toEqual([
			"todo_list",
		]);
	});
});

describe("todo_list worker tool", () => {
	it("persists LLM-decomposed implementation Todos with fixed NightWorkers gates", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: replace todos ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: replace TodoList",
			description: "Create a standard implementation TodoList",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});

		const result = await todoListTool({
			runId: run.id,
			operation: "replace",
			todos: [
				{
					seq: 1,
					title: "Inspect current implementation",
					taskType: "inspection",
				},
			],
		});

		expect(result.ok).toBe(true);
		expect(result.payload).toMatchObject({
			runId: run.id,
			taskId: task.id,
			action: "todo_list",
			operation: "replace",
		});
		expect(result.payload.todos.map((todo) => todo.taskType)).toEqual([
			"initial_instructions",
			"context_compile",
			"inspection",
			"verification",
			"completion_report",
		]);
		expect(result.payload.todos[0]).toMatchObject({
			seq: 1,
			status: "running",
		});

		const persisted = await repo.listTaskRunTodosForRun(run.id);
		expect(persisted.map((todo) => todo.taskType)).toEqual(
			result.payload.todos.map((todo) => todo.taskType),
		);
	});

	it("replaces and advances persisted NightWorkers Todos", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: todo list ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: persisted TodoList",
			description: "Advance a standard implementation TodoList",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});

		const replaced = await todoListTool({
			runId: run.id,
			operation: "replace",
			todos: [{ seq: 1, title: "Inspect implementation" }],
		});

		expect(replaced.ok).toBe(true);
		expect(replaced.payload.todos[0]).toMatchObject({
			seq: 1,
			taskType: "initial_instructions",
			status: "running",
		});

		const completed = await todoListTool({
			runId: run.id,
			operation: "done",
			seq: 1,
		});

		expect(completed.ok).toBe(true);
		expect(completed.payload.todos[0]).toMatchObject({
			seq: 1,
			status: "passed",
		});
		expect(completed.payload.todos[1]).toMatchObject({
			seq: 2,
			taskType: "context_compile",
			status: "running",
		});

		const persisted = await repo.listTaskRunTodosForRun(run.id);
		expect(persisted[0]).toMatchObject({ seq: 1, status: "passed" });
		expect(persisted[0].completedAt).toBeTruthy();
		expect(persisted[1]).toMatchObject({ seq: 2, status: "running" });
		expect(persisted[1].startedAt).toBeTruthy();
	});

	it("preserves terminal Todos when replacing the full plan", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: todo replace preserves done ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: replace preserves completed TodoList rows",
			description: "A full TodoList refresh must not reopen completed work",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});

		await todoListTool({
			runId: run.id,
			operation: "replace",
			todos: [{ seq: 1, title: "Inspect implementation" }],
		});
		await todoListTool({ runId: run.id, operation: "done", seq: 1 });

		const beforeReplace = await repo.listTaskRunTodosForRun(run.id);
		const completedInitialInstructions = beforeReplace[0];
		expect(completedInitialInstructions).toMatchObject({
			seq: 1,
			taskType: "initial_instructions",
			status: "passed",
		});
		expect(beforeReplace[1]).toMatchObject({
			seq: 2,
			taskType: "context_compile",
			status: "running",
		});

		const replacedAgain = await todoListTool({
			runId: run.id,
			operation: "replace",
			todoListReplaceReason: "estimate_changed",
			todos: [
				{ seq: 1, title: "Reconsider existing implementation" },
				{ seq: 2, title: "Apply refined implementation" },
			],
		});

		expect(replacedAgain.ok).toBe(true);
		const persisted = await repo.listTaskRunTodosForRun(run.id);
		expect(persisted[0]).toMatchObject({
			id: completedInitialInstructions.id,
			seq: 1,
			title: "initial_instructions を実行する",
			taskType: "initial_instructions",
			status: "passed",
		});
		expect(persisted[0].completedAt?.getTime()).toBe(
			completedInitialInstructions.completedAt?.getTime(),
		);
		expect(persisted[1]).toMatchObject({
			seq: 2,
			taskType: "context_compile",
			status: "running",
		});
		expect(
			persisted.map((todo) => ({ seq: todo.seq, status: todo.status })),
		).toEqual([
			{ seq: 1, status: "passed" },
			{ seq: 2, status: "running" },
			{ seq: 3, status: "pending" },
			{ seq: 4, status: "pending" },
			{ seq: 5, status: "pending" },
			{ seq: 6, status: "pending" },
		]);
	});

	it("rejects todo_list operation=replace during a running Todo without a replanning reason", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: todo replace reason ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: replace requires reason",
			description:
				"A running Todo must not be completed by replacing the TodoList",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});

		await todoListTool({
			runId: run.id,
			operation: "replace",
			todos: [{ seq: 1, title: "Implement feature" }],
		});

		const result = await todoListTool({
			runId: run.id,
			operation: "replace",
			todos: [{ seq: 1, title: "Different implementation split" }],
		});

		expect(result.ok).toBe(false);
		expect(result.error).toMatchObject({
			code: "TODO_LIST_REPLACE_REASON_REQUIRED",
		});
		expect(result.error?.message).toContain("todo_list operation=replace");
		expect(result.error?.message).toContain("todo_list operation=done");
	});

	it("leaves the final completion report Todo pending without running it", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: todo final closeout ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: final closeout TodoList",
			description: "Auto-complete final closeout",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});

		await todoListTool({
			runId: run.id,
			operation: "replace",
			todos: [{ seq: 1, title: "Implement feature" }],
		});
		for (const seq of [1, 2, 3, 4]) {
			const result = await todoListTool({
				runId: run.id,
				operation: "done",
				seq,
			});
			expect(result.ok).toBe(true);
		}

		const persisted = await repo.listTaskRunTodosForRun(run.id);
		expect(persisted.at(-1)).toMatchObject({
			seq: 5,
			title: "完了報告を行う",
			taskType: "completion_report",
			procedureId: "final_completion_report",
			status: "pending",
		});
		expect(persisted.some((todo) => todo.status === "running")).toBe(false);
		expect(persisted.at(-1)?.startedAt).toBeFalsy();
		expect(persisted.at(-1)?.completedAt).toBeFalsy();
	});

	it("starts the final completion report Todo when explicitly requested", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: todo completion start ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: start completion report Todo",
			description: "Explicit final closeout start should persist",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});

		await todoListTool({
			runId: run.id,
			operation: "replace",
			todos: [{ seq: 1, title: "Implement feature" }],
		});
		for (const seq of [1, 2, 3, 4]) {
			const result = await todoListTool({
				runId: run.id,
				operation: "done",
				seq,
			});
			expect(result.ok).toBe(true);
		}

		const started = await todoListTool({
			runId: run.id,
			operation: "start",
			seq: 5,
		});

		expect(started.ok).toBe(true);
		expect(started.payload.currentTodo).toMatchObject({
			seq: 5,
			taskType: "completion_report",
			procedureId: "final_completion_report",
			status: "running",
		});
		const persisted = await repo.listTaskRunTodosForRun(run.id);
		expect(persisted[4]).toMatchObject({
			seq: 5,
			taskType: "completion_report",
			status: "running",
		});
		expect(persisted[4].startedAt).toBeTruthy();
	});

	it("returns attempted todo diagnostics when complete fails", async () => {
		const failed = await todoListTool({
			runId: "missing-run",
			operation: "done",
			seq: 1,
		});

		expect(failed.ok).toBe(false);
		expect(failed.error).toMatchObject({ code: "RUN_NOT_FOUND" });
		expect(failed.payload).toMatchObject({
			runId: "missing-run",
			taskId: "",
			action: "todo_list",
			operation: "done",
			diagnostics: {
				errorCode: "RUN_NOT_FOUND",
				attemptedAction: {
					action: "todo_list",
					operation: "done",
					seq: 1,
				},
			},
		});
	});

	it("does not start a later Todo while an earlier Todo is still open", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: todo order ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: ordered TodoList",
			description: "Do not skip open todos",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});

		await todoListTool({
			runId: run.id,
			operation: "replace",
			todos: [{ title: "Implement" }],
		});
		await todoListTool({ runId: run.id, operation: "done", seq: 1 });
		await todoListTool({ runId: run.id, operation: "done", seq: 2 });

		const result = await todoListTool({
			runId: run.id,
			operation: "start",
			seq: 5,
		});

		expect(result.ok).toBe(false);
		expect(result.error).toMatchObject({ code: "PREVIOUS_TODO_OPEN" });
		const persisted = await repo.listTaskRunTodosForRun(run.id);
		expect(persisted[2]).toMatchObject({ seq: 3, status: "running" });
		expect(persisted[4]).toMatchObject({ seq: 5, status: "pending" });
	});

	it("does not auto-start an earlier pending Todo after completing a later Todo", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: todo no rewind ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: no backward auto-start",
			description: "Complete a later todo",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});
		await repo.createTaskRunTodo({
			runId: run.id,
			seq: 1,
			title: "Already done",
			taskType: "implementation",
			status: "passed",
		});
		await repo.createTaskRunTodo({
			runId: run.id,
			seq: 2,
			title: "Earlier pending",
			taskType: "verification",
			status: "pending",
		});
		await repo.createTaskRunTodo({
			runId: run.id,
			seq: 3,
			title: "Later running",
			taskType: "knowledge_capture",
			status: "running",
		});

		const result = await todoListTool({
			runId: run.id,
			operation: "done",
			seq: 3,
		});

		expect(result.ok).toBe(true);
		const persisted = await repo.listTaskRunTodosForRun(run.id);
		expect(
			persisted.map((todo) => ({ seq: todo.seq, status: todo.status })),
		).toEqual([
			{ seq: 1, status: "passed" },
			{ seq: 2, status: "pending" },
			{ seq: 3, status: "passed" },
		]);
	});

	it("does not restart a terminal Todo", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: terminal todo ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: terminal TodoList",
			description: "Terminal todos stay closed",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});
		await repo.createTaskRunTodo({
			runId: run.id,
			seq: 1,
			title: "Failed verification",
			taskType: "verification",
			status: "failed",
		});

		const result = await todoListTool({
			runId: run.id,
			operation: "start",
			seq: 1,
		});

		expect(result.ok).toBe(false);
		expect(result.error).toMatchObject({ code: "TODO_NOT_STARTABLE" });
		const persisted = await repo.listTaskRunTodosForRun(run.id);
		expect(persisted[0]).toMatchObject({ seq: 1, status: "failed" });
	});

	it("treats done for an already passed Todo as idempotent success", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: todo idempotent done ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: idempotent done",
			description: "Repeated done should not fail",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});

		await todoListTool({
			runId: run.id,
			operation: "replace",
			todos: [{ title: "Implement" }],
		});
		const firstDone = await todoListTool({
			runId: run.id,
			operation: "done",
			seq: 1,
		});
		const secondDone = await todoListTool({
			runId: run.id,
			operation: "done",
			seq: 1,
		});

		expect(firstDone.ok).toBe(true);
		expect(secondDone.ok).toBe(true);
		expect(secondDone.payload.transition).toMatchObject({
			completedSeq: 1,
			nextCurrentSeq: 2,
		});
		const persisted = await repo.listTaskRunTodosForRun(run.id);
		expect(persisted[0]).toMatchObject({ seq: 1, status: "passed" });
		expect(persisted[1]).toMatchObject({ seq: 2, status: "running" });
	});

	it("does not let stale auto-advance reopen a passed Todo", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: stale auto advance ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: stale auto advance",
			description: "Completed todos stay terminal",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});
		const todo7 = await repo.createTaskRunTodo({
			runId: run.id,
			seq: 7,
			title: "品質ゲート verify コマンドを通す",
			taskType: "verification",
			procedureId: "quality_gate_verify",
			status: "passed",
			startedAt: new Date("2026-06-13T11:37:14.000Z"),
			completedAt: new Date("2026-06-13T11:37:53.000Z"),
		});
		await repo.createTaskRunTodo({
			runId: run.id,
			seq: 8,
			title: "完了報告を行う",
			taskType: "completion_report",
			procedureId: "final_completion_report",
			status: "running",
			startedAt: new Date("2026-06-13T11:37:53.000Z"),
		});

		const staleStart =
			await repo.startTaskRunTodoIfStillPendingAndNoEarlierOpen({
				id: todo7.id,
				runId: run.id,
				afterSeq: 6,
				startedAt: new Date("2026-06-13T11:40:29.000Z"),
			});

		expect(staleStart).toBeNull();
		const persisted = await repo.listTaskRunTodosForRun(run.id);
		expect(
			persisted.map((todo) => ({ seq: todo.seq, status: todo.status })),
		).toEqual([
			{ seq: 7, status: "passed" },
			{ seq: 8, status: "running" },
		]);
		expect(persisted[0].completedAt).toBeTruthy();
	});

	it("does not auto-start a later pending Todo when an earlier Todo is still open", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: guarded auto advance ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: guarded auto advance",
			description: "Earlier open todos block later auto-start",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});
		await repo.createTaskRunTodo({
			runId: run.id,
			seq: 7,
			title: "Earlier pending",
			taskType: "inspection",
			status: "pending",
		});
		await repo.createTaskRunTodo({
			runId: run.id,
			seq: 8,
			title: "Current verification",
			taskType: "verification",
			status: "running",
		});
		await repo.createTaskRunTodo({
			runId: run.id,
			seq: 9,
			title: "Later implementation",
			taskType: "implementation",
			status: "pending",
		});

		const result = await todoListTool({
			runId: run.id,
			operation: "done",
			seq: 8,
		});

		expect(result.ok).toBe(true);
		const persisted = await repo.listTaskRunTodosForRun(run.id);
		expect(
			persisted.map((todo) => ({ seq: todo.seq, status: todo.status })),
		).toEqual([
			{ seq: 7, status: "pending" },
			{ seq: 8, status: "passed" },
			{ seq: 9, status: "pending" },
		]);
	});
});

describe("task_events sequencing", () => {
	it("allocates unique run-local seq values for concurrent event creation", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: event seq ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: event seq",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});

		const events = await Promise.all(
			Array.from({ length: 12 }, (_, index) =>
				repo.createTaskEvent({
					taskRunId: run.id,
					type: "info",
					eventType: "test_event",
					actor: "system",
					message: `event ${index}`,
					timestamp: new Date(),
				}),
			),
		);

		const seqs = events.map((event) => event.seq).sort((a, b) => a - b);
		expect(seqs).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
		expect(new Set(seqs).size).toBe(12);
	});
});
