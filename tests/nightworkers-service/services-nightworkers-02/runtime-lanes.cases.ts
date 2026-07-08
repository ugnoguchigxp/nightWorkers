import { describe, expect, it, vi } from "vitest";
import * as repo from "../../../api/modules/nightworkers/nightworkers.repository";
import { startTaskRun } from "../../../api/modules/nightworkers/nightworkers.service";
import * as runtimeRegistry from "../../../api/services/agent-runtime/registry";
import { implementationPhasePreamble, repoRoot } from "./setup";

describe("NightWorkers service", () => {
	it("keeps API implementation routes on the native-api-runner lane even when legacy Codex is enabled", async () => {
		delete process.env.NIGHTWORKERS_RUNTIME_LANE;
		process.env.ACTIVE_LLM_PROVIDER = "codex";
		process.env.CODEX_ENABLED = "true";
		const task = {
			id: "task-codex-provider",
			repositoryId: "repo-codex-provider",
			title: "Codex provider task",
			description: "Use Codex provider",
			objective: "Use Codex provider",
			acceptanceCriteria:
				"API implementation route stays on native-api-runner lane",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-codex-provider",
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
			{ role: "user", content: "Use Codex provider" },
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "completed",
			summary: "Codex provider done",
			finalReport: "Codex provider done",
			stoppedBy: "decision",
			riskLevel: "medium",
			diffPatch: "",
			logContent: "",
		});
		vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
			kind: "codex-agent",
			start: runtimeStart,
			stop: vi.fn(),
		} as never);

		await startTaskRun(task.id);

		expect(repo.createTaskRun).toHaveBeenCalledWith(
			expect.objectContaining({
				workerKind: "native-local",
				contextSnapshot: expect.objectContaining({
					runtimeLane: "native-api-runner",
					runtimeLaneResolution: expect.objectContaining({
						workerKind: "native-local",
					}),
				}),
			}),
		);
		const todos =
			vi.mocked(repo.replaceTaskRunTodosForRun).mock.calls[0]?.[1] || [];
		expect(todos).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: "コーディング準備を行う",
					taskType: "coding_preparation",
					status: "running",
				}),
				expect.objectContaining({
					title: "仕様と既存構成を確認する",
					taskType: "inspection",
				}),
				expect.objectContaining({
					title: "対象画面の実装準備を行う",
					taskType: "scaffold",
				}),
				expect.objectContaining({
					title: "対象画面を仕様に沿って実装する",
					taskType: "implementation",
				}),
				expect.objectContaining({
					title: "品質ゲート verify コマンドを通す",
					taskType: "verification",
				}),
			]),
		);
		expect(runtimeRegistry.resolveAgentRuntime).toHaveBeenCalledWith(
			"native-local",
		);
	});

	it("starts simple runtime once and precreates a visible TodoList", async () => {
		const task = {
			id: "task-sequential",
			repositoryId: "repo-sequential",
			title: "Sequential task",
			description: "1. Update the code\n2. Add regression tests",
			objective: "Run task once",
			acceptanceCriteria: "Runtime completes",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-sequential",
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
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "completed",
			summary: "Runtime done",
			finalReport: "Runtime report",
			stoppedBy: "decision",
			riskLevel: "low",
			diffPatch: "diff --git a/a b/a",
			logContent: "log",
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
				compiledPrompt: expect.stringContaining("Update the code"),
				latestUserMessage: `${implementationPhasePreamble}\n\n${task.description}`,
				contextSnapshot: expect.objectContaining({
					executionPhase: "implementation",
					planModeClosed: true,
					implementationPhasePreamble,
				}),
			}),
		);
		expect(repo.replaceTaskRunTodosForRun).toHaveBeenCalledWith(
			run.id,
			expect.arrayContaining([
				expect.objectContaining({
					seq: 1,
					title: "コーディング準備を行う",
					taskType: "coding_preparation",
					status: "running",
				}),
				expect.objectContaining({
					title: "仕様と既存構成を確認する",
					taskType: "inspection",
				}),
				expect.objectContaining({
					title: "対象画面を仕様に沿って実装する",
					taskType: "implementation",
				}),
			]),
		);
		expect(repo.updateTaskRunTodo).not.toHaveBeenCalled();
	});

	it("starts native/API planning mode without implementation Todos or preamble", async () => {
		const task = {
			id: "task-plan-mode",
			repositoryId: "repo-plan-mode",
			title: "Planning task",
			description: "実装計画を作ってください",
			objective: "実装計画を作ってください",
			acceptanceCriteria: "Plan is produced",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-plan-mode",
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
			{ id: "message-user", role: "user", content: task.description },
			{
				id: "message-run-started",
				role: "system",
				content: "Planning run started from Workbench intake.",
				metadataJson: {
					intent: "run_started",
					source: "workbench",
					intakeJobSelection: {
						jobType: "planning",
						goal: task.description,
					},
				},
			},
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "completed",
			summary: "Plan done",
			finalReport: "Implementation plan",
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
		expect(repo.replaceTaskRunTodosForRun).toHaveBeenCalledWith(run.id, []);
		expect(runtimeStart.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				latestUserMessage: task.description,
				runtimeOptions: expect.objectContaining({
					executionMode: "planning",
				}),
				contextSnapshot: expect.objectContaining({
					executionPhase: "planning",
					planModeClosed: false,
				}),
			}),
		);
		expect(runtimeStart.mock.calls[0][0].latestUserMessage).not.toContain(
			"plan mode はこの時点で終了です。",
		);
	});

	it("routes removed or unknown job types to general answers without implementation startup", async () => {
		const task = {
			id: "task-removed-job-type",
			repositoryId: "repo-removed-job-type",
			title: "Investigate previous run status",
			description: "前回の実行ログと状態を確認してください",
			objective: "前回の実行ログと状態を確認してください",
			acceptanceCriteria: "Status is explained without starting implementation",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-removed-job-type",
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
			{ id: "message-user", role: "user", content: task.description },
			{
				id: "message-stale-run-started",
				role: "system",
				content: "A previous run started from Workbench intake.",
				metadataJson: {
					intent: "run_started",
					source: "workbench",
					intakeJobSelection: {
						jobType: "removed_mode",
						goal: task.description,
					},
				},
			},
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "completed",
			summary: "Status explained",
			finalReport: "Status explained",
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
		expect(repo.replaceTaskRunTodosForRun).toHaveBeenCalledWith(run.id, []);
		expect(runtimeStart.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				latestUserMessage: task.description,
				runtimeOptions: expect.objectContaining({
					executionMode: "general_answer",
				}),
				contextSnapshot: expect.objectContaining({
					executionPhase: "general_answer",
					planModeClosed: true,
				}),
			}),
		);
		expect(runtimeStart.mock.calls[0][0].latestUserMessage).not.toContain(
			"plan mode はこの時点で終了です。",
		);
	});

	it("passes the latest implementation handoff document into native/API implementation runs", async () => {
		const task = {
			id: "task-handoff",
			repositoryId: "repo-handoff",
			title: "Implementation handoff task",
			description: "この計画を実装してください",
			objective: "Implement from handoff",
			acceptanceCriteria: "Runtime receives handoff content",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-handoff",
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "running",
		};
		const handoff =
			"# Implementation Plan\n\n- native/API tool surface を調整する";
		vi.mocked(repo.getTask).mockResolvedValue(task as never);
		vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
		vi.mocked(repo.getRepository).mockResolvedValue({
			id: task.repositoryId,
			localPath: repoRoot,
			safetyPolicy: {},
		} as never);
		vi.mocked(repo.listTaskMessages).mockResolvedValue([
			{ id: "msg-user", role: "user", content: task.description },
			{
				id: "msg-plan",
				role: "assistant",
				content: handoff,
				messageType: "markdown_document",
				metadataJson: { intent: "implementation_plan" },
			},
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
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
			expect.stringContaining("<IMPLEMENTATION_HANDOFF>"),
		);
		expect(runtimeStart.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				compiledPrompt: expect.stringContaining(handoff),
				latestUserMessage: expect.stringContaining(handoff),
				contextSnapshot: expect.objectContaining({
					compiledPrompt: expect.stringContaining("<IMPLEMENTATION_HANDOFF>"),
					executionPhase: "implementation",
					planModeClosed: true,
				}),
			}),
		);
		expect(runtimeStart.mock.calls[0][0].latestUserMessage).toContain(
			"直近の Implementation Plan / Draft Spec を主な作業入力として扱ってください。",
		);
	});

	it("uses an explicit implementation handoff instead of stale planning intake", async () => {
		const task = {
			id: "task-draft-spec-handoff",
			repositoryId: "repo-draft-spec-handoff",
			title: "Todo List",
			description: "",
			objective: "todo list を作りたいです。 計画してください",
			acceptanceCriteria: "Todo List specification is ready for implementation",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-draft-spec-handoff",
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
				id: "message-user",
				role: "user",
				content: "todo list を作りたいです。 計画してください",
				messageType: "text",
				metadataJson: null,
			},
			{
				id: "message-stale-planning-intake",
				role: "system",
				content: "Design Questionnaire を生成しました。",
				messageType: "text",
				metadataJson: {
					intent: "design_questionnaire_ready",
					intakeJobSelection: {
						jobType: "planning",
						goal: "todo list を作成するための実装方針と作業手順を整理する",
					},
				},
			},
			{
				id: "message-queue",
				role: "system",
				content: "Implementation Queue entry created.",
				messageType: "text",
				metadataJson: {
					source: "implementation_queue",
					status: "queued",
				},
			},
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "completed",
			summary: "Implementation done",
			finalReport: "Implementation report",
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

		await startTaskRun(task.id, {
			executionMode: "implementation",
			executionModeSource: "workbench_run",
		});

		await vi.waitFor(() => {
			expect(runtimeStart).toHaveBeenCalledTimes(1);
		});
		expect(repo.replaceTaskRunTodosForRun).not.toHaveBeenCalledWith(run.id, []);
		expect(runtimeStart.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				latestUserMessage: `${implementationPhasePreamble}\n\ntodo list を作りたいです。 計画してください`,
				runtimeOptions: expect.objectContaining({
					executionMode: "implementation",
				}),
				contextSnapshot: expect.objectContaining({
					executionModeSource: "workbench_run",
					executionPhase: "implementation",
					planModeClosed: true,
					implementationPhasePreamble,
				}),
			}),
		);
	});
});
