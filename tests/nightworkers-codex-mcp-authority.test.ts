import { describe, expect, it } from "vitest";
import {
	requestContextMismatchToMcp,
	resolveRequestScopedIdentity,
} from "../api/mcp/nightworkers-codex-mcp-support";

describe("NightWorkers Codex MCP request authority", () => {
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
});
