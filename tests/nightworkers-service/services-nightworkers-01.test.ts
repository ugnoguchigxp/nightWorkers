import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as repo from "../../api/modules/nightworkers/nightworkers.repository";
import {
	archiveTask,
	createLocalFolder,
	createWorkbenchSession,
	deleteTask,
	getTaskRun as getTaskRunDetail,
	listTaskRunEvents,
	listTaskRunEventsForReplay,
	startTaskRun,
} from "../../api/modules/nightworkers/nightworkers.service";
import * as runtimeRegistry from "../../api/services/agent-runtime/registry";

const repoRoot = fs.mkdtempSync(
	path.join(os.tmpdir(), "nightworkers-service-01-"),
);
const implementationPhasePreamble = [
	"実装フェーズに移行しました。",
	"plan mode はこの時点で終了です。",
	"ここからは計画相談ではなく、実装・検証・必要な修正・closeout まで最後までやり切ってください。",
	"Todo を作成・更新する場合も、この実装フェーズ前提で進めてください。",
].join("\n");

type RepoTask = NonNullable<Awaited<ReturnType<typeof repo.getTask>>>;
type DeletedTask = Awaited<ReturnType<typeof repo.deleteTask>>;

afterAll(() => {
	fs.rmSync(repoRoot, { recursive: true, force: true });
});

vi.mock("../../api/modules/nightworkers/nightworkers.repository", () => ({
	getTask: vi.fn(),
	updateRepository: vi.fn(),
	updateRepositoryProjectMeta: vi.fn(),
	countActiveTaskRuns: vi.fn(),
	claimNextQueuedTask: vi.fn(),
	listActiveTaskRunsForTask: vi.fn(),
	updateTaskStatus: vi.fn(),
	getRepository: vi.fn(),
	listTaskMessages: vi.fn(),
	createTaskRun: vi.fn(),
	getTaskRun: vi.fn(),
	createTaskRunTodo: vi.fn(),
	replaceTaskRunTodosForRun: vi.fn(),
	listTaskRunTodosForRun: vi.fn(),
	updateTaskRunTodo: vi.fn(),
	createRunEvent: vi.fn(),
	listTaskRunsForTask: vi.fn(),
	listTaskEventsForRun: vi.fn(),
	updateTaskCompiledPrompt: vi.fn(),
	updateTaskRun: vi.fn(),
	createTaskMessage: vi.fn(),
	getImplementationQueueEntryForRun: vi.fn(),
	updateImplementationQueueEntry: vi.fn(),
	createTaskRunCommitRecord: vi.fn(),
	getTaskRunCommitRecord: vi.fn(),
	refreshImplementationQueueLeaseForRun: vi.fn(),
	updateTask: vi.fn(),
	deleteTask: vi.fn(),
	createTask: vi.fn(),
}));

vi.mock("../../api/routes/settings", () => ({
	getCurrentSettings: vi.fn(() => {
		const activeProvider = process.env.ACTIVE_LLM_PROVIDER || "azure";
		const codexEnabled = process.env.CODEX_ENABLED === "true";
		return {
			ACTIVE_LLM_PROVIDER:
				activeProvider === "codex" ? "azure" : activeProvider,
			CODEX_ENABLED: codexEnabled,
			IMPLEMENTATION_RUNTIME_LANE:
				process.env.IMPLEMENTATION_RUNTIME_LANE ||
				(activeProvider === "codex" && codexEnabled ? "codex-sdk" : ""),
		};
	}),
}));

vi.mock("../../api/services/agent-runtime/registry", () => {
	const resolveAgentRuntime = vi.fn();
	const buildRuntimeLaneInitialTodos = vi.fn((lane: string) =>
		lane === "codex-sdk"
			? [
					{ title: "対象変更を確認して実装する", taskType: "implementation" },
					{
						title: "必要最小限の動作確認を行う",
						taskType: "focused_verification",
					},
				]
			: [
					{ title: "仕様と既存構成を確認する", taskType: "inspection" },
					{
						title: "対象画面の実装準備を行う",
						taskType: "scaffold",
						dependsOn: [1],
					},
					{
						title: "対象画面を仕様に沿って実装する",
						taskType: "implementation",
						dependsOn: [2],
					},
					{
						title: "受け入れ条件を検証する",
						taskType: "verification",
						dependsOn: [3],
					},
				],
	);
	return {
		buildRuntimeLaneInitialTodos,
		resolveAgentRuntime,
		resolveRuntimeLaneDefinition: vi.fn(
			(lane: "native-api-runner" | "codex-sdk") => ({
				kind: lane,
				aliases: [],
				buildInitialTodos: (input: { compiledPromptText: string }) =>
					buildRuntimeLaneInitialTodos(lane, input),
				buildRuntimeOptions: (input: {
					runtimeLaneResolution?: unknown;
					implementationLlmRoute?: { providerId?: string } | null;
				}) => {
					const nativeApiRoute =
						lane === "native-api-runner" &&
						Boolean(input.implementationLlmRoute) &&
						input.implementationLlmRoute?.providerId !== "codex";
					return {
						runtimeLane: lane,
						runtimeLaneResolution: input.runtimeLaneResolution ?? null,
						...(nativeApiRoute
							? {
									structuredLlmRoutePolicy: {
										disallowedProviderIds: ["codex"],
									},
								}
							: {}),
					};
				},
				createAdapter: () =>
					resolveAgentRuntime(
						lane === "codex-sdk" ? "codex-agent" : "native-local",
					),
			}),
		),
	};
});

vi.mock("../../api/services/conversation-context", () => ({
	buildPromptWithStateCard: vi.fn(
		(input: { latestUserMessage: string; stateCardText?: string | null }) => {
			const request = input.latestUserMessage.trim();
			const card = input.stateCardText?.trim();
			return card
				? `<USER_REQUEST>\n${request}\n</USER_REQUEST>\n\n${card}`
				: request;
		},
	),
	buildPromptWithStateCardParts: vi.fn(
		(input: { latestUserMessage: string; stateCardText?: string | null }) => {
			const request = input.latestUserMessage.trim();
			const card = input.stateCardText?.trim();
			const promptText = card
				? `<USER_REQUEST>\n${request}\n</USER_REQUEST>\n\n${card}`
				: request;
			return {
				latestUserMessage: request,
				stateCardText: card || null,
				promptText,
				estimates: {
					latestUserMessageTokens: Math.ceil(request.length / 4),
					stateCardTokens: card ? Math.ceil(card.length / 4) : 0,
					promptTokens: Math.ceil(promptText.length / 4),
				},
			};
		},
	),
	getLatestConversationContextForTask: vi.fn(),
	refreshConversationContextSnapshot: vi.fn(),
}));

describe("NightWorkers service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.ACTIVE_LLM_PROVIDER;
		delete process.env.CODEX_ENABLED;
		delete process.env.IMPLEMENTATION_RUNTIME_LANE;
		delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_RUNTIME_LANE = "native-api-runner";
		vi.mocked(repo.createRunEvent).mockResolvedValue({
			id: "event-default",
			seq: 1,
		} as never);
	});

	it("lists replay events for a run after the requested cursor", async () => {
		vi.mocked(repo.getTaskRun).mockResolvedValue({
			id: "run-replay",
			taskId: "task-replay",
		} as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([
			{
				id: "event-3",
				seq: 3,
				taskRunId: "run-replay",
				message: "after cursor",
			},
		] as never);

		const events = await listTaskRunEventsForReplay({
			taskId: "task-replay",
			runId: "run-replay",
			afterSeq: 2,
		});

		expect(events).toHaveLength(1);
		expect(repo.listTaskEventsForRun).toHaveBeenCalledWith("run-replay", {
			afterSeq: 2,
		});
	});

	it("creates a local folder under the selected parent directory", async () => {
		const folder = await createLocalFolder({
			parentPath: repoRoot,
			name: "new-project",
		});

		expect(folder).toEqual({
			name: "new-project",
			path: path.join(repoRoot, "new-project"),
		});
	});

	it("rejects nested folder names when creating a local folder", async () => {
		await expect(
			createLocalFolder({ parentPath: repoRoot, name: "../outside" }),
		).rejects.toMatchObject({
			code: "INVALID_FOLDER_NAME",
		});
	});

	it("applies the event cursor when listing run events", async () => {
		vi.mocked(repo.getTaskRun).mockResolvedValue({
			id: "run-detail",
			taskId: "task-detail",
			status: "running",
		} as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([
			{ id: "event-8", seq: 8, taskRunId: "run-detail", message: "new event" },
		] as never);

		const events = await listTaskRunEvents("run-detail", { afterSeq: 7 });

		expect(events).toHaveLength(1);
		expect(repo.listTaskEventsForRun).toHaveBeenCalledWith("run-detail", {
			afterSeq: 7,
		});
	});

	it("loads full run details without applying an event cursor", async () => {
		vi.mocked(repo.getTaskRun).mockResolvedValue({
			id: "run-detail",
			taskId: "task-detail",
			status: "running",
		} as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([
			{
				id: "event-1",
				seq: 1,
				taskRunId: "run-detail",
				message: "existing event",
			},
		] as never);

		const detail = await getTaskRunDetail("run-detail");

		expect(detail?.events).toHaveLength(1);
		expect(repo.listTaskEventsForRun).toHaveBeenCalledWith("run-detail");
	});

	it("rejects replay events when the run does not belong to the subscribed task", async () => {
		vi.mocked(repo.getTaskRun).mockResolvedValue({
			id: "run-replay",
			taskId: "other-task",
		} as never);

		await expect(
			listTaskRunEventsForReplay({
				taskId: "task-replay",
				runId: "run-replay",
				afterSeq: 2,
			}),
		).rejects.toMatchObject({ statusCode: 404 });
		expect(repo.listTaskEventsForRun).not.toHaveBeenCalled();
	});

	it("preserves policy stopped runtime results as policy_violation outcomes", async () => {
		const task = {
			id: "task-policy",
			repositoryId: "repo-policy",
			title: "Policy task",
			description: "Run a blocked command",
			objective: "Run a blocked command",
			acceptanceCriteria: "Policy block is preserved",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-policy",
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "running",
		};

		vi.mocked(repo.getTask).mockResolvedValue(task as never);
		vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
		vi.mocked(repo.getRepository).mockResolvedValue({
			id: task.repositoryId,
			localPath: repoRoot,
			safetyPolicy: { blockedCommands: ["rm"] },
		} as never);
		vi.mocked(repo.listTaskMessages).mockResolvedValue([
			{ role: "user", content: "Run a blocked command" },
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "needs_human",
			summary: "Stopped by policy block",
			finalReport: "Tool policy blocked execution.",
			stoppedBy: "policy",
			riskLevel: "high",
			diffPatch: "",
			logContent: "",
		});
		vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
			kind: "native-local",
			start: runtimeStart,
			stop: vi.fn(),
		} as never);

		await startTaskRun(task.id);
		expect(repo.createTaskRunTodo).not.toHaveBeenCalled();
		expect(repo.updateTaskRunTodo).not.toHaveBeenCalled();
		await vi.waitFor(() => {
			expect(runtimeStart).toHaveBeenCalledWith(
				expect.objectContaining({
					compiledPrompt: expect.stringContaining("Run a blocked command"),
					latestUserMessage: `${implementationPhasePreamble}\n\nRun a blocked command`,
				}),
				expect.anything(),
			);
		});
		await vi.waitFor(() => {
			expect(repo.updateTaskRun).toHaveBeenCalledWith(
				run.id,
				expect.objectContaining({
					status: "needs_human",
					finalReport: "Tool policy blocked execution.",
					finalJudgment: null,
				}),
			);
		});
		expect(repo.createRunEvent).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "run.outcome_decided" }),
			expect.anything(),
		);
		expect(repo.createTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				role: "assistant",
				content: "Tool policy blocked execution.",
				payloadJson: expect.objectContaining({
					finalReport: "Tool policy blocked execution.",
					status: "needs_human",
				}),
			}),
		);
	});

	it("marks running todos as needs_human when runtime stops for human review", async () => {
		const task = {
			id: "task-import-failed",
			repositoryId: "repo-import-failed",
			title: "Import project",
			description: "Create app",
			objective: "Create app",
			acceptanceCriteria: "Import failure is surfaced",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-import-failed",
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "running",
		};
		const runningTodo = {
			id: "todo-running",
			runId: run.id,
			seq: 1,
			title: "既存構成を確認する",
			description: "Import starter project",
			taskType: "implementation",
			status: "running",
		};
		const pendingTodo = {
			id: "todo-pending",
			runId: run.id,
			seq: 2,
			title: "実装する",
			description: "Implement feature",
			taskType: "implementation",
			status: "pending",
		};
		const humanRunningTodo = { ...runningTodo, status: "needs_human" };
		const humanPendingTodo = { ...pendingTodo, status: "needs_human" };

		vi.mocked(repo.getTask).mockResolvedValue(task as never);
		vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
		vi.mocked(repo.getRepository).mockResolvedValue({
			id: task.repositoryId,
			localPath: repoRoot,
		} as never);
		vi.mocked(repo.listTaskMessages).mockResolvedValue([
			{ role: "user", content: "Create app" },
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun)
			.mockResolvedValueOnce([runningTodo, pendingTodo] as never)
			.mockResolvedValueOnce([runningTodo, pendingTodo] as never)
			.mockResolvedValueOnce([runningTodo, pendingTodo] as never)
			.mockResolvedValueOnce([humanRunningTodo, pendingTodo] as never)
			.mockResolvedValueOnce([humanRunningTodo, humanPendingTodo] as never)
			.mockResolvedValue([humanRunningTodo, humanPendingTodo] as never);
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "needs_human",
			summary: "Import failed",
			finalReport: "Project import failed.",
			stoppedBy: "tool_failure",
			riskLevel: "high",
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
			expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
				"todo-running",
				expect.objectContaining({
					status: "needs_human",
					statusReason: "Project import failed.",
					completedAt: expect.any(Date),
					completionGateResult: expect.objectContaining({
						status: "needs_human",
						passed: false,
						todoId: "todo-running",
						todoSeq: 1,
						evidence: expect.objectContaining({
							terminalState: "needs_human",
							stoppedBy: "tool_failure",
						}),
					}),
				}),
				{ notifyTaskId: task.id, notifyRunId: run.id },
			);
		});
		expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
			"todo-pending",
			expect.objectContaining({
				status: "needs_human",
				statusReason:
					"Run requires human review before this Todo could start: Project import failed.",
				completedAt: expect.any(Date),
			}),
			{ notifyTaskId: task.id, notifyRunId: run.id },
		);
		expect(repo.updateTaskRunTodo).toHaveBeenCalledTimes(2);
		expect(repo.updateTaskRun).toHaveBeenCalledWith(
			run.id,
			expect.objectContaining({
				status: "needs_human",
				finalReport: "Project import failed.",
			}),
		);
	});

	it("creates role handoff and working context events before starting native runtime", async () => {
		process.env.IMPLEMENTATION_RUNTIME_LANE = "native-api-runner";
		const previousSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		const settingsPath = path.join(
			repoRoot,
			"llm-route-role-context-test.json",
		);
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = settingsPath;
		fs.writeFileSync(
			settingsPath,
			JSON.stringify({
				ACTIVE_LLM_PROVIDER: "azure",
				providerEndpoints: [
					{
						id: "local-implementation",
						name: "Local Implementation",
						kind: "local",
						enabled: true,
						baseUrl: "http://localhost:11434/v1",
						models: ["qwen3-coder"],
					},
				],
				roleRoutes: [
					{
						role: "implementation",
						primary: {
							providerEndpointId: "local-implementation",
							model: "qwen3-coder",
						},
						fallbacks: [],
					},
				],
			}),
		);

		const task = {
			id: "task-role-context",
			repositoryId: "repo-role-context",
			title: "Role context task",
			description: "Implement spec/role-owned-context-compaction-plan.md",
			objective: "Implement role context",
			acceptanceCriteria: "Role context is present",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-role-context",
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "running",
		};
		const runningTodo = {
			id: "todo-role-context",
			runId: run.id,
			seq: 1,
			title: "Role context を実装する",
			description: "Implement role context",
			taskType: "implementation",
			status: "running",
			procedureId: "context.role",
		};
		let eventSeq = 10;
		vi.mocked(repo.createRunEvent).mockImplementation(async (event) => {
			eventSeq += 1;
			return {
				id: `event-${eventSeq}`,
				seq: eventSeq,
				payloadJson: { runEvent: event },
			} as never;
		});
		vi.mocked(repo.getTask).mockResolvedValue(task as never);
		vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
		vi.mocked(repo.getRepository).mockResolvedValue({
			id: task.repositoryId,
			localPath: repoRoot,
			safetyPolicy: {},
		} as never);
		vi.mocked(repo.listTaskMessages).mockResolvedValue([
			{
				id: "message-role-context",
				role: "user",
				content: "Implement spec/role-owned-context-compaction-plan.md",
			},
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([
			runningTodo,
		] as never);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "completed",
			summary: "done",
			finalReport: "done",
			stoppedBy: "decision",
			riskLevel: "medium",
			diffPatch: "",
			logContent: "",
		});
		vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
			kind: "native-local",
			start: runtimeStart,
			stop: vi.fn(),
		} as never);

		try {
			await startTaskRun(task.id);

			expect(repo.createRunEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "context.handoff_created",
					actor: "runtime",
					data: expect.objectContaining({
						artifact: expect.objectContaining({
							runId: run.id,
							taskId: task.id,
							currentTodo: expect.objectContaining({ id: runningTodo.id }),
							designReferences: expect.arrayContaining([
								expect.objectContaining({
									path: "spec/role-owned-context-compaction-plan.md",
								}),
							]),
						}),
					}),
				}),
			);
			expect(repo.createRunEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "context.working_context_created",
					actor: "runtime",
					data: expect.objectContaining({
						artifact: expect.objectContaining({
							currentTodo: expect.objectContaining({ id: runningTodo.id }),
							source: "deterministic",
						}),
					}),
				}),
			);
			expect(repo.updateTaskRun).toHaveBeenCalledWith(
				run.id,
				expect.objectContaining({
					status: "running",
					contextSnapshot: expect.objectContaining({
						roleContext: expect.objectContaining({
							source: "deterministic",
							handoff: expect.objectContaining({
								eventSeq: expect.any(Number),
							}),
							workingContext: expect.objectContaining({
								eventSeq: expect.any(Number),
								renderedText: expect.stringContaining(
									'<ROLE_WORKING_CONTEXT version="1"',
								),
							}),
						}),
					}),
				}),
			);
			await vi.waitFor(() => {
				expect(runtimeStart).toHaveBeenCalledWith(
					expect.objectContaining({
						contextSnapshot: expect.objectContaining({
							roleContext: expect.objectContaining({
								workingContext: expect.objectContaining({
									renderedText: expect.stringContaining(
										"designReference path=spec/role-owned-context-compaction-plan.md",
									),
								}),
							}),
						}),
					}),
					expect.anything(),
				);
			});
		} finally {
			if (previousSettingsPath === undefined) {
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			} else {
				process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = previousSettingsPath;
			}
			try {
				fs.unlinkSync(settingsPath);
			} catch {}
		}
	});

	it("does not create role context events for codex-sdk runs", async () => {
		process.env.NIGHTWORKERS_RUNTIME_LANE = "codex-agent";
		const previousSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		const settingsPath = path.join(
			repoRoot,
			"llm-route-codex-role-context.json",
		);
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = settingsPath;
		fs.writeFileSync(
			settingsPath,
			JSON.stringify({
				ACTIVE_LLM_PROVIDER: "codex",
				CODEX_ENABLED: true,
				providerEndpoints: [
					{
						id: "codex-implementation",
						name: "Codex Implementation",
						kind: "codex",
						enabled: true,
						models: ["gpt-5.4-mini"],
					},
				],
				roleRoutes: [
					{
						role: "implementation",
						primary: {
							providerEndpointId: "codex-implementation",
							model: "gpt-5.4-mini",
						},
						fallbacks: [],
					},
				],
			}),
		);
		const task = {
			id: "task-codex-role-context",
			repositoryId: "repo-codex-role-context",
			title: "Codex role context task",
			description: "Use Codex SDK lane",
			objective: "Use Codex SDK lane",
			acceptanceCriteria: "Codex SDK starts",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-codex-role-context",
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
				id: "message-codex-role-context",
				role: "user",
				content: "Use Codex SDK lane",
			},
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "completed",
			summary: "codex done",
			finalReport: "codex done",
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

		try {
			await startTaskRun(task.id);
		} finally {
			if (previousSettingsPath === undefined) {
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			} else {
				process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = previousSettingsPath;
			}
		}

		expect(repo.createRunEvent).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "context.handoff_created" }),
		);
		expect(repo.createRunEvent).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "context.working_context_created" }),
		);
		expect(repo.updateTaskRun).toHaveBeenCalledWith(
			run.id,
			expect.objectContaining({
				status: "running",
				contextSnapshot: expect.not.objectContaining({
					roleContext: expect.anything(),
				}),
			}),
		);
		await vi.waitFor(() => {
			expect(runtimeStart).toHaveBeenCalledWith(
				expect.objectContaining({
					runtimeOptions: expect.objectContaining({ runtimeLane: "codex-sdk" }),
					contextSnapshot: expect.not.objectContaining({
						roleContext: expect.anything(),
					}),
				}),
				expect.anything(),
			);
		});
	});

	it("uses the native-api-runner runtime lane for non-Codex implementation routes", async () => {
		process.env.NIGHTWORKERS_RUNTIME_LANE = "codex-agent";
		const previousSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		const settingsPath = path.join(
			repoRoot,
			"llm-route-non-codex-implementation.json",
		);
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = settingsPath;
		fs.writeFileSync(
			settingsPath,
			JSON.stringify({
				ACTIVE_LLM_PROVIDER: "azure",
				providerEndpoints: [
					{
						id: "local-implementation",
						name: "Local Implementation",
						kind: "local",
						enabled: true,
						baseUrl: "http://localhost:11434/v1",
						models: ["qwen3-coder"],
					},
				],
				roleRoutes: [
					{
						role: "implementation",
						primary: {
							providerEndpointId: "local-implementation",
							model: "qwen3-coder",
						},
						fallbacks: [],
					},
				],
			}),
		);
		const task = {
			id: "task-codex-lane",
			repositoryId: "repo-codex-lane",
			title: "Codex lane task",
			description: "Use Codex lane",
			objective: "Use Codex lane",
			acceptanceCriteria: "Codex lane starts",
			timeoutSeconds: 60,
		};
		const run = {
			id: "run-codex-lane",
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
			{ role: "user", content: "Use Codex lane" },
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "completed",
			summary: "Native done",
			finalReport: "Native done",
			stoppedBy: "decision",
			riskLevel: "medium",
			diffPatch: "",
			logContent: "",
		});
		vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
			kind: "native-local",
			start: runtimeStart,
			stop: vi.fn(),
		} as never);

		try {
			await startTaskRun(task.id);
		} finally {
			if (previousSettingsPath === undefined) {
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			} else {
				process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = previousSettingsPath;
			}
		}

		expect(repo.createTaskRun).toHaveBeenCalledWith(
			expect.objectContaining({
				workerKind: "native-local",
				contextSnapshot: expect.objectContaining({
					runtimeLane: "native-api-runner",
					runtimeLaneResolution: expect.objectContaining({
						workerKind: "native-local",
						source: "role_route",
						diagnostics: expect.arrayContaining([
							expect.objectContaining({
								message: expect.stringContaining(
									"Native/API implementation uses native-api-runner for this run",
								),
							}),
						]),
					}),
				}),
			}),
		);
		const todos =
			vi.mocked(repo.replaceTaskRunTodosForRun).mock.calls[0]?.[1] || [];
		expect(todos).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: "initial_instructions を実行する",
					status: "running",
				}),
				expect.objectContaining({
					title: "context_compile を実行する",
				}),
				expect.objectContaining({
					title: "仕様と既存構成を確認する",
					taskType: "inspection",
				}),
				expect.objectContaining({
					title: "品質ゲート verify コマンドを通す",
					taskType: "verification",
				}),
			]),
		);
		expect(todos).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: "対象変更を確認して実装する",
				}),
			]),
		);
		expect(runtimeRegistry.resolveAgentRuntime).toHaveBeenCalledWith(
			"native-local",
		);
		await vi.waitFor(() => {
			expect(runtimeStart).toHaveBeenCalledWith(
				expect.objectContaining({
					runtimeOptions: expect.objectContaining({
						runtimeLane: "native-api-runner",
						structuredLlmRoutePolicy: {
							disallowedProviderIds: ["codex"],
						},
					}),
				}),
				expect.anything(),
			);
		});
	});

	describe("archiveTask", () => {
		it("throws NotFoundError if task does not exist", async () => {
			vi.mocked(repo.getTask).mockResolvedValueOnce(null);
			await expect(archiveTask("invalid-id")).rejects.toThrow("Task not found");
		});

		it("returns task immediately if already completed, cancelled or failed", async () => {
			const completedTask = { id: "t1", status: "completed" } as RepoTask;
			vi.mocked(repo.getTask).mockResolvedValueOnce(completedTask);
			const result = await archiveTask("t1");
			expect(result).toBe(completedTask);
		});

		it("updates task status to cancelled", async () => {
			const activeTask = { id: "t1", status: "running" } as RepoTask;
			const archivedTask = { id: "t1", status: "cancelled" } as RepoTask;
			vi.mocked(repo.getTask).mockResolvedValueOnce(activeTask);
			vi.mocked(repo.updateTask).mockResolvedValueOnce(archivedTask);
			const result = await archiveTask("t1");
			expect(result.status).toBe("cancelled");
			expect(repo.updateTask).toHaveBeenCalledWith("t1", {
				status: "cancelled",
			});
		});
	});

	describe("deleteTask", () => {
		it("deletes a task from repository", async () => {
			vi.mocked(repo.deleteTask).mockResolvedValueOnce({
				id: "t1",
			} as DeletedTask);
			const result = await deleteTask("t1");
			expect(result).toEqual({ id: "t1" });
			expect(repo.deleteTask).toHaveBeenCalledWith("t1");
		});
	});

	describe("createWorkbenchSession", () => {
		it("creates task session with defaults", async () => {
			const dummySession = {
				id: "s1",
				title: "New Session",
			} as Awaited<ReturnType<typeof repo.createTask>>;
			vi.mocked(repo.createTask).mockResolvedValueOnce(dummySession);
			const result = await createWorkbenchSession({
				repositoryId: "repo-1",
			});
			expect(result).toBe(dummySession);
			expect(repo.createTask).toHaveBeenCalledWith(
				expect.objectContaining({
					repositoryId: "repo-1",
					title: "New Session",
				}),
			);
		});
	});
});
