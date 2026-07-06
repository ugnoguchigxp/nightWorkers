import { describe, expect, it, vi } from "vitest";
import * as repo from "../../../api/modules/nightworkers/nightworkers.repository";
import { startTaskRun } from "../../../api/modules/nightworkers/nightworkers.service";
import * as runtimeRegistry from "../../../api/services/agent-runtime/registry";
import * as conversationContext from "../../../api/services/conversation-context";
import { implementationPhasePreamble, repoRoot } from "./setup";

describe("NightWorkers service", () => {
	it("does not auto-close unfinished Todos when runtime completes", async () => {
		const task = {
			id: "task-open-todos",
			repositoryId: "repo-open-todos",
			title: "Open Todo task",
			description: "Complete with open todos",
			objective: "Complete with open todos",
			acceptanceCriteria: "Runtime completes",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-open-todos",
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "running",
		};
		vi.mocked(repo.getTask).mockResolvedValue(task as never);
		vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
		vi.mocked(repo.getRepository).mockResolvedValue({
			id: task.repositoryId,
			localPath: repoRoot,
			safetyPolicy: {},
		} as never);
		vi.mocked(repo.listTaskMessages).mockResolvedValue([
			{ role: "user", content: task.description },
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([
			{
				id: "todo-running",
				runId: run.id,
				seq: 1,
				title: "Running Todo",
				taskType: "implementation",
				status: "running",
				startedAt: new Date("2026-06-12T00:00:00.000Z"),
			},
			{
				id: "todo-pending",
				runId: run.id,
				seq: 2,
				title: "Pending Todo",
				taskType: "verification",
				status: "pending",
			},
			{
				id: "todo-passed",
				runId: run.id,
				seq: 3,
				title: "Passed Todo",
				taskType: "review",
				status: "passed",
			},
		] as never);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "completed",
			summary: "Runtime done",
			finalReport: "Runtime report",
			stoppedBy: "decision",
			riskLevel: "low",
			diffPatch: "",
			logContent: "",
			contractWarnings: [
				{
					code: "codex_file_change_before_todo_replace",
					severity: "warning",
					message: "File changed before Todo replace.",
					providerItemId: "file-1",
					toolName: null,
					todoId: "todo-running",
					todoSeq: 1,
					changedFiles: ["src/app.ts"],
					command: null,
					sequence: 4,
					occurredAt: "2026-06-12T00:00:00.000Z",
					count: 2,
				},
			],
		});
		vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
			kind: "native-local",
			start: runtimeStart,
			stop: vi.fn(),
		} as never);

		await startTaskRun(task.id);

		await vi.waitFor(() => {
			expect(repo.updateTaskRun).toHaveBeenCalledWith(
				run.id,
				expect.objectContaining({
					status: "needs_human",
					summary:
						"Runtime finished without explicitly closing all open Todos.",
					finalReport: expect.stringContaining(
						"Todo closeout incomplete: #1 Running Todo (running), #2 Pending Todo (pending)",
					),
					contextSnapshot: expect.objectContaining({
						runtimeContract: expect.objectContaining({
							lane: "native-api-runner",
							warnings: expect.arrayContaining([
								expect.objectContaining({
									code: "codex_file_change_before_todo_replace",
									sequence: 4,
									occurredAt: "2026-06-12T00:00:00.000Z",
									count: 2,
								}),
								expect.objectContaining({
									code: "codex_open_todos_before_completion",
									todoId: "todo-running",
									todoSeq: 1,
								}),
							]),
						}),
					}),
				}),
			);
		});
		expect(repo.updateTaskRunTodo).not.toHaveBeenCalled();
		expect(repo.updateTaskStatus).toHaveBeenCalledWith(task.id, "needs_human");
		expect(repo.createRunEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: run.id,
				taskId: task.id,
				type: "run.outcome_decided",
				message:
					"Runtime finished before explicit Todo closeout; run cannot be marked completed.",
				data: expect.objectContaining({
					warningCode: "codex_open_todos_before_completion",
					contractWarning: expect.objectContaining({
						code: "codex_open_todos_before_completion",
					}),
					terminalState: "completed",
					nextStatus: "needs_human",
					openTodos: expect.arrayContaining([
						expect.objectContaining({
							id: "todo-running",
							seq: 1,
							status: "running",
						}),
						expect.objectContaining({
							id: "todo-pending",
							seq: 2,
							status: "pending",
						}),
					]),
				}),
			}),
		);
	});

	it("closes open Todos when runtime returns a failed terminal result", async () => {
		const task = {
			id: "task-runtime-failed-open-todos",
			repositoryId: "repo-runtime-failed-open-todos",
			title: "Failed runtime task",
			description: "Runtime fails with open todos",
			objective: "Fail with open todos",
			acceptanceCriteria: "Open todos are closed",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-runtime-failed-open-todos",
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "running",
		};
		vi.mocked(repo.getTask).mockResolvedValue(task as never);
		vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
		vi.mocked(repo.getRepository).mockResolvedValue({
			id: task.repositoryId,
			localPath: repoRoot,
			safetyPolicy: {},
		} as never);
		vi.mocked(repo.listTaskMessages).mockResolvedValue([
			{ role: "user", content: task.description },
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([
			{
				id: "todo-running-failed",
				runId: run.id,
				seq: 1,
				title: "Running Todo",
				taskType: "implementation",
				status: "running",
				startedAt: new Date("2026-06-12T00:00:00.000Z"),
			},
			{
				id: "todo-pending-failed",
				runId: run.id,
				seq: 2,
				title: "Pending Todo",
				taskType: "verification",
				status: "pending",
			},
		] as never);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "failed",
			summary:
				"Codex Agent Runtime failed: provider_capacity: Selected model is at capacity.",
			finalReport:
				"Codex Agent Runtime failed: provider_capacity: Selected model is at capacity.",
			stoppedBy: "llm_error",
			riskLevel: "high",
			diffPatch: "",
			logContent: "diagnostics",
			testResults: {
				codexFailure: {
					terminalReason: "provider_capacity",
				},
			},
		});
		vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
			kind: "codex-agent",
			start: runtimeStart,
			stop: vi.fn(),
		} as never);

		await startTaskRun(task.id);

		await vi.waitFor(() => {
			expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
				"todo-running-failed",
				expect.objectContaining({
					status: "failed",
					statusReason: "provider_capacity",
					completionGateResult: expect.objectContaining({
						status: "failed",
						evidence: expect.objectContaining({
							terminalState: "failed",
							terminalReason: "provider_capacity",
						}),
					}),
				}),
				{ notifyTaskId: task.id, notifyRunId: run.id },
			);
			expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
				"todo-pending-failed",
				expect.objectContaining({
					status: "skipped",
					statusReason: "provider_capacity",
				}),
				{ notifyTaskId: task.id, notifyRunId: run.id },
			);
			expect(repo.updateTaskRun).toHaveBeenCalledWith(
				run.id,
				expect.objectContaining({
					status: "failed",
					summary:
						"Codex Agent Runtime failed: provider_capacity: Selected model is at capacity.",
				}),
			);
		});
	});

	it("injects StateCard into runtime latestUserMessage while preserving raw compiled prompt", async () => {
		const task = {
			id: "task-state-card",
			repositoryId: "repo-state-card",
			title: "StateCard task",
			description: "initial",
			objective: "initial",
			acceptanceCriteria: "Runtime completes",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-state-card",
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "running",
		};
		vi.mocked(repo.getTask).mockResolvedValue(task as never);
		vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
		vi.mocked(repo.getRepository).mockResolvedValue({
			id: task.repositoryId,
			localPath: repoRoot,
			safetyPolicy: {},
		} as never);
		vi.mocked(repo.listTaskMessages).mockResolvedValue([
			{
				id: "message-1",
				role: "user",
				content: "foo 条件も追加してください７で割ってください",
			},
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		vi.mocked(
			conversationContext.getLatestConversationContextForTask,
		).mockResolvedValue({
			id: "snapshot-1",
			taskId: task.id,
			runId: "run-previous",
			version: 1,
			jobType: "minor_code_edit",
			latestUserMessageId: "message-previous",
			previousRunId: "run-previous",
			terminalState: "completed",
			tokenEstimate: 42,
			snapshotJson: { version: 1, task: { id: task.id } } as never,
			stateCardText:
				"<STATE_CARD>\nTask: task-state-card | minor_code_edit | continuation\n</STATE_CARD>",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "completed",
			summary: "Runtime done",
			finalReport: "Runtime report",
			stoppedBy: "decision",
			riskLevel: "low",
			diffPatch: "",
			logContent: "",
		});
		vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
			kind: "native-local",
			start: runtimeStart,
			stop: vi.fn(),
		} as never);

		await startTaskRun(task.id);

		await vi.waitFor(() => {
			expect(runtimeStart).toHaveBeenCalledTimes(1);
		});
		expect(repo.updateTaskCompiledPrompt).toHaveBeenCalledWith(
			task.id,
			"foo 条件も追加してください７で割ってください",
		);
		expect(runtimeStart.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				compiledPrompt: "foo 条件も追加してください７で割ってください",
				latestUserMessage: expect.stringContaining("<STATE_CARD>"),
				contextSnapshot: expect.objectContaining({
					compiledPrompt: "foo 条件も追加してください７で割ってください",
					executionPhase: "implementation",
					planModeClosed: true,
					implementationPhasePreamble,
					conversationContext: expect.objectContaining({
						snapshotId: "snapshot-1",
						stateCardIncluded: true,
						stateCardText: expect.stringContaining("<STATE_CARD>"),
						snapshotJson: expect.objectContaining({
							version: 1,
						}),
					}),
				}),
			}),
		);
	});

	it("does not inject a StateCard built from the current latest user message", async () => {
		const task = {
			id: "task-current-state-card",
			repositoryId: "repo-current-state-card",
			title: "Current StateCard task",
			description: "initial",
			objective: "initial",
			acceptanceCriteria: "Runtime completes",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-current-state-card",
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "running",
		};
		vi.mocked(repo.getTask).mockResolvedValue(task as never);
		vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
		vi.mocked(repo.getRepository).mockResolvedValue({
			id: task.repositoryId,
			localPath: repoRoot,
			safetyPolicy: {},
		} as never);
		vi.mocked(repo.listTaskMessages).mockResolvedValue([
			{
				id: "message-current",
				role: "user",
				content: "foo 条件も追加してください",
			},
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		vi.mocked(
			conversationContext.getLatestConversationContextForTask,
		).mockResolvedValue({
			id: "snapshot-current",
			taskId: task.id,
			runId: "run-current",
			version: 1,
			jobType: "minor_code_edit",
			latestUserMessageId: "message-current",
			previousRunId: "run-current",
			terminalState: "completed",
			tokenEstimate: 42,
			snapshotJson: { version: 1, task: { id: task.id } } as never,
			stateCardText:
				"<STATE_CARD>\nTask: task-current-state-card | minor_code_edit | continuation\n</STATE_CARD>",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "completed",
			summary: "Runtime done",
			finalReport: "Runtime report",
			stoppedBy: "decision",
			riskLevel: "low",
			diffPatch: "",
			logContent: "",
		});
		vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
			kind: "native-local",
			start: runtimeStart,
			stop: vi.fn(),
		} as never);

		await startTaskRun(task.id);

		await vi.waitFor(() => {
			expect(runtimeStart).toHaveBeenCalledTimes(1);
		});
		expect(runtimeStart.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				latestUserMessage: `${implementationPhasePreamble}\n\nfoo 条件も追加してください`,
				contextSnapshot: expect.objectContaining({
					executionPhase: "implementation",
					planModeClosed: true,
					implementationPhasePreamble,
					conversationContext: expect.objectContaining({
						stateCardIncluded: false,
						usage: expect.objectContaining({
							stateCardTokens: 0,
						}),
					}),
				}),
			}),
		);
	});

	it("keeps runtime latestUserMessage raw when StateCard injection is explicitly disabled", async () => {
		process.env.CONVERSATION_CONTEXT_ENABLED = "false";
		const task = {
			id: "task-state-card-disabled",
			repositoryId: "repo-state-card-disabled",
			title: "StateCard disabled task",
			description: "initial",
			objective: "initial",
			acceptanceCriteria: "Runtime completes",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-state-card-disabled",
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "running",
		};
		vi.mocked(repo.getTask).mockResolvedValue(task as never);
		vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
		vi.mocked(repo.getRepository).mockResolvedValue({
			id: task.repositoryId,
			localPath: repoRoot,
			safetyPolicy: {},
		} as never);
		vi.mocked(repo.listTaskMessages).mockResolvedValue([
			{ id: "message-1", role: "user", content: "raw request" },
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		vi.mocked(
			conversationContext.getLatestConversationContextForTask,
		).mockResolvedValue({
			id: "snapshot-disabled",
			taskId: task.id,
			runId: null,
			version: 1,
			jobType: "minor_code_edit",
			latestUserMessageId: "message-previous",
			previousRunId: "run-previous",
			terminalState: "completed",
			tokenEstimate: 42,
			snapshotJson: { version: 1 } as never,
			stateCardText: "<STATE_CARD>\nTask: disabled\n</STATE_CARD>",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "completed",
			summary: "Runtime done",
			finalReport: "Runtime report",
			stoppedBy: "decision",
			riskLevel: "low",
			diffPatch: "",
			logContent: "",
		});
		vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
			kind: "native-local",
			start: runtimeStart,
			stop: vi.fn(),
		} as never);

		await startTaskRun(task.id);

		await vi.waitFor(() => {
			expect(runtimeStart).toHaveBeenCalledTimes(1);
		});
		expect(runtimeStart.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				latestUserMessage: `${implementationPhasePreamble}\n\nraw request`,
				contextSnapshot: expect.objectContaining({
					executionPhase: "implementation",
					planModeClosed: true,
					implementationPhasePreamble,
					conversationContext: expect.objectContaining({
						stateCardIncluded: false,
						usage: expect.objectContaining({
							stateCardTokens: 0,
						}),
					}),
				}),
			}),
		);
		expect(
			conversationContext.getLatestConversationContextForTask,
		).not.toHaveBeenCalled();
	});

	it("does not inject or load StateCard for review execution mode", async () => {
		const task = {
			id: "task-state-card-review",
			repositoryId: "repo-state-card-review",
			title: "StateCard review task",
			description: "review request",
			objective: "review request",
			acceptanceCriteria: "Runtime completes",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-state-card-review",
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "running",
		};
		vi.mocked(repo.getTask).mockResolvedValue(task as never);
		vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
		vi.mocked(repo.getRepository).mockResolvedValue({
			id: task.repositoryId,
			localPath: repoRoot,
			safetyPolicy: {},
		} as never);
		vi.mocked(repo.listTaskMessages).mockResolvedValue([
			{
				id: "message-review",
				role: "user",
				content: "完了済みの差分をレビューしてください",
				metadataJson: {
					jobSelection: { jobType: "review" },
				},
			},
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		vi.mocked(
			conversationContext.getLatestConversationContextForTask,
		).mockResolvedValue({
			id: "snapshot-review",
			taskId: task.id,
			runId: "run-previous",
			version: 1,
			jobType: "minor_code_edit",
			latestUserMessageId: "message-previous",
			previousRunId: "run-previous",
			terminalState: "completed",
			tokenEstimate: 42,
			snapshotJson: { version: 1 } as never,
			stateCardText: "<STATE_CARD>\nTask: review\n</STATE_CARD>",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "completed",
			summary: "Runtime done",
			finalReport: "Runtime report",
			stoppedBy: "decision",
			riskLevel: "low",
			diffPatch: "",
			logContent: "",
		});
		vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
			kind: "native-local",
			start: runtimeStart,
			stop: vi.fn(),
		} as never);

		await startTaskRun(task.id);

		await vi.waitFor(() => {
			expect(runtimeStart).toHaveBeenCalledTimes(1);
		});
		expect(runtimeStart.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				latestUserMessage: "完了済みの差分をレビューしてください",
				contextSnapshot: expect.objectContaining({
					executionPhase: "review",
					planModeClosed: true,
					conversationContext: expect.objectContaining({
						stateCardIncluded: false,
						projection: expect.objectContaining({
							role: "review",
							source: "omitted",
						}),
						usage: expect.objectContaining({
							stateCardTokens: 0,
						}),
					}),
				}),
			}),
		);
		expect(
			conversationContext.getLatestConversationContextForTask,
		).not.toHaveBeenCalled();
	});
});
