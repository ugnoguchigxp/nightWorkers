import { describe, expect, it } from "vitest";
import { CodexAgentRuntime } from "../../api/services/agent-runtime/CodexAgentRuntime";
import { buildContext, fakeThread } from "./helpers";
import "./setup";

describe("CodexAgentRuntime read and verification contract warnings", () => {
	it("does not count block or fail as valid progress for later broad verification", async () => {
		for (const operation of ["block", "fail"] as const) {
			const runtime = new CodexAgentRuntime({
				threadFactory: () =>
					fakeThread([
						{
							type: "item.completed",
							item: {
								id: `todo-${operation}`,
								type: "mcp_tool_call",
								server: "nightworkers",
								tool: "todo_list",
								arguments: { operation, seq: 1 },
								status: "completed",
								result: { ok: true },
							},
						},
						{
							type: "item.completed",
							item: {
								id: `file-after-${operation}`,
								type: "file_change",
								status: "completed",
								changes: [{ path: "src/app.ts" }],
							},
						},
						{
							type: "item.completed",
							item: {
								id: `cmd-verify-${operation}`,
								type: "command_execution",
								command: "bun run verify",
								aggregated_output: "ok",
								exit_code: 0,
								status: "completed",
							},
						},
						{
							type: "item.completed",
							item: {
								id: `msg-${operation}`,
								type: "agent_message",
								text: "done",
							},
						},
					] as never),
			});

			const result = await runtime.start(buildContext(), {
				emit: async () => {},
			});

			expect(result.contractWarnings).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						code: "codex_todo_progress_missing",
						providerItemId: `file-after-${operation}`,
						changedFiles: ["src/app.ts"],
					}),
					expect.objectContaining({
						code: "codex_todo_progress_stale_before_verify",
						providerItemId: `cmd-verify-${operation}`,
					}),
				]),
			);
		}
	});

	it("uses prior wrapped inspection command evidence for read-before-edit audit", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "todo-start",
							type: "mcp_tool_call",
							server: "nightworkers",
							tool: "todo_list",
							arguments: { operation: "start", seq: 1 },
							status: "completed",
							result: { ok: true },
						},
					},
					{
						type: "item.completed",
						item: {
							id: "cmd-read",
							type: "command_execution",
							command: "/bin/zsh -lc 'sed -n \"1,80p\" src/app.ts'",
							aggregated_output: "const app = true;",
							exit_code: 0,
							status: "completed",
						},
					},
					{
						type: "item.completed",
						item: {
							id: "file-after-read",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});

		const result = await runtime.start(buildContext(), {
			emit: async () => {},
		});

		expect(result.contractWarnings ?? []).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "codex_file_change_without_prior_read",
				}),
			]),
		);
	});

	it("uses parent directory context reads for newly created files", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "cmd-read-parent-context",
							type: "command_execution",
							command: "sed -n '1,120p' web/src/router.tsx",
							aggregated_output:
								"export const router = createRouter({ routeTree });",
							exit_code: 0,
							status: "completed",
						},
					},
					{
						type: "item.completed",
						item: {
							id: "file-new-after-parent-read",
							type: "file_change",
							status: "completed",
							changes: [
								{ path: "web/src/routes/todo-list-route.tsx", type: "add" },
							],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});

		const result = await runtime.start(buildContext(), {
			emit: async () => {},
		});

		expect(result.contractWarnings ?? []).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "codex_file_change_without_prior_read",
				}),
			]),
		);
	});

	it("does not use failed inspection commands as read-before-edit evidence", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "cmd-read-failed",
							type: "command_execution",
							command: "sed -n '1,80p' src/app.ts",
							aggregated_output: "No such file",
							exit_code: 1,
							status: "completed",
						},
					},
					{
						type: "item.completed",
						item: {
							id: "file-after-failed-read",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});

		const result = await runtime.start(buildContext(), {
			emit: async () => {},
		});

		expect(result.contractWarnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "codex_file_change_without_prior_read",
					providerItemId: "file-after-failed-read",
					changedFiles: ["src/app.ts"],
				}),
			]),
		);
	});

	it("does not use git diff of a newly created file as parent read evidence", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "cmd-diff-new",
							type: "command_execution",
							command: "git diff -- src/new-file.ts",
							aggregated_output:
								"diff --git a/src/new-file.ts b/src/new-file.ts",
							exit_code: 0,
							status: "completed",
						},
					},
					{
						type: "item.completed",
						item: {
							id: "file-new-after-diff",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/new-file.ts", type: "add" }],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});

		const result = await runtime.start(buildContext(), {
			emit: async () => {},
		});

		expect(result.contractWarnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "codex_file_change_without_prior_read",
					providerItemId: "file-new-after-diff",
					changedFiles: ["src/new-file.ts"],
				}),
			]),
		);
	});

	it("warns when broad verification starts after file changes without fresh Todo progress", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "todo-start",
							type: "mcp_tool_call",
							server: "nightworkers",
							tool: "todo_list",
							arguments: { operation: "start", seq: 1 },
							status: "completed",
							result: { ok: true },
						},
					},
					{
						type: "item.completed",
						item: {
							id: "file-before-verify",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: {
							id: "cmd-verify",
							type: "command_execution",
							command: "bun run verify",
							aggregated_output: "ok",
							exit_code: 0,
							status: "completed",
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});

		const result = await runtime.start(buildContext(), {
			emit: async () => {},
		});

		expect(result.contractWarnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "codex_todo_progress_stale_before_verify",
					providerItemId: "cmd-verify",
					command: "bun run verify",
					changedFiles: ["src/app.ts"],
				}),
			]),
		);
	});

	it("does not warn about stale Todo progress when a Todo mutation follows focused verification", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "todo-start",
							type: "mcp_tool_call",
							server: "nightworkers",
							tool: "todo_list",
							arguments: { operation: "start", seq: 1 },
							status: "completed",
							result: { ok: true },
						},
					},
					{
						type: "item.completed",
						item: {
							id: "file-before-focused",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: {
							id: "cmd-focused",
							type: "command_execution",
							command: "bunx vitest run tests/app.test.ts",
							aggregated_output: "ok",
							exit_code: 0,
							status: "completed",
						},
					},
					{
						type: "item.completed",
						item: {
							id: "todo-done",
							type: "mcp_tool_call",
							server: "nightworkers",
							tool: "todo_list",
							arguments: { operation: "done", seq: 1 },
							status: "completed",
							result: {
								ok: true,
								currentTodo: {
									id: "todo-verify",
									seq: 2,
									title: "verify",
									taskType: "quality_gate",
									status: "running",
								},
								transition: { previousCurrentSeq: 1, nextCurrentSeq: 2 },
							},
						},
					},
					{
						type: "item.completed",
						item: {
							id: "cmd-verify",
							type: "command_execution",
							command: "bun run verify",
							aggregated_output: "ok",
							exit_code: 0,
							status: "completed",
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});

		const result = await runtime.start(buildContext(), {
			emit: async () => {},
		});

		expect(result.contractWarnings ?? []).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "codex_todo_progress_stale_before_verify",
				}),
			]),
		);
	});
});
