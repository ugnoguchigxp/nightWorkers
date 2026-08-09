import { describe, expect, it } from "vitest";
import {
	createCodexEventMapperState,
	mapCodexThreadEvent,
	redactProviderEvent,
} from "../api/modules/codingAgent/runtime/codex-sdk/codex-sdk-event-adapter";

const itemEvent = (type: string, item: unknown) => ({ type, item }) as never;

describe("Codex SDK event adapter coverage", () => {
	it("maps runtime and turn lifecycle events", () => {
		expect(
			mapCodexThreadEvent({ type: "thread.started", thread_id: "thread-1" }),
		).toMatchObject([{ type: "runtime_started" }]);
		expect(mapCodexThreadEvent({ type: "turn.started" })).toMatchObject([
			{ type: "turn_started" },
		]);
		expect(
			mapCodexThreadEvent({
				type: "turn.completed",
				usage: {
					input_tokens: 1,
					cached_input_tokens: 2,
					output_tokens: 3,
					reasoning_output_tokens: 4,
				},
			}),
		).toMatchObject([
			{
				type: "turn_finished",
				payload: {
					usage: {
						inputTokens: 1,
						cachedInputTokens: 2,
						outputTokens: 3,
						reasoningOutputTokens: 4,
					},
				},
			},
		]);
		expect(
			mapCodexThreadEvent({
				type: "turn.failed",
				error: { message: "failed", apiToken: "secret" },
			}),
		).toMatchObject([
			{ type: "runtime_error", message: expect.stringContaining("failed") },
		]);
		expect(
			mapCodexThreadEvent({ type: "error", message: "stream failed" }),
		).toMatchObject([{ type: "runtime_error" }]);
	});

	it("tracks assistant deltas and completion", () => {
		const state = createCodexEventMapperState();
		expect(
			mapCodexThreadEvent(
				itemEvent("item.started", {
					type: "agent_message",
					id: "a",
					text: "Hello",
				}),
				state,
			),
		).toMatchObject([{ type: "model_response_delta", message: "Hello" }]);
		expect(
			mapCodexThreadEvent(
				itemEvent("item.updated", {
					type: "agent_message",
					id: "a",
					text: "Hello world",
				}),
				state,
			),
		).toMatchObject([{ payload: { delta: " world" } }]);
		expect(
			mapCodexThreadEvent(
				itemEvent("item.updated", {
					type: "agent_message",
					id: "a",
					text: "replacement",
				}),
				state,
			),
		).toEqual([]);
		expect(
			mapCodexThreadEvent(
				itemEvent("item.completed", {
					type: "agent_message",
					id: "a",
					text: "done",
				}),
				state,
			),
		).toMatchObject([
			{ type: "model_response_finished", payload: { text: "done" } },
		]);
	});

	it("maps command lifecycle and compacts large output", () => {
		for (const [eventType, expected] of [
			["item.started", "tool_call_started"],
			["item.updated", "tool_call_progress"],
			["item.completed", "tool_call_finished"],
		] as const) {
			const [mapped] = mapCodexThreadEvent(
				itemEvent(eventType, {
					type: "command_execution",
					id: `command-${eventType}`,
					command: "npm test",
					aggregated_output:
						eventType === "item.updated" ? "x".repeat(30_000) : undefined,
					exit_code: eventType === "item.completed" ? 0 : null,
					status: "completed",
					password: "hidden",
				}),
			);
			expect(mapped).toMatchObject({
				type: expected,
				payload: { toolName: "command_execution" },
			});
		}
	});

	it("maps MCP calls and redacts arguments and results", () => {
		const [mapped] = mapCodexThreadEvent(
			itemEvent("item.completed", {
				type: "mcp_tool_call",
				id: "mcp-1",
				server: "nightworkers",
				tool: "run_check",
				arguments: { apiKey: "secret", nested: [{ token: "secret" }] },
				result: { content: "x".repeat(300_000), cookie: "secret" },
				status: "failed",
				error: { message: "bad" },
			}),
		);
		expect(mapped).toMatchObject({
			type: "tool_call_finished",
			payload: {
				arguments: { apiKey: "[REDACTED]", nested: [{ token: "[REDACTED]" }] },
				resultCompacted: true,
				error: "bad",
			},
		});
	});

	it("normalizes file changes inside and outside the repository", () => {
		const state = createCodexEventMapperState({ repoRoot: "/repo" });
		const [mapped] = mapCodexThreadEvent(
			itemEvent("item.completed", {
				type: "file_change",
				id: "files",
				status: "completed",
				changes: [
					"/repo/src/a.ts",
					{ path: "/repo/src/b.ts" },
					{ filePath: "/outside/c.ts" },
					{ relativePath: "src/d.ts" },
					{ other: true },
					null,
				],
			}),
			state,
		);
		expect(mapped).toMatchObject({
			type: "diff_collected",
			payload: {
				changedFiles: ["src/a.ts", "src/b.ts", "/outside/c.ts", "src/d.ts"],
			},
		});
	});

	it("maps todo, item error, and unknown item activity", () => {
		expect(
			mapCodexThreadEvent(
				itemEvent("item.updated", { type: "todo_list", id: "todo", items: [] }),
			),
		).toMatchObject([
			{
				type: "tool_call_progress",
				payload: { providerItemType: "todo_list" },
			},
		]);
		expect(
			mapCodexThreadEvent(
				itemEvent("item.completed", {
					type: "error",
					id: "error",
					message: "warning",
				}),
			),
		).toMatchObject([{ type: "runtime_warning" }]);
		expect(
			mapCodexThreadEvent(
				itemEvent("item.started", { type: "reasoning", id: "reasoning" }),
			),
		).toMatchObject([
			{
				type: "tool_call_progress",
				message: expect.stringContaining("reasoning"),
			},
		]);
	});

	it("redacts secret-shaped keys recursively while preserving primitives", () => {
		expect(redactProviderEvent(null)).toBeNull();
		expect(redactProviderEvent("plain")).toBe("plain");
		expect(
			redactProviderEvent({
				authorization: "a",
				api_key: "b",
				password: "c",
				safe: [{ cookie: "d", value: 1 }],
			}),
		).toEqual({
			authorization: "[REDACTED]",
			api_key: "[REDACTED]",
			password: "[REDACTED]",
			safe: [{ cookie: "[REDACTED]", value: 1 }],
		});
	});
});
