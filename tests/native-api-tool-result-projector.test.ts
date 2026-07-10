import { describe, expect, it } from "vitest";
import { projectWorkerResultToNativeApiToolResult } from "../api/services/agent-runtime/native-api-runner/native-api-tool-result-projector";

describe("projectWorkerResultToNativeApiToolResult", () => {
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
