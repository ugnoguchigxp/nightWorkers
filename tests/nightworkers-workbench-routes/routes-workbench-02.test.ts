import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import app from "../../api/app";
import { ensureNightWorkersSchema } from "../../api/db/bootstrap";
import { db } from "../../api/db/client";
import {
	agentModeSessions,
	implementationQueueEntries,
	taskGitWorkspaces,
	taskRunTodos,
	tasks,
} from "../../api/db/schema";
import {
	claimCodingAgentRunExecution,
	reconcileCodingAgentProcessInterruptions,
} from "../../api/modules/codingAgent";
import { runGitCommand } from "../../api/modules/gitworktree/gitworktree-cli";
import { ensureTaskGitWorkspace } from "../../api/modules/gitworktree/task-git-workspace.service";
import { attestTaskWorkspaceForRun } from "../../api/modules/gitworktree/workspace-attestation.service";
import * as repo from "../../api/modules/nightworkers/nightworkers.repository";
import * as queueRepo from "../../api/modules/queue/queue.repository";
import * as llm from "../../api/services/structured-llm";
import { representativeMockBlueprint } from "../fixtures/mock-blueprint";
import { flushPendingWorkbenchTasks } from "../helpers/nightworkers-test-controls";
import {
	cleanupDisposableRepositories,
	createWorkbenchTask,
} from "./workbench-route-test-support";

vi.setConfig({ testTimeout: 40_000 });

vi.mock("../../api/services/structured-llm", async () => {
	const actual = await vi.importActual<
		typeof import("../../api/services/structured-llm")
	>("../../api/services/structured-llm");
	const { createStructuredLlmResultMock } = await import(
		"../helpers/structured-llm-result-mock"
	);
	const callStructuredJsonLLM = vi.fn();
	return {
		...actual,
		callSupervisorLLM: vi.fn(),
		callStructuredJsonLLM,
		callStructuredLlmResult: vi.fn(
			createStructuredLlmResultMock(callStructuredJsonLLM),
		),
	};
});

vi.mock("../../api/modules/gitworktree/workspace-bootstrap", async () => {
	const actual = await vi.importActual<
		typeof import("../../api/modules/gitworktree/workspace-bootstrap")
	>("../../api/modules/gitworktree/workspace-bootstrap");
	return {
		...actual,
		runWorkspaceDependencyBootstrap: vi.fn(async () => ({
			version: 1 as const,
			status: "not_required" as const,
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			components: [],
		})),
	};
});

vi.mock("../../api/modules/codingAgent/runtime/registry", () => {
	const runtime = {
		kind: "native-local",
		start: vi.fn(async () => ({
			terminalState: "completed",
			summary: "Runtime completed.",
			finalReport: "Runtime completed.",
			stoppedBy: "decision",
			riskLevel: "low",
			diffPatch: "",
			logContent: "",
		})),
		stop: vi.fn(),
		suspendForHostShutdown: vi.fn(),
	};
	const resolveAgentRuntime = vi.fn(() => runtime);
	const buildRuntimeLaneInitialTodos = vi.fn(
		(lane: string, input?: { executionMode?: string }) =>
			input?.executionMode === "general_answer"
				? []
				: lane === "codex-sdk"
					? [
							{
								title: "対象変更を確認して実装する",
								taskType: "implementation",
							},
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
				buildInitialTodos: (input: {
					compiledPromptText: string;
					executionMode?: string;
				}) => buildRuntimeLaneInitialTodos(lane, input),
				buildRuntimeOptions: (input: { runtimeLaneResolution?: unknown }) => ({
					runtimeLane: lane,
					runtimeLaneResolution: input.runtimeLaneResolution ?? null,
				}),
				createAdapter: () =>
					resolveAgentRuntime(
						lane === "codex-sdk" ? "codex-agent" : "native-local",
					),
			}),
		),
	};
});

const sameOriginHeaders = { Origin: "http://localhost:39174" };

function mockPlanModeGate(
	shouldStartPlanMode: boolean,
	reason = "test gate",
	action: "plan_mode" | "coding_agent" = shouldStartPlanMode
		? "plan_mode"
		: "coding_agent",
) {
	return JSON.stringify({
		shouldStartPlanMode,
		action,
		runDisposition: shouldStartPlanMode ? null : "start_new_run",
		reason,
	});
}

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

beforeEach(() => {
	vi.mocked(llm.callStructuredJsonLLM).mockResolvedValue(
		mockPlanModeGate(false),
	);
});

afterEach(async () => {
	await flushPendingWorkbenchTasks();
	vi.clearAllMocks();
	await cleanupDisposableRepositories();
});

describe("NightWorkers workbench routes", () => {
	it("returns immediately when workbench intake is not explicitly awaited", async () => {
		vi.mocked(llm.callStructuredJsonLLM).mockImplementationOnce(
			() => new Promise(() => {}),
		);
		const { task } = await createWorkbenchTask({
			title: "New Session",
			objective: "",
		});

		const startedAt = Date.now();
		const res = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt: "同期で待たずに受付してください",
					waitForIntake: false,
				}),
			},
		);

		expect(res.status, await res.clone().text()).toBe(200);
		const body = await res.json();
		expect(Date.now() - startedAt).toBeLessThan(500);
		expect(body.run).toBeNull();
		expect(
			body.messages.some((message: unknown) => message.role === "user"),
		).toBe(true);
		expect(
			body.messages.some((message: unknown) => message.role === "assistant"),
		).toBe(false);
		expect(body.task.objective).toBe("同期で待たずに受付してください");
	});

	it("opens Plan Mode and creates a Questionnaire without starting Coding Agent", async () => {
		vi.mocked(llm.callStructuredJsonLLM)
			.mockResolvedValueOnce(mockPlanModeGate(true, "設計が必要です"))
			.mockResolvedValueOnce(
				JSON.stringify({
					title: "認可つきAPIの実装前確認",
					questions: [
						{
							text: "APIの利用者と権限境界をどれにしますか？",
							kind: "design_decision",
							type: "radio",
							options: ["本人のデータだけ", "管理者が全件操作", "公開API"],
						},
					],
				}),
			);
		const { task } = await createWorkbenchTask({
			title: "New Session",
			objective: "",
		});

		const res = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt: "認可つきAPIの実装計画を設計してください",
				}),
			},
		);

		expect(res.status, await res.clone().text()).toBe(200);
		const body = await res.json();
		expect(body.run).toBeNull();
		expect(body.task.status).toBe("ready");
		expect(
			body.messages.some(
				(message: unknown) =>
					message.metadataJson?.intent === "design_questionnaire_ready",
			),
		).toBe(true);
		expect(
			body.messages.some(
				(message: unknown) =>
					message.metadataJson?.intent === "design_questionnaire_starting",
			),
		).toBe(true);
		expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
		expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(3);
	});

	it("starts a normal run for Blueprint wording instead of classifying jobType in intake", async () => {
		const { task } = await createWorkbenchTask({
			title: "New Session",
			objective: "",
		});

		const res = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt: "ECサイトのトップページをBlueprintで作って見てください",
				}),
			},
		);

		expect(res.status, await res.clone().text()).toBe(200);
		const body = await res.json();
		expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
		expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
		expect(
			vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[2]?.schemaName,
		).toBe("workbench_plan_mode_gate");
		expect(body.run).toMatchObject({ taskId: task.id, status: "running" });
		expect(
			body.messages.some(
				(message: unknown) => message.metadataJson?.intent === "app_blueprint",
			),
		).toBe(false);
		expect(
			body.messages.some(
				(message: unknown) => message.metadataJson?.intent === "intake",
			),
		).toBe(false);
	});

	it("routes a continuation request to the same interrupted Run and Todo", async () => {
		const fixture = await createInterruptedWorkbenchRun();
		vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
			JSON.stringify({
				shouldStartPlanMode: false,
				action: "coding_agent",
				runDisposition: "resume_existing_run",
				reason: "保存済みの中断Runと同じ作業を継続する依頼です。",
			}),
		);

		const res = await app.request(
			`http://localhost/api/workbench/sessions/${fixture.task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({ prompt: "再開してください" }),
			},
		);

		expect(res.status, await res.clone().text()).toBe(200);
		const body = await res.json();
		expect(body.run).toMatchObject({
			id: fixture.run.id,
			taskId: fixture.task.id,
			agentModeSessionId: fixture.session.id,
		});
		const runs = await repo.listTaskRunsForTask(fixture.task.id);
		expect(runs.map((run) => run.id)).toEqual([fixture.run.id]);
		const gatePrompt = vi.mocked(llm.callStructuredJsonLLM).mock
			.calls[0]?.[1] as string;
		expect(gatePrompt).toContain("structurally resumable=true");
		expect(gatePrompt).toContain("currentTodo=resume-route-todo");
		expect(gatePrompt).not.toContain(fixture.run.id);
		expect(
			body.messages.some(
				(message: unknown) => message.metadataJson?.intent === "run_resumed",
			),
		).toBe(true);
	});

	it("does not auto-generate Blueprint artifacts from active Blueprint workspace instructions", async () => {
		const { task } = await createWorkbenchTask({
			title: "todo listを作りたいです。",
		});

		const res = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt:
						"駄目ですね。TODO登録と、一覧があればそれだけで十分だと思いますが。余計なセクション追加しなくていいです",
					artifactContext: {
						artifactId: `plan-mode-workspace-${task.id}`,
						kind: "plan_mode_workspace",
						title: "Plan Mode Workspace",
						summary:
							"Design Questionnaire を生成しました。10 件の質問に回答できます。",
						source: { type: "task_message", messageId: crypto.randomUUID() },
						metadata: {
							initialTab: "questionnaire",
						},
					},
				}),
			},
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
		expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
		expect(body.run).toMatchObject({ taskId: task.id, status: "running" });
		expect(
			body.messages.some(
				(message: unknown) => message.metadataJson?.intent === "app_blueprint",
			),
		).toBe(false);
		expect(
			body.messages.some(
				(message: unknown) =>
					message.metadataJson?.intent === "design_questionnaire_ready",
			),
		).toBe(false);
	});

	it("regenerates the active Blueprint tab from composer instructions without round-1 intake", async () => {
		vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
			JSON.stringify(representativeMockBlueprint),
		);
		const { task } = await createWorkbenchTask({
			title: "todo listを作りたいです。",
		});
		const previousBlueprintMessage = await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# Previous Blueprint\n- extra dashboard sections",
			messageType: "markdown_document",
			payloadJson: {
				intent: "mock_blueprint",
				artifactType: "mock_blueprint",
			},
		});
		const prompt =
			"駄目ですね。TODO登録と、一覧があればそれだけで十分だと思いますが。余計なセクション追加しなくていいです";

		const res = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt,
					providerEndpointId: "local-qwen",
					model: "qwen3-coder",
					thinkingDepth: "high",
					artifactContext: {
						artifactId: `plan-mode-workspace-${task.id}:blueprint`,
						kind: "plan_mode_workspace",
						title: "Blueprint",
						summary: "Previous Blueprint summary",
						source: {
							type: "task_message",
							messageId: previousBlueprintMessage.id,
						},
						metadata: {
							intent: "plan_mode_artifact_regeneration",
							artifactType: "blueprint",
							initialTab: "blueprint",
							instructionMode: "regenerate_artifact",
							planModeTarget: "blueprint",
							displayKind: "PLAN_MODE:BLUEPRINT",
							questionnaireSessionId: null,
							featurePlanMessageId: null,
							sourceBlueprintMessageId: previousBlueprintMessage.id,
						},
					},
				}),
			},
		);

		expect(res.status, await res.clone().text()).toBe(200);
		const body = await res.json();
		expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
		expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
		expect(
			vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[2]?.schemaName,
		).toBe("mock_blueprint");
		expect(
			vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[2]?.routeOverride,
		).toEqual({
			providerEndpointId: "local-qwen",
			model: "qwen3-coder",
			thinkingDepth: "high",
		});
		const blueprintPrompt = vi.mocked(llm.callStructuredJsonLLM).mock
			.calls[0]?.[1] as string;
		expect(blueprintPrompt).toContain("## Regeneration Request");
		expect(blueprintPrompt).toContain(prompt);
		expect(blueprintPrompt).toContain("### previous_target");
		expect(blueprintPrompt).toContain("extra dashboard sections");
		expect(body.run).toBeNull();
		expect(body.workspace?.blueprintArtifacts?.length).toBeGreaterThan(0);
		expect(
			body.messages.some(
				(message: unknown) => message.metadataJson?.intent === "mock_blueprint",
			),
		).toBe(true);
		expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
	});

	it("keeps feature_plan messages as draft chat without Blueprint generation", async () => {
		const { task } = await createWorkbenchTask();

		const draftRes = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt: "チャット中心の作業台を仕様にして",
					intent: "feature_plan",
				}),
			},
		);

		expect(draftRes.status).toBe(200);
		const draftBody = await draftRes.json();
		expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
		expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
		expect(draftBody.task.status).toBe("draft");
		expect(draftBody.run).toBeNull();
		expect(
			draftBody.messages.some(
				(message: unknown) => message.messageType === "markdown_document",
			),
		).toBe(false);
		expect(
			draftBody.messages.some(
				(message: unknown) => message.metadataJson?.intent === "app_blueprint",
			),
		).toBe(false);
	});

	it("does not treat markdown titles as implementation plan evidence for queue admission", async () => {
		const { task } = await createWorkbenchTask();
		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# Implementation Plan",
			messageType: "markdown_document",
			metadataJson: {
				title: "Implementation Plan",
			},
		});

		const queueRes = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/queue`,
			{
				method: "POST",
				headers: sameOriginHeaders,
			},
		);

		expect(queueRes.status).toBe(422);
		const body = await queueRes.json();
		expect(body.error.code).toBe("IMPLEMENTATION_PLAN_REQUIRED");
		expect((await repo.getTask(task.id))?.status).toBe("draft");
	});

	it("admits ready sessions to the Implementation Queue without duplicating not-queued work", async () => {
		await repo.updateImplementationQueueSettings({ processorCount: 1 });
		const { task: blockerTask } = await createWorkbenchTask({
			title: "Processor blocker",
			status: "queued",
		});
		const blockerEntry = await repo.createImplementationQueueEntry({
			taskId: blockerTask.id,
			repositoryId: blockerTask.repositoryId,
		});
		await repo.updateImplementationQueueEntry(blockerEntry.id, {
			status: "claimed",
			processorSlot: 1,
		});
		const { task } = await createWorkbenchTask({ status: "ready" });

		const res = await app.request(
			"http://localhost/api/implementation-queue/entries",
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({ taskId: task.id }),
			},
		);

		expect(res.status).toBe(201);
		const entry = await res.json();
		expect(entry).toMatchObject({ taskId: task.id, status: "queued" });
		expect((await repo.getTask(task.id))?.status).toBe("queued");

		const dashboardRes = await app.request(
			"http://localhost/api/implementation-queue",
			{
				headers: sameOriginHeaders,
			},
		);
		expect(dashboardRes.status).toBe(200);
		const dashboard = await dashboardRes.json();
		expect(
			dashboard.queued.map((queueEntry: unknown) => queueEntry.task.id),
		).toContain(task.id);
		expect(
			dashboard.notQueued.map((item: unknown) => item.task.id),
		).not.toContain(task.id);

		const duplicateRes = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/queue`,
			{
				method: "POST",
				headers: sameOriginHeaders,
			},
		);
		expect(duplicateRes.status).toBe(409);
		expect((await duplicateRes.json()).error.code).toBe("QUEUE_ENTRY_EXISTS");
	});
});

async function createInterruptedWorkbenchRun() {
	const { project, task } = await createWorkbenchTask({
		title: "TEST: restart route",
		status: "running",
	});
	const allocated = await ensureTaskGitWorkspace({
		taskId: task.id,
		planReviewId: null,
		admissionKey: `test:restart-route:${task.id}`,
	});
	const head = await runGitCommand([
		"-C",
		project.localPath,
		"rev-parse",
		"HEAD",
	]);
	await db
		.update(taskGitWorkspaces)
		.set({
			status: "active",
			sourceBranch: "main",
			sourceRef: "refs/heads/main",
			worktreePath: project.localPath,
			taskWorktreePathCanonical: project.localPath,
			expectedHeadSha: head.stdout.trim(),
			lastVerifiedHead: head.stdout.trim(),
			initializedAt: new Date(),
		})
		.where(eq(taskGitWorkspaces.id, allocated.id));
	await db
		.update(tasks)
		.set({ worktreePath: project.localPath, updatedAt: new Date() })
		.where(eq(tasks.id, task.id));
	const workspaceAdmission = await attestTaskWorkspaceForRun({
		taskId: task.id,
		requireClean: false,
		allowCurrentDirtyState: true,
	});
	const [session] = await db
		.insert(agentModeSessions)
		.values({
			taskId: task.id,
			repositoryId: project.id,
			epoch: 1,
			executionMode: "implementation",
			llmRole: "implementation",
			runtimeLane: "codex-sdk",
			provider: "codex",
			model: "gpt-test",
			routeFingerprint: "workbench-restart-route",
			status: "active",
			openedAt: new Date(),
		})
		.returning();
	if (!session) throw new Error("Agent Mode Session fixture was not created.");
	const run = await repo.createTaskRun({
		taskId: task.id,
		repositoryId: project.id,
		taskRevisionSnapshotId: task.currentRevisionSnapshotId,
		taskRevision: task.revision,
		agentModeSessionId: session.id,
		status: "running",
		workerKind: "codex-agent",
		worktreePath: project.localPath,
		workspaceAuthorityKind: "task_workspace",
		workspaceId: workspaceAdmission.workspace.id,
		workspaceAllocationVersion: workspaceAdmission.workspace.allocationVersion,
		repositoryIdentityRevision:
			workspaceAdmission.workspace.repositoryIdentityRevision,
		admissionAttestationId: workspaceAdmission.attestation.id,
		admissionAttestationDigest: workspaceAdmission.attestation.digest,
		admittedHeadSha: workspaceAdmission.attestation.headSha,
		contextSnapshot: { executionMode: "implementation" },
	});
	if (!run) throw new Error("Run fixture was not created.");
	const currentStatus = await runGitCommand([
		"-C",
		project.localPath,
		"status",
		"--porcelain=v1",
		"--untracked-files=normal",
	]);
	const ownedCandidatePaths = currentStatus.stdout
		.split("\n")
		.map((value) => value.slice(3).trim())
		.filter(Boolean);
	await repo.createTaskRunCommitRecord({
		runId: run.id,
		repositoryId: project.id,
		status: "pending",
		baselineHead: head.stdout.trim(),
		ownedCandidatePaths,
	});
	const [todo] = await db
		.insert(taskRunTodos)
		.values({
			runId: run.id,
			todoKey: "resume-route-todo",
			seq: 1,
			title: "中断箇所から検証を続ける",
			nextAction: "保存済み状態を確認する",
			taskType: "verification",
			status: "running",
			createdBy: "agent",
			revision: 2,
			startedAt: new Date(),
		})
		.returning();
	if (!todo) throw new Error("Todo fixture was not created.");
	const queue = await queueRepo.createImplementationQueueEntry({
		taskId: task.id,
		repositoryId: project.id,
	});
	await db
		.update(implementationQueueEntries)
		.set({
			status: "processing",
			activeRunId: run.id,
			workspaceId: workspaceAdmission.workspace.id,
			workspaceRequired: true,
			claimReady: true,
			processorSlot: 1,
			leaseOwnerId: "api-process:old",
			leaseAcquiredAt: new Date(),
			leaseExpiresAt: new Date(Date.now() + 60_000),
		})
		.where(eq(implementationQueueEntries.id, queue.id));
	await claimCodingAgentRunExecution({
		runId: run.id,
		agentModeSessionId: session.id,
		owner: {
			kind: "api_process",
			instanceId: "api_process:workbench-old-boot",
			pid: 101,
		},
	});
	await reconcileCodingAgentProcessInterruptions({
		owner: {
			kind: "api_process",
			instanceId: "api_process:workbench-new-boot",
			pid: 202,
		},
	});
	return { project, task, session, run, todo, queue };
}
