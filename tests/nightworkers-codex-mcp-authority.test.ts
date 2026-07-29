import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	handleNightWorkersCodexMcpRequest,
	requestContextMismatchToMcp,
	resolveRequestScopedIdentity,
} from "../api/mcp/nightworkers-codex-mcp-support";
import { CODING_AGENT_SYSTEM_CONTEXT_VERSION } from "../api/modules/codingAgent/context";
import {
	createRepository,
	createTask,
	createTaskRun,
	deleteRepository,
	listTaskRunTodosForRun,
} from "../api/modules/nightworkers/nightworkers.repository";

describe("NightWorkers Codex MCP request authority", () => {
	it("advertises the minimal request-scoped Todo guidance during MCP initialization", async () => {
		const response = await handleNightWorkersCodexMcpRequest(
			new Request("http://127.0.0.1/mcp/nightworkers", {
				method: "POST",
				headers: {
					accept: "application/json, text/event-stream",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: "2025-06-18",
						capabilities: {},
						clientInfo: { name: "todo-contract-test", version: "1.0.0" },
					},
				}),
			}),
		);

		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain("titleとsystemContextだけのplan");
		expect(body).toContain("complete_current");
		expect(body).toContain("hostはTodoを暗黙生成・更新しません");
	});

	it("keeps request-scoped identity authoritative and reports supplied differences", () => {
		const resolution = resolveRequestScopedIdentity({
			context: { taskId: "task-authoritative", runId: "run-authoritative" },
			suppliedTaskId: "task-wrong",
			suppliedRunId: "run-wrong",
			fallbackTaskId: "task-env",
			fallbackRunId: "run-env",
		});

		expect(resolution).toEqual({
			taskId: "task-authoritative",
			runId: "run-authoritative",
			discrepancies: [
				{
					field: "taskId",
					supplied: "task-wrong",
					authoritative: "task-authoritative",
				},
				{
					field: "runId",
					supplied: "run-wrong",
					authoritative: "run-authoritative",
				},
			],
		});
	});

	it("uses supplied identity when no request or environment scope exists", () => {
		expect(
			resolveRequestScopedIdentity({
				context: {},
				suppliedTaskId: "task-supplied",
				suppliedRunId: "run-supplied",
			}),
		).toEqual({
			taskId: "task-supplied",
			runId: "run-supplied",
			discrepancies: [],
		});
	});

	it("returns canonical retry guidance without executing the tool intent", async () => {
		const resolution = resolveRequestScopedIdentity({
			context: { runId: "run-authoritative" },
			suppliedRunId: "run-wrong",
		});
		const result = await requestContextMismatchToMcp({
			toolName: "todo_list",
			resolution,
			retryArguments: {
				runId: resolution.runId,
				command: { op: "list" },
			},
		});

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			error: { code: "REQUEST_CONTEXT_MISMATCH" },
			payload: {
				intentStatus: "not_executed",
				guidance: {
					authoritativeContext: { runId: "run-authoritative" },
					intentKey: expect.stringMatching(/^scoped-retry:sha256:/),
					discrepancies: [
						{
							field: "runId",
							supplied: "run-wrong",
							authoritative: "run-authoritative",
						},
					],
					retryArguments: {
						runId: "run-authoritative",
						command: { op: "list" },
					},
				},
			},
		});
	});

	it("persists Todo SystemContext through the request-scoped MCP transport", async () => {
		const repository = await createRepository({
			name: `TEST: Codex MCP Todo ${crypto.randomUUID()}`,
			localPath: "/tmp/codex-mcp-todo",
			branch: "main",
			allowed: true,
		});
		try {
			const task = await createTask({
				repositoryId: repository.id,
				title: "MCP Todo contract",
				status: "running",
			});
			const run = await createTaskRun({
				taskId: task.id,
				repositoryId: repository.id,
				status: "running",
				workerKind: "codex-sdk",
			});
			const response = await handleNightWorkersCodexMcpRequest(
				new Request(
					`http://127.0.0.1/mcp/nightworkers?taskId=${task.id}&runId=${run.id}`,
					{
						method: "POST",
						headers: {
							accept: "application/json, text/event-stream",
							"content-type": "application/json",
						},
						body: JSON.stringify({
							jsonrpc: "2.0",
							id: 1,
							method: "tools/call",
							params: {
								name: "todo_list",
								arguments: {
									command: {
										op: "plan",
										steps: [
											{
												title: "migrationを実装する",
												systemContext:
													"既存DBからの更新経路と新規DBの両方を検証する。",
											},
										],
									},
								},
							},
						}),
					},
				),
			);

			expect(response.status).toBe(200);
			expect(await response.text()).not.toContain('"isError":true');
			expect(await listTaskRunTodosForRun(run.id)).toMatchObject([
				{
					taskType: "coding",
					status: "running",
					context: "既存DBからの更新経路と新規DBの両方を検証する。",
					nextAction: "既存DBからの更新経路と新規DBの両方を検証する。",
					systemContextVersion: CODING_AGENT_SYSTEM_CONTEXT_VERSION,
					systemContextSnapshot: { todoPolicy: "adaptive" },
				},
			]);
		} finally {
			await deleteRepository(repository.id);
		}
	});
});
