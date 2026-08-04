import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
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
	missionPilotSessions,
	missionPilotTaskEventInbox,
} from "../../api/modules/missionPilot/persistence";
import * as repo from "../../api/modules/nightworkers/nightworkers.repository";
import * as service from "../../api/modules/nightworkers/nightworkers.service";
import { registerTaskMessageCreatedListener } from "../../api/modules/task";
import * as llm from "../../api/services/structured-llm";
import { representativeAppBlueprint } from "../fixtures/app-blueprint";
import { flushPendingWorkbenchTasks } from "../helpers/nightworkers-test-controls";
import {
	cleanupDisposableRepositories,
	createDisposableRepository,
	createWorkbenchTask,
	sameOriginHeaders,
	trackDisposableRepositoryRoot,
	waitForTerminalRun,
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

function _expectStrictObjectSchemas(schema: unknown, path = "schema") {
	if (!schema || typeof schema !== "object") return;
	const node = schema as Record<string, unknown>;
	if (node.type === "object") {
		expect(node.additionalProperties, `${path}.additionalProperties`).toBe(
			false,
		);
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === "properties" && value && typeof value === "object") {
			for (const [propertyName, propertySchema] of Object.entries(value)) {
				_expectStrictObjectSchemas(
					propertySchema,
					`${path}.properties.${propertyName}`,
				);
			}
			continue;
		}
		if (key === "items") {
			_expectStrictObjectSchemas(value, `${path}.items`);
			continue;
		}
		if (
			(key === "anyOf" || key === "oneOf" || key === "allOf") &&
			Array.isArray(value)
		) {
			value.forEach((item, index) => {
				_expectStrictObjectSchemas(item, `${path}.${key}.${index}`);
			});
		}
	}
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
	it("starts the standalone Plan Mode Artifact without a Mission Pilot session", async () => {
		vi.mocked(llm.callStructuredJsonLLM)
			.mockResolvedValueOnce(
				mockPlanModeGate(true, "explicit planning request"),
			)
			.mockResolvedValueOnce(
				JSON.stringify({
					title: "Normal Plan Questionnaire",
					questions: [
						{
							text: "Which boundary should be fixed first?",
							kind: "design_decision",
							type: "radio",
							options: [
								{ label: "API", recommended: true },
								{ label: "UI", recommended: false },
							],
						},
					],
				}),
			);
		const project = await repo.createRepository({
			name: `TEST: Stopped Mission Pilot ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const createResponse = await app.request(
			"http://localhost/api/workbench/sessions",
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({ repositoryId: project.id }),
			},
		);
		expect(createResponse.status, await createResponse.clone().text()).toBe(
			201,
		);
		const task = await createResponse.json();
		expect(task).not.toHaveProperty("missionPilot");
		expect(
			await db
				.select({ id: missionPilotSessions.id })
				.from(missionPilotSessions)
				.where(eq(missionPilotSessions.taskId, task.id)),
		).toHaveLength(0);
		const unregister = registerTaskMessageCreatedListener((message) => {
			if (message.role === "user")
				throw new Error("sidecar listener must not fail normal intake");
		});

		const response = await (async () => {
			try {
				return await app.request(
					`http://localhost/api/workbench/sessions/${task.id}/messages`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							...sameOriginHeaders,
						},
						body: JSON.stringify({
							prompt: "通常のPlan Modeで実装計画を作成してください",
							waitForIntake: true,
						}),
					},
				);
			} finally {
				unregister();
			}
		})();

		expect(response.status, await response.clone().text()).toBe(200);
		const body = await response.json();
		expect(body.run).toBeNull();
		expect(body.task.status).toBe("ready");
		expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(2);
		expect(
			vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[2],
		).toMatchObject({
			schemaName: "workbench_plan_mode_gate",
			role: "evaluation",
		});
		expect(
			vi.mocked(llm.callStructuredJsonLLM).mock.calls[1]?.[2],
		).toMatchObject({ schemaName: "design_questionnaire", role: "plan" });
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
	});

	it("starts the normal Coding Agent without a Mission Pilot session or envelope", async () => {
		const project = await repo.createRepository({
			name: `TEST: Normal Coding Agent ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: project.id,
			title: "Standalone Coding Agent",
			objective: "通常の Coding Agent で変更を実装する",
			acceptanceCriteria: "Mission Pilot session なしで Run が開始する",
			status: "draft",
		});
		expect(
			await db
				.select({ id: missionPilotSessions.id })
				.from(missionPilotSessions)
				.where(eq(missionPilotSessions.taskId, task.id)),
		).toHaveLength(0);

		const response = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt: "通常のCoding Agentでこの変更を実装してください",
					waitForIntake: true,
				}),
			},
		);

		expect(response.status, await response.clone().text()).toBe(200);
		const body = await response.json();
		expect(body.run).toMatchObject({
			taskId: task.id,
			contextSnapshot: {
				executionMode: "implementation",
				planModeRequested: false,
				planModeClosed: true,
				effectiveLlmRouting: { activeRole: "implementation" },
			},
		});
		expect(body.run.contextSnapshot).not.toHaveProperty("missionPilot");
		expect(body.run.contextSnapshot).toHaveProperty(
			"implementationPhasePreamble",
		);
		expect(
			vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[2],
		).toMatchObject({
			schemaName: "workbench_plan_mode_gate",
			role: "evaluation",
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(
			await db
				.select()
				.from(missionPilotTaskEventInbox)
				.where(eq(missionPilotTaskEventInbox.taskId, task.id)),
		).toHaveLength(0);
	});

	it("requires an assigned Task workspace for a Review Codex prompt", async () => {
		const { task } = await createWorkbenchTask({ status: "ready" });
		vi.mocked(llm.callStructuredJsonLLM).mockClear();
		const prompt =
			"現在のTask専用worktreeでgit statusとgit diffを自分で確認し、未追跡ファイルも含めてレビュー対象を判断してコードレビューをしてください。指摘事項があれば修正して検証してください。";

		const response = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt,
					intent: "review_prompt",
				}),
			},
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			code: "workspace_binding_required",
		});
		expect(llm.callStructuredJsonLLM).not.toHaveBeenCalled();
	});

	it("starts a minimal Review Codex session and reuses it for later prompts", async () => {
		const repositoryPath = await createDisposableRepository();
		const { task } = await createWorkbenchTask({
			status: "ready",
			repositoryPath,
		});
		const initialResponse = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt: "fixtureを実装してください。",
					intent: "intake",
					waitForIntake: true,
				}),
			},
		);
		expect(initialResponse.status, await initialResponse.clone().text()).toBe(
			200,
		);
		const initialBody = await initialResponse.json();
		const initialRun = await waitForTerminalRun(initialBody.run.id);
		const preparedTask = await repo.getTask(task.id);
		expect(preparedTask?.worktreePath).toBeTruthy();
		const worktreePath = preparedTask?.worktreePath as string;
		trackDisposableRepositoryRoot(worktreePath);
		await writeFile(
			path.join(worktreePath, "review-target.ts"),
			"export const reviewTarget = true;\n",
			"utf8",
		);
		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# SHOULD_NOT_ENTER_REVIEW_CONTEXT",
			messageType: "markdown_document",
			payloadJson: { intent: "implementation_plan" },
		});
		vi.mocked(llm.callStructuredJsonLLM).mockClear();
		const reviewPrompt =
			"現在のTask専用worktreeでgit statusとgit diffを自分で確認してコードレビューしてください。";

		const response = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt: reviewPrompt,
					intent: "review_prompt",
					artifactContext: {
						artifactId: `review-mode-${initialRun.id}`,
						kind: "review_status",
						title: "Review Mode",
						source: { type: "run_field", runId: initialRun.id },
					},
				}),
			},
		);

		expect(response.status, await response.clone().text()).toBe(200);
		const body = await response.json();
		expect(body.run).toMatchObject({
			taskId: task.id,
			worktreePath,
			contextSnapshot: {
				compiledPrompt: reviewPrompt,
				executionMode: "review",
				executionModeSource: "workbench_review_prompt",
				effectiveLlmRouting: { activeRole: "review" },
				reviewRuntime: {
					contextPolicy: "codex_default",
					completionPolicy: "provider_turn",
					nightworkersMcp: "disabled",
					reviewedRunId: initialRun.id,
				},
			},
		});
		expect(body.run.id).not.toBe(initialRun.id);
		expect(body.run.agentModeSessionId).not.toBe(initialRun.agentModeSessionId);
		expect(JSON.stringify(body.run.contextSnapshot)).not.toContain(
			"SHOULD_NOT_ENTER_REVIEW_CONTEXT",
		);
		expect(body.run.contextSnapshot).not.toHaveProperty("conversationContext");
		expect(body.run.contextSnapshot).not.toHaveProperty("systemContextBinding");
		expect(body.run.contextSnapshot).not.toHaveProperty("planModeRequested");
		expect(body.run.contextSnapshot).not.toHaveProperty(
			"implementationPhasePreamble",
		);
		expect(llm.callStructuredJsonLLM).not.toHaveBeenCalled();
		await waitForTerminalRun(body.run.id);
		expect(await repo.listTaskRunTodosForRun(body.run.id)).toEqual([]);
		const commitRecord = await repo.getTaskRunCommitRecord(body.run.id);
		expect(commitRecord?.preExistingDirtyPathsJson).toEqual([]);
		const commitPrompt = "コミットしてください。";
		const continuationResponse = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt: commitPrompt,
					intent: "review_prompt",
					artifactContext: {
						artifactId: `review-mode-${initialRun.id}`,
						kind: "review_status",
						title: "Review Mode",
						source: { type: "run_field", runId: initialRun.id },
					},
				}),
			},
		);
		expect(
			continuationResponse.status,
			await continuationResponse.clone().text(),
		).toBe(200);
		const continuationBody = await continuationResponse.json();
		expect(continuationBody.run.id).not.toBe(body.run.id);
		expect(continuationBody.run.agentModeSessionId).toBe(
			body.run.agentModeSessionId,
		);
		expect(continuationBody.run.contextSnapshot.compiledPrompt).toBe(
			commitPrompt,
		);
		await waitForTerminalRun(continuationBody.run.id);
		expect(await repo.listTaskRunTodosForRun(continuationBody.run.id)).toEqual(
			[],
		);
		const invalidTargetResponse = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt: reviewPrompt,
					intent: "review_prompt",
					artifactContext: {
						artifactId: `review-mode-${continuationBody.run.id}`,
						kind: "review_status",
						title: "Review Mode",
						source: {
							type: "run_field",
							runId: continuationBody.run.id,
						},
					},
				}),
			},
		);
		expect(invalidTargetResponse.status).toBe(409);
		expect(await invalidTargetResponse.json()).toMatchObject({
			code: "review_target_invalid",
		});
		expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(3);

		const statusBeforeRejectedReview = (await repo.getTask(task.id))?.status;
		execFileSync(
			"git",
			["checkout", "-b", `unexpected-${crypto.randomUUID()}`],
			{
				cwd: worktreePath,
				stdio: "ignore",
			},
		);
		const rejectedResponse = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt: reviewPrompt,
					intent: "review_prompt",
				}),
			},
		);
		expect(rejectedResponse.status).toBe(409);
		expect((await repo.getTask(task.id))?.status).toBe(
			statusBeforeRejectedReview,
		);
		expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(3);
	});

	it("keeps plan-mode AI responses available for queued sessions without starting a run", async () => {
		vi.mocked(llm.callStructuredJsonLLM)
			.mockResolvedValueOnce(
				mockPlanModeGate(true, "explicit planning request"),
			)
			.mockResolvedValueOnce(
				JSON.stringify({
					title: "Queued Plan Questionnaire",
					questions: [
						{
							text: "What should be refined first?",
							kind: "design_decision",
							type: "radio",
							options: ["UI", "API"],
						},
					],
				}),
			);
		const { task } = await createWorkbenchTask({ status: "queued" });

		const res = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt: "実装前に計画をもう少し具体化して",
					intent: "feature_plan",
				}),
			},
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.run).toBeNull();
		expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
		expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
		expect(body.task.status).toBe("queued");
		expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
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
		expect(
			body.messages.some(
				(message: unknown) =>
					message.metadataJson?.intent === "plan_mode_run_blocked",
			),
		).toBe(true);
	});

	it("does not bypass the queue for a normal Coding Agent intake", async () => {
		vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
			mockPlanModeGate(false, "ready to implement"),
		);
		const { task } = await createWorkbenchTask({ status: "queued" });

		const res = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt: "この変更を実装して",
					intent: "intake",
				}),
			},
		);

		expect(res.status, await res.clone().text()).toBe(200);
		const body = await res.json();
		expect(body.run).toBeNull();
		expect(body.task.status).toBe("queued");
		expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
		expect(
			body.messages.some(
				(message: unknown) =>
					message.metadataJson?.intent === "coding_agent_run_blocked",
			),
		).toBe(true);
	});

	it("does not override the LLM gate from the task creation source", async () => {
		vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
			mockPlanModeGate(false, "requirements are already implementable"),
		);
		const repositoryPath = await createDisposableRepository();
		const { task } = await createWorkbenchTask({
			createdBy: "project-evaluation",
			repositoryPath,
		});

		const res = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					prompt: "確定済みの改善内容を実装して",
					intent: "intake",
				}),
			},
		);

		expect(res.status, await res.clone().text()).toBe(200);
		const body = await res.json();
		expect(body.run?.contextSnapshot).toMatchObject({
			planModeRequested: false,
		});
	}, 60_000);

	it("lets a human start Coding Agent through the shared implementation command", async () => {
		const repositoryPath = await createDisposableRepository();
		const { task } = await createWorkbenchTask({
			createdBy: "project-evaluation",
			repositoryPath,
		});
		const idempotencyKey = `human-implementation-start:${crypto.randomUUID()}`;

		await repo.updateTask(task.id, {
			objective: "確定済みの改善内容を実装して",
		});
		const response = await app.request(
			`http://localhost/api/workbench/sessions/${task.id}/run`,
			{
				method: "POST",
				headers: { ...sameOriginHeaders, "Idempotency-Key": idempotencyKey },
			},
		);
		expect(response.status, await response.clone().text()).toBe(201);
		const result = await response.json();

		expect(result).toMatchObject({
			taskId: task.id,
			id: expect.any(String),
		});
		expect(
			(await service.listTaskMessages(task.id)).find(
				(message) =>
					message.role === "user" &&
					message.content === "確定済みの改善内容を実装して",
			)?.metadataJson,
		).toMatchObject({
			source: "task_operator",
			intent: "implementation_request",
			actor: {
				kind: "human",
				actorId: "local-task-operator-user",
				authorizationRef: "local-user",
			},
		});
		expect(await repo.listTaskRunsForTask(task.id)).toContainEqual(
			expect.objectContaining({ id: result.id }),
		);
		expect(llm.callStructuredJsonLLM).not.toHaveBeenCalled();
	}, 60_000);

	it("prefers adopted Blueprint artifacts over newer generated Blueprint messages for planning", async () => {
		const { task } = await createWorkbenchTask({ status: "ready" });
		const adoptedMessage = await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "Adopted Blueprint",
			messageType: "markdown_document",
			payloadJson: {
				intent: "app_blueprint",
				appBlueprint: {
					...representativeAppBlueprint,
					id: "adopted-blueprint",
				},
			},
		});
		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "Newer generated Blueprint",
			messageType: "markdown_document",
			payloadJson: {
				intent: "app_blueprint",
				appBlueprint: {
					...representativeAppBlueprint,
					id: "newer-generated-blueprint",
				},
			},
		});
		await repo.upsertBlueprintArtifactAdoption(
			task.id,
			adoptedMessage.id,
			true,
		);

		const readiness = await service.resolveBlueprintPlanningReadiness(task.id);

		expect(readiness).toMatchObject({
			source: "adopted",
			diagnostic: "adopted_blueprint",
			messageId: adoptedMessage.id,
			blueprint: { id: "adopted-blueprint" },
		});
	});

	it("uses the latest generated Blueprint only when no artifact is adopted", async () => {
		const { task } = await createWorkbenchTask({ status: "ready" });
		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "Older Blueprint",
			messageType: "markdown_document",
			payloadJson: {
				intent: "app_blueprint",
				appBlueprint: { ...representativeAppBlueprint, id: "older-blueprint" },
			},
		});
		const latestMessage = await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "Latest Blueprint",
			messageType: "markdown_document",
			payloadJson: {
				intent: "app_blueprint",
				appBlueprint: { ...representativeAppBlueprint, id: "latest-blueprint" },
			},
		});

		const readiness = await service.resolveBlueprintPlanningReadiness(task.id);

		expect(readiness).toMatchObject({
			source: "latest_generated",
			diagnostic: "using_latest_generated_blueprint",
			messageId: latestMessage.id,
			blueprint: { id: "latest-blueprint" },
		});
	});

	it("emits a stable diagnostic when no Blueprint artifact is available for planning", async () => {
		const { task } = await createWorkbenchTask({ status: "ready" });

		const readiness = await service.resolveBlueprintPlanningReadiness(task.id);

		expect(readiness).toMatchObject({
			source: "none",
			diagnostic: "no_adopted_blueprint",
			messageId: null,
			blueprint: null,
		});
		expect(readiness.summary).toContain("No adopted Blueprint artifact");
	});
});
