import crypto from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import app from "../../api/app";
import { ensureNightWorkersSchema } from "../../api/db/bootstrap";
import * as repo from "../../api/modules/nightworkers/nightworkers.repository";
import { recordLlmUsage } from "../../api/services/llm-usage";
import * as generalSettings from "../../api/services/settings/general-settings";

const sameOriginHeaders = { Origin: "http://localhost:39174" };

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

		const second = await repo.createTaskRunTodo({
			runId: run.id,
			seq: 2,
			title: "Run verification",
			description: "Check the implementation",
			taskType: "verification",
			status: "pending",
			dependsOn: [1],
		});
		const first = await repo.createTaskRunTodo({
			runId: run.id,
			seq: 1,
			title: "Implement persistence",
			description: "Add todo persistence",
			taskType: "code_change",
			status: "running",
			procedureId: "code-change",
			procedureSnapshot: { id: "code-change", digest: "sha256:test" },
			contextSnapshot: { digest: "context:test" },
		});

		await repo.updateTaskRunTodo(first.id, {
			status: "passed",
			completionGateResult: { passed: true },
			completedAt: new Date("2026-06-02T00:01:00.000Z"),
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
			first.id,
			second.id,
		]);
		expect(runDetail.todos[0]).toMatchObject({
			seq: 1,
			title: "Implement persistence",
			taskType: "code_change",
			status: "passed",
			procedureId: "code-change",
			procedureSnapshot: { id: "code-change", digest: "sha256:test" },
			contextSnapshot: { digest: "context:test" },
			completionGateResult: { passed: true },
			dependsOn: [],
		});
		expect(runDetail.todos[1]).toMatchObject({
			seq: 2,
			taskType: "verification",
			status: "pending",
			dependsOn: [1],
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
					touchedFiles: ["api/services/agent-runtime/runtime.ts"],
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

	it("enforces one todo per run sequence and cascades todos with run deletion", async () => {
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

		await repo.createTaskRunTodo({
			runId: run.id,
			seq: 1,
			title: "Only first seq",
			taskType: "investigation",
		});

		await expect(
			repo.createTaskRunTodo({
				runId: run.id,
				seq: 1,
				title: "Duplicate seq",
				taskType: "verification",
			}),
		).rejects.toThrow();

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
