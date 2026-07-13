import { describe, expect, it } from "vitest";
import {
	projectWorkerResultToMcpStructuredPayload,
	projectWorkerResultToNativeApiToolResult,
} from "../../api/services/agent-runtime/native-api-runner/native-api-tool-result-projector";
import "./setup";

describe("NativeApiRunner result projection", () => {
	it("keeps native/API model-visible tool result content bounded while preserving payload", () => {
		const fullText = [
			"start",
			...Array.from(
				{ length: 1200 },
				(_, index) => `verbose native payload ${index}`,
			),
			"AssertionError: expected native result to be compacted",
			...Array.from(
				{ length: 1200 },
				(_, index) => `tail native payload ${index}`,
			),
		].join("\n");
		const result = projectWorkerResultToNativeApiToolResult(
			{
				ok: true,
				toolName: "read_file",
				startedAt: new Date(0).toISOString(),
				finishedAt: new Date(0).toISOString(),
				payload: { content: fullText },
			},
			{ contentLimitChars: 1200 },
		);

		expect(result.content).toContain("[model-visible-payload-compressed]");
		expect(result.content).toContain(
			"AssertionError: expected native result to be compacted",
		);
		expect(result.content).not.toContain(fullText);
		expect(result.content.length).toBeLessThanOrEqual(1200);
		expect(result.modelVisibleSummary).toMatchObject({
			truncated: true,
			strategy: "json_summary",
		});
		expect(result.payload).toEqual({ content: fullText });
	});

	it("keeps verification checklist details in the verification model view", () => {
		const result = projectWorkerResultToMcpStructuredPayload({
			ok: true,
			toolName: "read_current_specification",
			startedAt: new Date(0).toISOString(),
			finishedAt: new Date(0).toISOString(),
			payload: {
				taskId: "task-1",
				found: true,
				messageId: "message-1",
				title: "Feature Plan",
				view: "verification",
				content: "## 完了条件\n- [AC-001] API が成功する",
				assembledDesignContext: {
					taskId: "task-1",
					sections: [
						{
							kind: "api_io_contract",
							content: "verification view では不要",
						},
					],
				},
				verification: {
					verificationDocumentId: "verification-1",
					verificationArtifactId: "artifact-1",
					summary: {
						total: 1,
						failedRequired: 0,
						unknownRequired: 1,
					},
					document: {
						version: 1,
						specId: "spec-1",
						specPath: "spec/feature-plan.md",
						conditions: [
							{
								id: "AC-001",
								text: "API が成功する",
								category: "api",
								verificationKind: "automated_test",
								expectedEvidence: ["unit_test"],
								expectedResult: "API が200を返す",
								failureMeaning: "API契約が未達",
								required: true,
							},
						],
						commands: [],
					},
					checklist: [
						{
							conditionId: "AC-001",
							text: "API が成功する",
							required: true,
							status: "pending",
							evidenceIds: [],
						},
					],
				},
			},
		});

		expect(result).toMatchObject({
			view: "verification",
			verification: {
				verificationDocumentId: "verification-1",
				summary: { total: 1, unknownRequired: 1 },
				document: {
					conditions: [
						{
							id: "AC-001",
							text: "API が成功する",
							expectedResult: "API が200を返す",
							failureMeaning: "API契約が未達",
							verificationKind: "automated_test",
						},
					],
				},
				checklist: [
					{
						conditionId: "AC-001",
						text: "API が成功する",
						status: "pending",
					},
				],
			},
		});
		expect(
			(result as { assembledDesignContext?: unknown }).assembledDesignContext,
		).toBeUndefined();
	});

	it("keeps all verification conditions structured under the payload limit", () => {
		const conditions = Array.from({ length: 11 }, (_, index) => ({
			id: `AC-${String(index + 1).padStart(3, "0")}`,
			text: `condition ${index + 1} ${"x".repeat(180)}`,
			category: "workflow",
			verificationKind: "automated_test",
			expectedEvidence: ["integration_test"],
			expectedResult: `expected ${"y".repeat(180)}`,
			failureMeaning: `failure ${"z".repeat(180)}`,
			required: true,
		}));
		const result = projectWorkerResultToMcpStructuredPayload({
			ok: true,
			toolName: "read_current_specification",
			startedAt: new Date(0).toISOString(),
			finishedAt: new Date(0).toISOString(),
			payload: {
				taskId: "task-1",
				found: true,
				view: "verification",
				content: `# Feature Plan\n${"spec".repeat(4_000)}`,
				verification: {
					verificationDocumentId: "verification-1",
					document: { version: 1, conditions, commands: [] },
					checklist: conditions.map((condition) => ({
						conditionId: condition.id,
						text: condition.text,
						required: true,
						status: "pending",
						evidenceIds: [],
					})),
				},
			},
		});

		const projected = result as {
			view?: unknown;
			verification?: {
				document?: { conditions?: Array<{ id?: unknown }> };
				checklist?: Array<{ conditionId?: unknown }>;
			};
		};
		expect(projected.view).toBe("verification");
		expect(projected.verification?.document?.conditions).toHaveLength(11);
		expect(projected.verification?.document?.conditions?.at(-1)?.id).toBe(
			"AC-011",
		);
		expect(projected.verification?.checklist).toHaveLength(11);
		expect(projected.verification?.checklist?.at(-1)?.conditionId).toBe(
			"AC-011",
		);
		expect(result).not.toMatchObject({ truncated: true });
	});

	it("projects high-volume worker tool payloads into compact model-visible views", () => {
		const todos = Array.from({ length: 25 }, (_, index) => ({
			id: `todo-${index + 1}`,
			seq: index + 1,
			title: `Todo ${index + 1}`,
			taskType: "implementation",
			status: index === 2 ? "running" : index < 2 ? "passed" : "pending",
		}));
		const workerTodoResult = {
			ok: true,
			toolName: "todo_list",
			startedAt: new Date(0).toISOString(),
			finishedAt: new Date(0).toISOString(),
			payload: {
				runId: "run-1",
				taskId: "task-1",
				action: "todo_list",
				operation: "done",
				todos,
				currentTodo: todos[2],
				nextTodo: todos[3],
				transition: { completedSeq: 2, nextCurrentSeq: 3 },
			},
		} as const;
		const todoResult =
			projectWorkerResultToNativeApiToolResult(workerTodoResult);
		const todoContent = JSON.parse(todoResult.content);

		expect(todoContent.modelVisiblePayload).toBe("compact");
		expect(todoContent.payload.todos).toHaveLength(24);
		expect(todoContent.payload.omittedTodoCount).toBe(1);
		expect(todoContent.payload.counts).toMatchObject({
			total: 25,
			pending: 22,
			running: 1,
		});
		expect(todoContent.payload.currentTodo).toMatchObject({
			seq: 3,
			title: "Todo 3",
		});
		expect(todoContent.payload.listIsCanonicalSummary).toBe(false);
		expect(todoResult.payload).toMatchObject({ todos });
		const todoStructuredPayload =
			projectWorkerResultToMcpStructuredPayload(workerTodoResult);

		expect(todoStructuredPayload).toMatchObject({
			operation: "done",
			counts: { total: 25, pending: 22, running: 1 },
			currentTodo: { seq: 3, title: "Todo 3" },
		});
		expect((todoStructuredPayload as { todos?: unknown[] }).todos).toHaveLength(
			24,
		);

		const replacePayload = {
			runId: "run-1",
			taskId: "task-1",
			action: "todo_list",
			operation: "replace",
			todos,
			currentTodo: todos[2],
			nextTodo: todos[3],
		};
		const replaceStructuredPayload = projectWorkerResultToMcpStructuredPayload({
			ok: true,
			toolName: "todo_list",
			startedAt: new Date(0).toISOString(),
			finishedAt: new Date(0).toISOString(),
			payload: replacePayload,
		});

		expect(replaceStructuredPayload).toMatchObject({
			operation: "replace",
			listIsCanonicalSummary: true,
			omittedTodoCount: 1,
		});
		expect(
			(replaceStructuredPayload as { todos?: unknown[] }).todos,
		).toHaveLength(24);

		const longSpec = `# Feature Plan\n${Array.from(
			{ length: 900 },
			(_, index) => `## Section ${index}\nDetail ${index}`,
		).join("\n")}`;
		const specResult = projectWorkerResultToNativeApiToolResult({
			ok: true,
			toolName: "read_current_specification",
			startedAt: new Date(0).toISOString(),
			finishedAt: new Date(0).toISOString(),
			payload: {
				taskId: "task-1",
				found: true,
				title: "Feature Plan",
				content: longSpec,
				digest: "sha256:spec",
				assembledDesignContext: {
					taskId: "task-1",
					generatedAt: "2026-07-06T00:00:00.000Z",
					questionnaireSessionId: "questionnaire-1",
					summary: "Task: Todo",
					sections: [
						{
							kind: "api_io_contract",
							title: "Todo API Contract",
							sourceMessageId: "msg-api",
							digest: "sha256:api",
							content: `POST /api/todos\n${"x".repeat(2200)}`,
						},
					],
					sourceMessageIds: ["msg-api"],
					omittedViews: [],
					warnings: [],
				},
				sources: {},
			},
		});
		const specContent = JSON.parse(specResult.content);

		expect(specContent.payload.content).toBeUndefined();
		expect(specContent.payload.compactContent).toContain(
			"[specification-compact-view]",
		);
		expect(specContent.payload.contentChars).toBe(longSpec.length);
		expect(
			specContent.payload.assembledDesignContext.sections[0],
		).toMatchObject({
			kind: "api_io_contract",
			title: "Todo API Contract",
			sourceMessageId: "msg-api",
		});
		expect(
			specContent.payload.assembledDesignContext.questionnaireSessionId,
		).toBe("questionnaire-1");
		expect(
			specContent.payload.assembledDesignContext.sections[0].content,
		).toContain("[section-truncated]");
		expect(specContent.payload.fullViewAvailableVia).toBe(
			"read_current_specification view='full'",
		);
		expect(specResult.payload).toMatchObject({ content: longSpec });

		const longDiff = Array.from(
			{ length: 900 },
			(_, index) =>
				`diff --git a/file-${index}.ts b/file-${index}.ts\n@@ -1 +1 @@\n-old\n+new`,
		).join("\n");
		const diffResult = projectWorkerResultToNativeApiToolResult({
			ok: true,
			toolName: "git_diff",
			startedAt: new Date(0).toISOString(),
			finishedAt: new Date(0).toISOString(),
			payload: {
				hasChanges: true,
				diffStat: "900 files changed",
				diff: longDiff,
			},
		});
		const diffContent = JSON.parse(diffResult.content);

		expect(diffContent.payload.diff).toBeUndefined();
		expect(diffContent.payload.compactDiff).toContain(
			"[git-diff-compact-view]",
		);
		expect(diffContent.payload.hunkCount).toBe(900);
		expect(diffContent.payload.fullDiffRetainedInAuditPayload).toBe(true);
		expect(diffResult.payload).toMatchObject({ diff: longDiff });
	});
});
