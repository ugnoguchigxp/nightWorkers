import { describe, expect, it } from "vitest";
import { projectWorkerResultToNativeApiToolResult } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-result-projector";

describe("projectWorkerResultToNativeApiToolResult", () => {
	it("projects the LLM-owned Todo command contract without legacy fields", () => {
		const result = projectWorkerResultToNativeApiToolResult({
			ok: true,
			toolName: "todo_list",
			startedAt: "2026-07-15T00:00:00.000Z",
			finishedAt: "2026-07-15T00:00:00.001Z",
			payload: {
				runId: "run-1",
				action: "todo_list",
				command: {
					op: "transition",
					todoId: "todo-1",
					status: "passed",
				},
				planRevision: 3,
				todos: [
					{ id: "todo-1", seq: 1, title: "調査", status: "passed" },
					{ id: "todo-2", seq: 2, title: "実装", status: "running" },
				],
				currentTodo: {
					id: "todo-2",
					seq: 2,
					title: "実装",
					status: "running",
				},
			},
		});
		const modelVisible = JSON.parse(result.content) as {
			payload: Record<string, unknown>;
		};
		expect(modelVisible.payload).toMatchObject({
			operation: "transition",
			planRevision: 3,
			changedTodo: { id: "todo-1", status: "passed" },
			currentTodo: { id: "todo-2", status: "running" },
		});
		expect(modelVisible.payload).not.toHaveProperty("transition");
		expect(modelVisible.payload).not.toHaveProperty("diagnostics");
	});

	it("keeps imported LLM context in audit payload without exposing it to the model", () => {
		const llmContext = `# LLM Context

${"Use the imported template context before extra file reads.\n".repeat(500)}`;
		const result = projectWorkerResultToNativeApiToolResult({
			ok: true,
			toolName: "import_project",
			startedAt: "2026-07-07T00:00:00.000Z",
			finishedAt: "2026-07-07T00:00:01.000Z",
			payload: {
				mode: "template",
				template: { templateId: "hono-standard", variant: "sqlite" },
				git: null,
				postImport: {
					targetPath: "/tmp/project",
					manifest: {
						status: "found",
						recommendedVerificationCommands: ["bun run verify"],
					},
					llmContext: {
						status: "found",
						path: "/tmp/project/LLM_CONTEXT.md",
						rawContent: llmContext,
					},
					gitInitialization: {
						status: "passed",
						command: ["git", "init"],
						baselineCommit: { status: "passed" },
					},
					initialization: {
						status: "passed",
						command: ["bun", "run", "bootstrap"],
					},
				},
			},
		});

		const modelVisible = JSON.parse(result.content) as {
			payload: {
				postImport: {
					llmContext: {
						rawContentDigest: string;
					};
				};
			};
		};

		expect(modelVisible.payload.postImport.llmContext.rawContentDigest).toBe(
			`chars:${llmContext.length}`,
		);
		expect(modelVisible.payload.postImport.llmContext).not.toHaveProperty(
			"rawContent",
		);
		expect(result.payload).toMatchObject({
			postImport: { llmContext: { rawContent: llmContext } },
		});
		expect(result.modelVisibleSummary?.truncated).toBe(false);
	});
});
