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

	it("projects only the compact completion decision contract", () => {
		const result = projectWorkerResultToNativeApiToolResult({
			ok: true,
			toolName: "completion_check",
			startedAt: "2026-07-19T00:00:00.000Z",
			finishedAt: "2026-07-19T00:00:00.001Z",
			payload: {
				llmSummary: "NOT_READY completion_check",
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
			ok: boolean;
			payload: Record<string, unknown>;
		};

		expect(modelVisible.ok).toBe(true);
		expect(modelVisible.payload).toEqual({
			ready: false,
			reason: "evidence_mapping_missing",
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

	it("projects only active inventory cases with the runner needed for repair", () => {
		const result = projectWorkerResultToNativeApiToolResult({
			ok: true,
			toolName: "collect_test_inventory",
			startedAt: "2026-08-02T00:00:00.000Z",
			finishedAt: "2026-08-02T00:00:01.000Z",
			payload: {
				id: "inventory-1",
				taskId: "task-1",
				runId: "run-1",
				cwd: "/repo",
				sourceSnapshot: { sourceStateHash: "hidden" },
				cases: [
					{
						caseKey: "T1",
						name: "creates a todo",
						filePath: "tests/todo.test.ts",
						runner: "vitest",
						discoveryLevel: "active",
						declaredConditionIds: ["AC-001"],
					},
					{
						caseKey: "T2",
						name: "candidate",
						filePath: "tests/candidate.test.ts",
						runner: "unknown",
						discoveryLevel: "candidate",
						declaredConditionIds: [],
					},
				],
			},
		});
		const modelVisible = JSON.parse(result.content) as {
			payload: Record<string, unknown>;
		};
		expect(modelVisible.payload).toEqual({
			inventoryId: "inventory-1",
			cases: [
				{
					caseKey: "T1",
					name: "creates a todo",
					file: "tests/todo.test.ts",
					runner: "vitest",
				},
			],
		});
	});

	it("projects compact structured-test success and capture failure", () => {
		for (const [payload, expected] of [
			[
				{
					checkKind: "test",
					status: "passed",
					structuredCaseCount: 171,
					resolvedCaseCount: 171,
				},
				{ status: "passed", parsed: 171, resolved: 171 },
			],
			[
				{
					checkKind: "test",
					status: "evidence_error",
					reason: "TEST_EVIDENCE_CAPTURE_FAILED",
					retryable: false,
					structuredCaseCount: 171,
					resolvedCaseCount: 0,
				},
				{
					status: "evidence_error",
					reason: "TEST_EVIDENCE_CAPTURE_FAILED",
					parsed: 171,
					resolved: 0,
					retryable: false,
				},
			],
		] as const) {
			const result = projectWorkerResultToNativeApiToolResult({
				ok: payload.status === "passed",
				toolName: "run_check",
				startedAt: "2026-08-02T00:00:00.000Z",
				finishedAt: "2026-08-02T00:00:01.000Z",
				payload,
			});
			const modelVisible = JSON.parse(result.content) as { payload: unknown };
			expect(modelVisible.payload).toEqual(expected);
		}
	});
});
