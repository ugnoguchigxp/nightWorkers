import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildNormalTranscriptItems } from "../src/modules/nightworkers/components/ThreadTimeline";
import {
	CodexToolCard,
	getCodexToolCardModel,
	hasCodexToolCard,
	NormalCodexToolCard,
} from "../src/modules/nightworkers/components/ThreadTimelineCodexToolCard";

describe("ThreadTimeline Codex tool cards", () => {
	it("extracts Codex MCP started details", () => {
		const card = getCodexToolCardModel({
			kind: "tool.call",
			status: "started",
			payloadJson: {
				payload: {
					provider: "codex",
					providerEventType: "item.started",
					providerItemId: "mcp-todo-1",
					mcpServer: "nightworkers",
					mcpTool: "todo_list",
					toolName: "nightworkers.todo_list",
					arguments: {
						runId: "run-1",
						operation: "replace",
						todos: [{ seq: 1, title: "実装" }],
					},
					status: "in_progress",
				},
			},
		});

		expect(card).toMatchObject({
			lifecycle: "started",
			status: "started",
			providerItemId: "mcp-todo-1",
			toolName: "nightworkers.todo_list",
			codexKind: "mcp",
			title: "Codex MCP",
			summary: "nightworkers.todo_list | operation=replace",
		});
		expect(card?.metadata).toContainEqual({
			label: "server",
			value: "nightworkers",
		});
		expect(card?.metadata).toContainEqual({
			label: "tool",
			value: "todo_list",
		});
		expect(card?.argumentsPreview).toContain('"operation": "replace"');
	});

	it("extracts Codex MCP failed result details from runEvent data", () => {
		const card = getCodexToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				runEvent: {
					type: "tool.call_finished",
					data: {
						provider: "codex",
						providerEventType: "item.completed",
						providerItemId: "mcp-todo-2",
						mcpServer: "nightworkers",
						mcpTool: "todo_list",
						toolName: "nightworkers.todo_list",
						arguments: {
							runId: "run-1",
							operation: "done",
							seq: 1,
						},
						result: {
							content: [
								{
									type: "text",
									text: '{"error":{"code":"CURRENT_TODO_NOT_UNIQUE"}}',
								},
							],
						},
						error: "CURRENT_TODO_NOT_UNIQUE",
						status: "failed",
					},
				},
			},
		});

		expect(card).toMatchObject({
			lifecycle: "result",
			status: "failed",
			providerItemId: "mcp-todo-2",
			summary: "nightworkers.todo_list | operation=done | seq=1",
			errorMessage: "CURRENT_TODO_NOT_UNIQUE",
		});
		expect(card?.resultPreview).toContain("CURRENT_TODO_NOT_UNIQUE");
	});

	it("strips terminal control sequences from Codex command output previews", () => {
		const card = getCodexToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				payload: {
					provider: "codex",
					providerEventType: "item.completed",
					providerItemId: "cmd-build",
					toolName: "command_execution",
					command: "bun run build",
					commandClass: "verification",
					aggregatedOutput:
						"\u001b[2K\rtransforming...\u001b[32m✓\u001b[39m 1899 modules transformed.\u0007\nrendering chunks...",
					exitCode: 0,
					status: "completed",
				},
			},
		});

		expect(card?.summary).toBe("command_execution | bun run build");
		expect(card?.detailsFilename).toBe("command result");
		expect(card?.outputPreview).toContain("transforming...");
		expect(card?.outputPreview).toContain("✓ 1899 modules transformed.");
		expect(card?.outputPreview).not.toContain(String.fromCharCode(27));
		expect(card?.outputPreview).not.toContain(String.fromCharCode(7));
		expect(card?.outputPreview).not.toContain("\r");
		expect(card?.outputPreview).not.toContain("[2K");
		expect(card?.outputPreview).not.toContain("[32m");
		expect(card?.outputPreview).not.toContain("[39m");
	});

	it("renders compact Codex command result blocks 104px shorter than before", () => {
		const markup = renderToStaticMarkup(
			createElement(NormalCodexToolCard, {
				event: {
					kind: "tool.result",
					status: "completed",
					payloadJson: {
						payload: {
							provider: "codex",
							providerEventType: "item.completed",
							providerItemId: "cmd-test",
							toolName: "command_execution",
							command: "bun run test",
							commandClass: "verification",
							aggregatedOutput: ["line 1", "line 2", "line 3", "line 4"].join(
								"\n",
							),
							exitCode: 0,
							status: "completed",
						},
					},
				},
			}),
		);

		expect(markup).toContain("command result");
		expect(markup).toContain("max-height:116px");
	});

	it("renders expanded Codex MCP result blocks 104px shorter than before", () => {
		const markup = renderToStaticMarkup(
			createElement(CodexToolCard, {
				event: {
					kind: "tool.result",
					status: "completed",
					payloadJson: {
						payload: {
							provider: "codex",
							providerEventType: "item.completed",
							providerItemId: "item_118",
							mcpServer: "nightworkers",
							mcpTool: "todo_list",
							toolName: "nightworkers.todo_list",
							arguments: { operation: "done", runId: "run-1", seq: 4 },
							result: { ok: true },
							status: "completed",
						},
					},
				},
			}),
		);

		expect(markup).toContain("nightworkers.todo_list.txt");
		expect(markup).toContain("max-height:216px");
	});

	it("renders sed in-place commands as Codex edit diff previews", () => {
		const card = getCodexToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				payload: {
					provider: "codex",
					providerEventType: "item.completed",
					providerItemId: "cmd-sed-edit",
					toolName: "command_execution",
					command: "sed -i '' 's/oldTitle/newTitle/g' src/App.tsx",
					commandClass: "inspection",
					aggregatedOutput: "",
					exitCode: 0,
					status: "completed",
				},
			},
		});

		expect(card).toMatchObject({
			codexKind: "edit_command",
			title: "Codex edit",
			summary: "sed edit | src/App.tsx | oldTitle -> newTitle",
			editDiffPreview: {
				label: "sed edit preview",
			},
		});
		expect(card?.metadata).toContainEqual({
			label: "file",
			value: "src/App.tsx",
		});
		expect(card?.editDiffPreview?.diff).toContain("--- src/App.tsx");
		expect(card?.editDiffPreview?.diff).toContain("- oldTitle");
		expect(card?.editDiffPreview?.diff).toContain("+ newTitle");
	});

	it("does not build Codex cards for changed-file-only diff detection logs", () => {
		expect(
			hasCodexToolCard({
				kind: "file.diff",
				status: "completed",
				payloadJson: {
					payload: {
						provider: "codex",
						providerEventType: "item.completed",
						providerItemId: "file-change-1",
						changedFiles: ["src/fizzbuzz.ts"],
						status: "completed",
					},
				},
			}),
		).toBe(false);
	});

	it("keeps Codex MCP tool cards visible in normal transcript mode", () => {
		const items = buildNormalTranscriptItems([
			{
				kind: "user_turn",
				id: "user:1",
				turnId: "user-1",
				events: [],
				text: "実装してください",
			},
			{
				kind: "activity",
				id: "activity:codex-mcp",
				event: {
					id: "codex-mcp",
					taskId: "task-1",
					runId: "run-1",
					kind: "tool.result",
					source: "worker",
					status: "completed",
					seq: 2,
					payloadJson: {
						payload: {
							provider: "codex",
							providerItemId: "mcp-todo-visible",
							mcpServer: "nightworkers",
							mcpTool: "todo_list",
							toolName: "nightworkers.todo_list",
							arguments: { operation: "done", seq: 1 },
							result: { ok: true },
							status: "completed",
						},
					},
					createdAt: "2026-06-18T00:00:00.000Z",
					visibility: "visible",
				} as never,
			},
		]);

		expect(items.map((item) => item.id)).toContain("activity:codex-mcp");
	});

	it("dedupes repeated Codex command updates by provider item and lifecycle", () => {
		const items = buildNormalTranscriptItems([
			{
				kind: "activity",
				id: "activity:cmd-start-1",
				event: codexCommandEvent(
					"cmd-start-1",
					"tool.call",
					"item.started",
					"started",
				),
			},
			{
				kind: "activity",
				id: "activity:cmd-start-duplicate",
				event: codexCommandEvent(
					"cmd-start-duplicate",
					"tool.call",
					"item.started",
					"started",
				),
			},
			{
				kind: "activity",
				id: "activity:cmd-result",
				event: codexCommandEvent(
					"cmd-result",
					"tool.result",
					"item.completed",
					"completed",
				),
			},
		]);

		expect(items.map((item) => item.id)).toEqual([
			"activity:cmd-start-1",
			"activity:cmd-result",
		]);
	});

	it("supports TaskEvent fallback payloads before activity projection flushes", () => {
		expect(
			hasCodexToolCard({
				eventType: "tool.call_finished",
				type: "info",
				message: "[Codex] MCP tool finished: nightworkers.todo_list",
				payloadJson: {
					payload: {
						provider: "codex",
						providerItemId: "fallback-mcp",
						mcpServer: "nightworkers",
						mcpTool: "todo_list",
						toolName: "nightworkers.todo_list",
						arguments: { operation: "list" },
						result: { ok: true },
						status: "completed",
					},
				},
			} as never),
		).toBe(true);
	});

	it("does not take over dedicated import project cards", () => {
		expect(
			getCodexToolCardModel({
				kind: "tool.result",
				payloadJson: {
					payload: {
						provider: "codex",
						providerItemId: "import-1",
						mcpServer: "nightworkers",
						mcpTool: "import_project",
						toolName: "nightworkers.import_project",
						result: { ok: true },
						status: "completed",
					},
				},
			}),
		).toBeNull();
	});
});

function codexCommandEvent(
	id: string,
	kind: "tool.call" | "tool.result",
	providerEventType: "item.started" | "item.completed",
	status: "started" | "completed",
) {
	return {
		id,
		taskId: "task-1",
		runId: "run-1",
		kind,
		source: "worker",
		status,
		seq: 1,
		payloadJson: {
			payload: {
				provider: "codex",
				providerEventType,
				providerItemId: "cmd-provider-1",
				toolName: "command_execution",
				command: "pnpm test",
				commandClass: "verification",
				aggregatedOutput: status === "completed" ? "ok" : "",
				exitCode: status === "completed" ? 0 : null,
				status,
			},
		},
		createdAt: "2026-06-18T00:00:00.000Z",
		visibility: "visible",
	} as never;
}
