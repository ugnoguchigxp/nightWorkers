import { describe, expect, it } from "vitest";
import { projectWorkerResultToNativeApiToolResult } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-result-projector";

describe("projectWorkerResultToNativeApiToolResult", () => {
	it("projects only Todo progress, current, and next to the model", () => {
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
					taskType: "implementation",
					status: "running",
					context: "確定済みAPI契約を変更しない。",
					nextAction: "routeを実装する。",
					acceptanceCriteriaJson: ["契約テストが通る"],
				},
			},
		});
		const modelVisible = JSON.parse(result.content) as {
			payload: Record<string, unknown>;
		};
		expect(modelVisible.payload).toMatchObject({
			operation: "transition",
			progress: {
				total: 2,
				running: 1,
				passed: 1,
				terminal: 1,
			},
			currentTodo: {
				title: "実装",
				status: "running",
				systemContext: "確定済みAPI契約を変更しない。",
			},
			nextTodo: null,
		});
		expect(modelVisible.payload).not.toHaveProperty("planRevision");
		expect(modelVisible.payload).not.toHaveProperty("todos");
		expect(JSON.stringify(modelVisible.payload)).not.toContain("todo-");
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

	it("reads legacy verification documents without projecting removed fields", () => {
		const result = projectWorkerResultToNativeApiToolResult({
			ok: true,
			toolName: "read_current_specification",
			startedAt: "2026-07-19T00:00:00.000Z",
			finishedAt: "2026-07-19T00:00:00.001Z",
			payload: {
				taskId: "task-1",
				found: true,
				view: "verification",
				content: "## 検証計画\n- `bun test`",
				verification: {
					verificationDocumentId: "verification-1",
					document: {
						version: 1,
						specId: "spec-1",
						specPath: "spec/spec-1.md",
						generatedAt: "2026-07-10T00:00:00.000Z",
						conditions: [],
						commands: [
							{
								id: "CMD-001",
								label: "bun test",
								command: "bun test",
								conditionIds: [],
								scope: "focused",
								runnerHint: "unknown",
							},
						],
						nonGoals: [],
					},
					checklist: [],
				},
				sources: {},
			},
		});
		const modelVisible = JSON.parse(result.content) as {
			payload: {
				verification: {
					document: {
						commands: Array<Record<string, unknown>>;
					};
				};
			};
		};

		expect(modelVisible.payload.verification.document.commands[0]).toEqual({
			id: "CMD-001",
			label: "bun test",
			command: "bun test",
			conditionIds: [],
		});
		expect(modelVisible.payload.verification.document).not.toHaveProperty(
			"nonGoals",
		);
	});

	it("projects only Evidence Readiness statuses for completion_check", () => {
		const result = projectWorkerResultToNativeApiToolResult({
			ok: false,
			toolName: "completion_check",
			startedAt: "2026-07-19T00:00:00.000Z",
			finishedAt: "2026-07-19T00:00:00.001Z",
			payload: {
				llmSummary: "Evidence mapping is missing.",
				result: {
					ok: false,
					verificationDocumentId: "verification-1",
					sourceStateHash: "source-1",
					mapping: {
						status: "missing",
						matched: 1,
						total: 2,
						definitionDigest: "definitions-1",
						items: [{ text: "must not reach the model" }],
					},
					verify: {
						status: "not_run",
						command: null,
						exitCode: null,
						sourceStateHash: null,
						logRefs: ["stdout-with-large-test-output"],
					},
					confirmation: {
						status: "confirmed",
						initialEvidenceRunId: "evidence-run-1",
						confirmedAt: "2026-07-19T00:00:00.000Z",
					},
					suggestedAction: "record_mapping",
					readinessDigest: "readiness-1",
					reason: "evidence_mapping_missing",
				},
			},
		});
		const modelVisible = JSON.parse(result.content) as {
			payload: { result: Record<string, unknown> };
		};

		expect(modelVisible.payload.result).toMatchObject({
			mapping: { status: "missing", matched: 1, total: 2 },
			verify: { status: "not_run" },
			confirmation: { status: "confirmed" },
			suggestedAction: "record_mapping",
			readinessDigest: "readiness-1",
		});
		expect(JSON.stringify(modelVisible.payload)).not.toContain(
			"must not reach the model",
		);
		expect(JSON.stringify(modelVisible.payload)).not.toContain(
			"stdout-with-large-test-output",
		);
	});
});
