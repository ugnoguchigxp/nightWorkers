import { describe, expect, it } from "vitest";
import {
	buildInitialNativeApiHistory,
	extractLatestNativeApiUserPrompt,
	extractNativeApiSystemContextAudit,
	extractNativeApiSystemPrompt,
	getLatestNativeApiUserContentByHeader,
	type NativeApiHistoryItem,
	projectNativeApiHistoryToProviderMessages,
	readOntologyMcpEnabled,
	readProjectExplorationCatalogPin,
	sanitizeNativeApiResumeHistory,
} from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-history";
import type { AgentRunContext } from "../api/modules/codingAgent/runtime/types";

function context(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
	return {
		runId: "run-1",
		taskId: "task-1",
		repositoryId: "repo-1",
		repoRoot: "/repo",
		compiledPrompt: "compiled fallback",
		latestUserMessage: "latest request",
		timeoutSeconds: 30,
		contextSnapshot: {
			compiledPrompt: "compiled fallback",
			source: "task_prompt",
		},
		...overrides,
	};
}

const toolCall = {
	id: "call-1",
	name: "read_file",
	arguments: { path: "a.ts" },
};
const toolResult = { ok: true, content: "contents", payload: { size: 8 } };

describe("native API history coverage", () => {
	it("builds initial history with resume, images, and current Todo context", () => {
		const resume: NativeApiHistoryItem[] = [
			{ type: "assistant", content: "earlier answer" },
		];
		const history = buildInitialNativeApiHistory(
			context({
				latestUserMessage: "",
				imageAttachments: [
					{
						id: "image-1",
						name: "image.png",
						path: "/tmp/image.png",
						size: 10,
						mediaType: "image/png",
					},
				],
				currentTodo: {
					id: "todo-1",
					seq: 1,
					title: "Implement",
					taskType: "implementation",
					status: "in_progress",
				},
			}),
			{ resumeHistory: resume },
		);
		expect(history.map((item) => item.type)).toEqual([
			"system",
			"assistant",
			"user",
			"user",
		]);
		expect(history[2]).toMatchObject({
			type: "user",
			content: "compiled fallback",
			imageAttachments: [{ mediaType: "image/png" }],
		});
		expect(extractNativeApiSystemContextAudit(history).length).toBeGreaterThan(
			1,
		);
	});

	it("finds user content, prompts, and system prompt fragments", () => {
		const history: NativeApiHistoryItem[] = [
			{ type: "system", content: "system one" },
			{ type: "system", content: "   " },
			{ type: "system", content: "system two" },
			{ type: "user", source: "runtime", content: "[state]\nold" },
			{ type: "assistant", content: "answer" },
			{ type: "user", source: "user", content: "[state]\nnew" },
		];
		expect(getLatestNativeApiUserContentByHeader(history, "[state]")).toBe(
			"[state]\nnew",
		);
		expect(
			getLatestNativeApiUserContentByHeader(history, "[missing]"),
		).toBeNull();
		expect(extractLatestNativeApiUserPrompt(history)).toBe("[state]\nnew");
		expect(extractLatestNativeApiUserPrompt([])).toBe("");
		expect(extractNativeApiSystemPrompt(history)).toBe(
			"system one\n\nsystem two",
		);
		expect(extractNativeApiSystemPrompt([])).toBe("");
	});

	it("projects every history item shape to provider messages", () => {
		const history: NativeApiHistoryItem[] = [
			{ type: "system", content: "system" },
			{ type: "user", source: "user", content: "plain" },
			{
				type: "user",
				source: "user",
				content: "with image",
				imageAttachments: [
					{
						id: "image-1",
						name: "image.webp",
						path: "/tmp/image.webp",
						size: 5,
						mediaType: "image/webp",
					},
				],
			},
			{ type: "assistant", content: "no call" },
			{ type: "assistant", content: "calling", toolCalls: [toolCall] },
			{
				type: "tool_result",
				toolCallId: "call-1",
				toolName: "read_file",
				result: toolResult,
			},
		];
		const messages = projectNativeApiHistoryToProviderMessages(history);
		expect(messages).toHaveLength(6);
		expect(messages[0]).toEqual({ role: "system", content: "system" });
		expect(messages[1]).toEqual({ role: "user", content: "plain" });
		expect(messages[2]).toMatchObject({
			role: "user",
			content: [{ type: "text" }, { type: "image" }],
		});
		expect(messages[4]).toMatchObject({
			role: "assistant",
			toolCalls: [toolCall],
		});
		expect(messages[5]).toEqual({
			role: "tool",
			toolCallId: "call-1",
			content: "contents",
		});
		expect(
			projectNativeApiHistoryToProviderMessages(history.slice(1))[0],
		).toEqual({
			role: "user",
			content: "plain",
		});
	});

	it("sanitizes valid conversations and strips host-owned entries", () => {
		const input = [
			{ type: "system", content: "discard" },
			{ type: "user", source: "runtime", content: "discard" },
			{ type: "user", source: "user", content: "  " },
			{
				type: "user",
				source: "user",
				content: "keep",
				imageAttachments: [
					null,
					"bad",
					{ id: "missing fields" },
					{
						id: "image-1",
						name: "photo.jpeg",
						path: "/tmp/photo.jpeg",
						size: 12,
						mediaType: "image/jpeg",
					},
				],
			},
			{ type: "assistant", content: 42, toolCalls: undefined },
			{ type: "assistant", content: "call", toolCalls: [toolCall] },
			{
				type: "tool_result",
				toolCallId: "call-1",
				toolName: "read_file",
				result: {
					ok: false,
					content: "failed",
					payload: null,
					modelVisibleSummary: { kind: "text", text: "summary" },
					error: { message: "failure" },
				},
			},
		];
		const result = sanitizeNativeApiResumeHistory(input);
		expect(result).toHaveLength(4);
		expect(result?.[0]).toMatchObject({
			type: "user",
			content: "keep",
			imageAttachments: [{ id: "image-1" }],
		});
		expect(result?.[1]).toEqual({ type: "assistant", content: "" });
		expect(result?.[3]).toMatchObject({
			type: "tool_result",
			result: {
				ok: false,
				payload: null,
				modelVisibleSummary: { kind: "text" },
				error: { message: "failure" },
			},
		});
	});

	it("normalizes tool arguments and trims only complete call pairs", () => {
		const history = [
			{ type: "user", source: "user", content: "old" },
			{
				type: "assistant",
				content: "call",
				toolCalls: [{ id: "call-1", name: "read_file", arguments: "bad" }],
			},
			{
				type: "tool_result",
				toolCallId: "call-1",
				toolName: "read_file",
				result: toolResult,
			},
			{ type: "user", source: "user", content: "new" },
		];
		expect(
			sanitizeNativeApiResumeHistory(history, { maxItems: 10 }),
		).toHaveLength(4);
		expect(sanitizeNativeApiResumeHistory(history, { maxItems: 2 })).toEqual([
			{ type: "user", source: "user", content: "new" },
		]);
		expect(
			sanitizeNativeApiResumeHistory(history, { maxItems: 3 }),
		).toHaveLength(3);
		expect(sanitizeNativeApiResumeHistory(history, { maxItems: 0 })).toEqual(
			[],
		);
		expect(sanitizeNativeApiResumeHistory(history, { maxItems: -5 })).toEqual(
			[],
		);
	});

	it.each([
		null,
		{},
		[null],
		[["array"]],
		[{ type: "unknown" }],
		[{ type: "assistant", content: "x", toolCalls: {} }],
		[{ type: "assistant", content: "x", toolCalls: [null] }],
		[{ type: "assistant", content: "x", toolCalls: [["bad"]] }],
		[
			{
				type: "assistant",
				content: "x",
				toolCalls: [{ id: "", name: "tool" }],
			},
		],
		[{ type: "assistant", content: "x", toolCalls: [{ id: "id", name: "" }] }],
		[
			{
				type: "tool_result",
				toolCallId: "",
				toolName: "tool",
				result: toolResult,
			},
		],
		[
			{
				type: "tool_result",
				toolCallId: "id",
				toolName: "",
				result: toolResult,
			},
		],
		[{ type: "tool_result", toolCallId: "id", toolName: "tool", result: null }],
		[{ type: "tool_result", toolCallId: "id", toolName: "tool", result: [] }],
		[{ type: "tool_result", toolCallId: "id", toolName: "tool", result: {} }],
		[
			{
				type: "tool_result",
				toolCallId: "id",
				toolName: "tool",
				result: { ok: true, content: 1 },
			},
		],
		[
			{
				type: "tool_result",
				toolCallId: "unknown",
				toolName: "tool",
				result: toolResult,
			},
		],
		[
			{ type: "assistant", content: "call", toolCalls: [toolCall] },
			{
				type: "tool_result",
				toolCallId: "call-1",
				toolName: "read_file",
				result: toolResult,
			},
			{
				type: "tool_result",
				toolCallId: "call-1",
				toolName: "read_file",
				result: toolResult,
			},
		],
		[{ type: "assistant", content: "pending", toolCalls: [toolCall] }],
	] as const)("rejects malformed resume history %#", (value) => {
		expect(sanitizeNativeApiResumeHistory(value)).toBeNull();
	});

	it("reads ontology flags and validates exploration catalog pins", () => {
		expect(readOntologyMcpEnabled(context())).toBe(false);
		expect(
			readOntologyMcpEnabled(
				context({
					contextSnapshot: {
						compiledPrompt: "x",
						source: "task_prompt",
						ontologyMcp: [],
					},
				}),
			),
		).toBe(false);
		expect(
			readOntologyMcpEnabled(
				context({
					contextSnapshot: {
						compiledPrompt: "x",
						source: "task_prompt",
						ontologyMcp: { enabled: true },
					},
				}),
			),
		).toBe(true);

		expect(readProjectExplorationCatalogPin(context())).toBeNull();
		const catalog = {
			version: 2,
			available: false,
			reason: "not_prepared",
			retryable: true,
			preparation: { durationMs: 0, pollCount: 0 },
		};
		expect(
			readProjectExplorationCatalogPin(
				context({
					contextSnapshot: {
						compiledPrompt: "x",
						source: "task_prompt",
						projectExplorationCatalog: catalog,
					},
				}),
			),
		).toEqual(catalog);
	});
});
