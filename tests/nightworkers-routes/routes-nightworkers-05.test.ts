import crypto from "node:crypto";
import { missionPilotThoughtTrace } from "@nightworkers/mission-pilot/backend";
import { beforeAll, describe, expect, it, vi } from "vitest";
import app from "../../api/app";
import { ensureNightWorkersSchema } from "../../api/db/bootstrap";
import { TodoMutationService } from "../../api/modules/codingAgent/todo";
import * as repo from "../../api/modules/nightworkers/nightworkers.repository";
import { codingAgentChatTrace } from "../../api/modules/nightworkers/nightworkers.trace-provenance";
import { recordLlmUsage } from "../../api/services/llm-usage";
import * as generalSettings from "../../api/services/settings/general-settings";

const sameOriginHeaders = { Origin: "http://localhost:39174" };

function todoService(repositoryRoot: string, taskGoal: string) {
	return new TodoMutationService(
		{
			version: 1,
			roleInstructionsJa: "Coding Agentとして作業する。",
			taskGoal,
			projectRulesJa: [],
			todoRequirementJa: "current Todoを明示的に開始する。",
			failureRecoveryJa: "失敗を記録して再計画する。",
			completionRuleJa: "未完了Todoを残さない。",
			toolContractJa: "構造化tool結果を読む。",
			registeredRepositoryRoot: repositoryRoot,
			planModeRequested: false,
			todoPolicy: "adaptive",
		},
		"agent",
	);
}

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("NightWorkers task run todo routes", () => {
	it("returns persisted todos with run details in sequence order", async () => {
		const createdRepo = await repo.createRepository({
			name: "TEST: Todo Route Workspace",
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Todo task",
			description: "Todo task description",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
			workerKind: "native-local",
			timeoutSeconds: 60,
			startedAt: new Date("2026-06-02T00:00:00.000Z"),
		});

		const firstId = crypto.randomUUID();
		const secondId = crypto.randomUUID();
		const service = todoService(createdRepo.localPath, task.title);
		const plan = await service.execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					id: firstId,
					title: "Implement persistence",
					objective: "Add todo persistence",
					systemContext: "Todo永続化の境界を実装し、既存のRun契約を維持する。",
					nextAction: "Implement the persistence boundary",
				},
				{
					id: secondId,
					title: "Run verification",
					objective: "Check the implementation",
					systemContext: "実装後の永続化動作をfocused testで検証する。",
					nextAction: "Run focused tests",
					dependsOn: [firstId],
				},
			],
		});
		if (!plan.ok) throw new Error(plan.error.code);
		const [firstTodo, secondTodo] = plan.todos;
		const started = await service.execute(run.id, {
			op: "start",
			todoId: firstId,
			expectedTodoRevision: plan.todos[0].revision,
		});
		if (!started.ok || !started.currentTodo) throw new Error("start failed");
		await service.execute(run.id, {
			op: "transition",
			todoId: firstId,
			expectedTodoRevision: started.currentTodo.revision,
			status: "passed",
			reason: "Persistence boundary completed",
		});

		const runDetailRes = await app.request(
			`http://localhost/api/runs/${run.id}`,
			{
				method: "GET",
			},
		);
		expect(runDetailRes.status).toBe(200);
		const runDetail = await runDetailRes.json();
		expect(runDetail.todos.map((todo: unknown) => todo.id)).toEqual([
			firstTodo.id,
			secondTodo.id,
		]);
		expect(runDetail.todos[0]).toMatchObject({
			todoKey: firstId,
			seq: 1,
			title: "Implement persistence",
			taskType: "coding",
			status: "passed",
			objective: "Add todo persistence",
			dependsOn: [],
		});
		expect(runDetail.todos[1]).toMatchObject({
			todoKey: secondId,
			seq: 2,
			taskType: "coding",
			status: "pending",
			dependsOn: [firstTodo.id],
		});
	});

	it("returns ontology run debug report from run context snapshot", async () => {
		const createdRepo = await repo.createRepository({
			name: "TEST: Ontology Debug Route Workspace",
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Ontology debug task",
			description: "Inspect ontology debug report",
			status: "completed",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "completed",
			workerKind: "codex-sdk",
			timeoutSeconds: 60,
			startedAt: new Date("2026-06-02T00:00:00.000Z"),
			testResults: { passed: true },
			contextSnapshot: {
				ontologyContext: {
					available: true,
					runtimeLane: "codex-sdk",
					primaryModule: "agent-runtime",
					secondaryModules: ["task-generation"],
					taskGenerationEvidence: true,
					warnings: [],
				},
				ontologyBoundaryAudit: {
					available: true,
					decision: "allow",
					touchedFiles: ["api/modules/codingAgent/runtime/runtime.ts"],
					boundaryCrossings: [],
					needsConfirmation: [],
					forbiddenTouched: [],
					verificationSelection: {
						focused: [
							"bunx vitest run tests/services.codex-agent-runtime.test.ts",
						],
					},
					warnings: [],
				},
			},
		});

		const res = await app.request(
			`http://localhost/api/runs/${run.id}/ontology-debug`,
			{
				method: "GET",
			},
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({
			runId: run.id,
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "completed",
			runtimeLane: "codex-sdk",
			evidenceSources: {
				contextSnapshot: true,
			},
			summary: {
				available: true,
				primaryModule: "agent-runtime",
				secondaryModules: ["task-generation"],
				taskGenerationEvidence: true,
				boundaryDecision: "allow",
				touchedFilesCount: 1,
				unexplainedCrossingsCount: 0,
				focusedVerificationCount: 1,
				focusedVerificationState: "passed",
			},
		});
	});

	it("cascades versioned todos with run deletion", async () => {
		const createdRepo = await repo.createRepository({
			name: "TEST: Todo Constraint Workspace",
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Todo constraint task",
			status: "running",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
			workerKind: "native-local",
			timeoutSeconds: 60,
		});

		const plan = await todoService(createdRepo.localPath, task.title).execute(
			run.id,
			{
				op: "replace_plan",
				expectedPlanRevision: 0,
				todos: [
					{
						title: "Only todo",
						systemContext: "Todoのcascade削除を永続化層で確認する。",
						nextAction: "Inspect persistence",
					},
				],
			},
		);
		expect(plan.ok).toBe(true);

		await repo.deleteTask(task.id);
		expect(await repo.listTaskRunTodosForRun(run.id)).toEqual([]);
	});

	it("returns task LLM token usage summary", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: LLM Usage ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: LLM usage task",
			status: "draft",
		});

		await recordLlmUsage({
			taskId: task.id,
			runId: null,
			callId: crypto.randomUUID(),
			provider: "openai",
			model: "gpt-test",
			label: "supervisor",
			round: 1,
			usage: {
				inputTokens: 100,
				outputTokens: 20,
				cachedInputTokens: 10,
				reasoningOutputTokens: 4,
				totalTokens: 120,
				mode: "measured",
				rawUsage: { prompt_tokens: 100, completion_tokens: 20 },
			},
			promptPartTokenEstimates: {
				systemPromptTokens: 30,
				userPromptTokens: 70,
				stateCardTokens: 12,
			},
			durationMs: 42,
		});

		const res = await app.request(
			`http://localhost/api/tasks/${task.id}/llm-usage`,
			{
				headers: sameOriginHeaders,
			},
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			taskId: task.id,
			inputTokens: 100,
			outputTokens: 20,
			cachedInputTokens: 10,
			reasoningOutputTokens: 4,
			totalTokens: 120,
			totalDurationMs: 42,
			averageDurationMs: 42,
			stateCardTokens: 12,
			usageMode: "mixed",
			callCount: 1,
			measuredCallCount: 1,
			estimatedCallCount: 0,
		});
	});

	it("stores Codex measured usage with prompt estimate counts when observability is enabled", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Codex LLM Usage ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Codex LLM usage task",
			status: "draft",
		});

		await recordLlmUsage({
			taskId: task.id,
			runId: null,
			callId: crypto.randomUUID(),
			provider: "codex",
			model: "gpt-5.4-mini",
			label: "specification_document",
			round: null,
			usage: {
				inputTokens: 100,
				outputTokens: 20,
				cachedInputTokens: 5,
				reasoningOutputTokens: 2,
				totalTokens: 120,
				mode: "measured",
				rawUsage: {
					input_tokens: 100,
					cached_input_tokens: 5,
					output_tokens: 20,
					reasoning_output_tokens: 2,
				},
			},
			promptPartTokenEstimates: {
				systemPromptTokens: 30,
				userPromptTokens: 70,
				stateCardTokens: 12,
			},
			durationMs: 42,
		});

		const res = await app.request(
			`http://localhost/api/tasks/${task.id}/llm-usage`,
			{
				headers: sameOriginHeaders,
			},
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			taskId: task.id,
			inputTokens: 100,
			outputTokens: 20,
			cachedInputTokens: 5,
			reasoningOutputTokens: 2,
			totalTokens: 120,
			promptInputTokens: 112,
			totalDurationMs: 42,
			averageDurationMs: 42,
			stateCardTokens: 12,
			usageMode: "mixed",
			callCount: 1,
			measuredCallCount: 1,
			estimatedCallCount: 0,
		});
	});

	it("separates Coding Agent and Mission Pilot token categories", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Owned LLM Usage ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Owned LLM usage task",
			status: "draft",
		});
		await recordLlmUsage({
			taskId: task.id,
			callId: crypto.randomUUID(),
			provider: "codex",
			model: "gpt-5.4-mini",
			label: "coding_agent_turn",
			usage: {
				inputTokens: 100,
				cachedInputTokens: 40,
				outputTokens: 10,
				reasoningOutputTokens: 3,
				totalTokens: 110,
				mode: "measured",
			},
			durationMs: 100,
			trace: codingAgentChatTrace(),
		});
		await recordLlmUsage({
			taskId: task.id,
			callId: crypto.randomUUID(),
			provider: "codex",
			model: "gpt-5.4-mini",
			label: "mission_pilot_turn",
			usage: {
				inputTokens: 50,
				cachedInputTokens: 20,
				outputTokens: 5,
				reasoningOutputTokens: 2,
				totalTokens: 55,
				mode: "measured",
			},
			durationMs: 50,
			trace: missionPilotThoughtTrace({ sessionId: crypto.randomUUID() }),
		});

		const res = await app.request(
			`http://localhost/api/tasks/${task.id}/llm-usage`,
			{ headers: sameOriginHeaders },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			inputTokens: 150,
			cachedInputTokens: 60,
			nonCachedInputTokens: 90,
			outputTokens: 15,
			byOwner: {
				codingAgent: {
					inputTokens: 100,
					cachedInputTokens: 40,
					nonCachedInputTokens: 60,
					outputTokens: 10,
					reasoningOutputTokens: 3,
				},
				missionPilot: {
					inputTokens: 50,
					cachedInputTokens: 20,
					nonCachedInputTokens: 30,
					outputTokens: 5,
					reasoningOutputTokens: 2,
				},
			},
		});
	});

	it("keeps Codex measured provider tokens when prompt observability is disabled", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Codex LLM Usage Disabled ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Codex LLM usage disabled task",
			status: "draft",
		});

		await recordLlmUsage({
			taskId: task.id,
			runId: null,
			callId: crypto.randomUUID(),
			provider: "codex",
			model: "gpt-5.4-mini",
			label: "specification_document",
			round: null,
			usage: {
				inputTokens: 100,
				outputTokens: 20,
				cachedInputTokens: 5,
				reasoningOutputTokens: 2,
				totalTokens: 120,
				mode: "measured",
				rawUsage: {
					input_tokens: 100,
					cached_input_tokens: 5,
					output_tokens: 20,
					reasoning_output_tokens: 2,
				},
			},
			promptPartTokenEstimates: {
				systemPromptTokens: 30,
				userPromptTokens: 70,
				stateCardTokens: 12,
			},
			promptPartObservabilityEnabled: false,
			durationMs: 42,
		});

		const res = await app.request(
			`http://localhost/api/tasks/${task.id}/llm-usage`,
			{
				headers: sameOriginHeaders,
			},
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			taskId: task.id,
			inputTokens: 100,
			outputTokens: 20,
			cachedInputTokens: 5,
			reasoningOutputTokens: 2,
			totalTokens: 120,
			promptInputTokens: 0,
			stateCardTokens: 0,
			usageMode: "measured",
			callCount: 1,
			measuredCallCount: 1,
			estimatedCallCount: 0,
		});
	});

	it("uses General Settings to disable prompt estimates when record input omits the flag", async () => {
		const settingsSpy = vi
			.spyOn(generalSettings, "readGeneralSettings")
			.mockReturnValue({
				...generalSettings.DEFAULT_GENERAL_SETTINGS,
				llmUsage: {
					promptPartObservabilityEnabled: false,
				},
			});
		try {
			const createdRepo = await repo.createRepository({
				name: `TEST: LLM Usage Settings Disabled ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: createdRepo.id,
				title: "TEST: LLM usage settings disabled task",
				status: "draft",
			});

			await recordLlmUsage({
				taskId: task.id,
				runId: null,
				callId: crypto.randomUUID(),
				provider: "openai",
				model: "gpt-test",
				label: "supervisor",
				round: 1,
				usage: {
					inputTokens: 100,
					outputTokens: 20,
					cachedInputTokens: 10,
					reasoningOutputTokens: 4,
					totalTokens: 120,
					mode: "measured",
					rawUsage: { prompt_tokens: 100, completion_tokens: 20 },
				},
				promptPartTokenEstimates: {
					systemPromptTokens: 30,
					userPromptTokens: 70,
					stateCardTokens: 12,
				},
				durationMs: 42,
			});

			const res = await app.request(
				`http://localhost/api/tasks/${task.id}/llm-usage`,
				{
					headers: sameOriginHeaders,
				},
			);

			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toMatchObject({
				taskId: task.id,
				inputTokens: 100,
				outputTokens: 20,
				totalTokens: 120,
				totalDurationMs: 42,
				averageDurationMs: 42,
				promptInputTokens: 0,
				stateCardTokens: 0,
				usageMode: "measured",
			});
		} finally {
			settingsSpy.mockRestore();
		}
	});
});
