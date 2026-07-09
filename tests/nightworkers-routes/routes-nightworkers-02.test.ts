import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../../api/app";
import { ensureNightWorkersSchema } from "../../api/db/bootstrap";
import { db } from "../../api/db/client";
import { llmUsageRecords, llmUsageSummaryBuckets } from "../../api/db/schema";
import * as repo from "../../api/modules/nightworkers/nightworkers.repository";
import { recordLlmUsage } from "../../api/services/llm-usage";
import { upsertPricingRow } from "../../api/services/pricing";

const sameOriginHeaders = { Origin: "http://localhost:39174" };

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("NightWorkers task routes", () => {
	it("returns an overview dashboard with usage, model mix, and estimated cost", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Overview ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Overview target",
			description: "Overview usage",
			status: "draft",
		});
		await upsertPricingRow({
			provider: "openai",
			model: "test-priced-model",
			currencyCode: "JPY",
			inputPer1m: 100,
			cachedInputPer1m: 10,
			outputPer1m: 200,
			sourceLabel: "test",
			manualOverride: true,
			enabled: true,
		});
		await recordLlmUsage({
			taskId: task.id,
			callId: crypto.randomUUID(),
			provider: "openai",
			model: "test-priced-model",
			label: "test-call",
			usage: {
				inputTokens: 1000,
				outputTokens: 500,
				cachedInputTokens: 100,
				reasoningOutputTokens: null,
				totalTokens: 1500,
				mode: "measured",
			},
			durationMs: 1000,
		});

		const res = await app.request(
			`http://localhost/api/overview?range=30d&repositoryId=${createdRepo.id}&currency=JPY`,
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.usage.inputTokens).toBeGreaterThanOrEqual(1000);
		expect(body.usage.outputTokensPerSecond).toBe(500);
		expect(body.usage.promptInputTokens).toBeGreaterThanOrEqual(0);
		expect(body.cost.estimatedTotal).toBeGreaterThan(0);
		expect(body.modelBreakdown).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					provider: "openai",
					model: "test-priced-model",
					pricingStatus: "manual",
					outputTokensPerSecond: 500,
				}),
			]),
		);
		expect(body.recentExpensiveCalls[0]).toEqual(
			expect.objectContaining({
				taskId: task.id,
				inputTokens: 1000,
				cachedInputTokens: 100,
				outputTokens: 500,
				outputTokensPerSecond: 500,
			}),
		);
	});

	it("builds overview aggregate metrics from summary buckets without raw rows", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Overview Summary Only ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const now = new Date();
		const bucketHourUtc = new Date(
			Math.floor(now.getTime() / 3_600_000) * 3_600_000,
		);
		await db.insert(llmUsageSummaryBuckets).values({
			createdAt: now,
			updatedAt: now,
			bucketHourUtc,
			repositoryId: createdRepo.id,
			repositoryKey: createdRepo.id,
			provider: "openai",
			model: "summary-only-model",
			modelKey: "summary-only-model",
			pricingCurrencyCode: "JPY",
			pricingCurrencyKey: "JPY",
			pricingStatus: "manual",
			inputTokens: 1200,
			outputTokens: 300,
			totalTokens: 1500,
			totalDurationMs: 1000,
			outputDurationMs: 1000,
			measuredDurationCallCount: 1,
			callCount: 1,
			measuredCallCount: 1,
			pricedCallCount: 1,
			manualPricedCallCount: 1,
			estimatedCost: 42,
			inputCost: 12,
			outputCost: 30,
			pricingUpdatedAt: now,
		});

		const res = await app.request(
			`http://localhost/api/overview?range=30d&repositoryId=${createdRepo.id}&currency=JPY`,
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.usage).toMatchObject({
			inputTokens: 1200,
			outputTokens: 300,
			totalTokens: 1500,
			callCount: 1,
			measuredCallCount: 1,
			outputTokensPerSecond: 300,
		});
		expect(body.cost).toMatchObject({
			currency: "JPY",
			estimatedTotal: 42,
			pricedCallCount: 1,
			unpricedCallCount: 0,
		});
		expect(body.modelBreakdown).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					provider: "openai",
					model: "summary-only-model",
					pricingStatus: "manual",
					estimatedCost: 42,
				}),
			]),
		);
	});

	it("warns when raw usage exists but summary buckets are missing", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Overview Summary Missing ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: raw-only overview task",
			status: "draft",
		});
		const now = new Date();
		await db.insert(llmUsageRecords).values({
			createdAt: now,
			updatedAt: now,
			taskId: task.id,
			callId: crypto.randomUUID(),
			provider: "openai",
			model: "raw-only-model",
			label: "raw-only",
			usageMode: "measured",
			inputTokens: 100,
			outputTokens: 50,
			totalTokens: 150,
			durationMs: 100,
		});

		const res = await app.request(
			`http://localhost/api/overview?range=30d&repositoryId=${createdRepo.id}&currency=JPY`,
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.usage.callCount).toBe(0);
		expect(body.warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "summary_backfill_required",
					callCount: 1,
				}),
			]),
		);
	});

	it("persists task messages into activity ledger and replays them by task cursor", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Activity Message ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Activity message target",
			description: "Persist activity message",
			status: "draft",
		});

		const message = await repo.createTaskMessage({
			taskId: task.id,
			role: "tool",
			content: "tool output",
			messageType: "text",
			payloadJson: { raw: "result" },
		});

		const res = await app.request(
			`http://localhost/api/tasks/${task.id}/activity-events`,
		);
		expect(res.status).toBe(200);
		const replay = await res.json();
		expect(replay.artifacts).toEqual([]);
		const events = replay.events;
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					taskId: task.id,
					kind: "tool.result",
					source: "tool",
					text: "tool output",
					externalId: message.id,
				}),
			]),
		);

		const afterRes = await app.request(
			`http://localhost/api/tasks/${task.id}/activity-events?afterSeq=1`,
		);
		expect(afterRes.status).toBe(200);
		expect(await afterRes.json()).toEqual({ events: [], artifacts: [] });
	});

	it("persists Blueprint document messages as activity artifacts", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Activity Blueprint ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Activity blueprint target",
			description: "Persist activity blueprint",
			status: "draft",
		});

		const message = await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# App Blueprint",
			messageType: "markdown_document",
			payloadJson: {
				intent: "app_blueprint",
				title: "Inventory App",
				appBlueprint: { id: "inventory-app", name: "Inventory App" },
				validation: { valid: true, issues: [] },
			},
		});

		const res = await app.request(
			`http://localhost/api/tasks/${task.id}/activity-events`,
		);
		expect(res.status).toBe(200);
		const replay = await res.json();
		expect(replay.artifacts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "app_blueprint",
					path: `${message.id}.app-blueprint.json`,
					metadataJson: expect.objectContaining({
						messageId: message.id,
						intent: "app_blueprint",
						appBlueprint: expect.objectContaining({ name: "Inventory App" }),
					}),
				}),
			]),
		);
		expect(replay.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "system.info",
					source: "assistant",
					artifactId: expect.any(String),
					payloadJson: expect.objectContaining({
						metadata: expect.objectContaining({ intent: "app_blueprint" }),
					}),
				}),
			]),
		);
	});

	it("does not persist response deltas into the activity ledger", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Activity Run Event ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Activity run event target",
			description: "Persist activity run event",
			status: "draft",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});

		await repo.createRunEvent({
			version: 1,
			runId: run.id,
			timestamp: new Date().toISOString(),
			type: "model.response_delta",
			severity: "info",
			actor: "supervisor",
			message: "delta text",
		});

		const res = await app.request(
			`http://localhost/api/runs/${run.id}/activity-events`,
		);
		expect(res.status).toBe(200);
		const replay = await res.json();
		expect(replay.artifacts).toEqual([]);
		expect(replay.events).toEqual([]);
	});

	it("projects Codex runtime progress and file changes into activity replay", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Codex Activity ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Codex activity target",
			description: "Persist Codex activity",
			status: "draft",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
			workerKind: "codex-agent",
		});

		await repo.createRunEvent({
			version: 1,
			runId: run.id,
			taskId: task.id,
			timestamp: new Date().toISOString(),
			type: "tool.call_progress",
			severity: "info",
			actor: "worker",
			message: "[Codex] Command progress: pnpm test",
			data: {
				provider: "codex",
				toolName: "command_execution",
				command: "pnpm test",
				status: "in_progress",
				aggregatedOutput: "running tests",
			},
		});
		await repo.createRunEvent({
			version: 1,
			runId: run.id,
			taskId: task.id,
			timestamp: new Date().toISOString(),
			type: "git.diff_collected",
			severity: "checkpoint",
			actor: "worker",
			message: "[Codex] File change completed: 1 file(s).",
			data: {
				provider: "codex",
				changedFiles: ["src/fizzbuzz.ts"],
			},
		});

		const res = await app.request(
			`http://localhost/api/runs/${run.id}/activity-events`,
		);
		expect(res.status).toBe(200);
		const replay = await res.json();
		expect(replay.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "tool.call",
					text: expect.stringContaining("running tests"),
				}),
				expect.objectContaining({
					kind: "file.diff",
					text: expect.stringContaining("src/fizzbuzz.ts"),
				}),
			]),
		);
	});

	it("maps schema-first agent events into chat activity kinds without duplicating final answers", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Schema-first Activity ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Schema-first activity target",
			description: "Persist schema-first activity",
			status: "draft",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: createdRepo.id,
			status: "running",
		});

		await repo.createRunEvent(
			{
				version: 1,
				runId: run.id,
				taskId: task.id,
				timestamp: new Date().toISOString(),
				type: "supervisor.decision",
				severity: "info",
				actor: "supervisor",
				message: "[SchemaFirstAgent] round2.parsed",
			},
			{
				payloadJson: {
					agentEventType: "round2.parsed",
					payload: {
						toolCall: {
							name: "apply_patch",
							arguments: { patchContent: "diff --git a/a b/a" },
						},
					},
				},
			},
		);
		await repo.createRunEvent(
			{
				version: 1,
				runId: run.id,
				taskId: task.id,
				timestamp: new Date().toISOString(),
				type: "system.info",
				severity: "debug",
				actor: "runtime",
				message: "[SchemaFirstAgent] procedure.loaded",
			},
			{
				payloadJson: {
					agentEventType: "procedure.loaded",
					payload: {
						procedurePath: "procedures/minor_code_edit.md",
						procedure: "# minor_code_edit\n\n## Procedure\n1. read_file",
					},
				},
			},
		);
		await repo.createRunEvent(
			{
				version: 1,
				runId: run.id,
				taskId: task.id,
				timestamp: new Date().toISOString(),
				type: "system.info",
				severity: "info",
				actor: "runtime",
				message: "[SchemaFirstAgent] finalize.received",
			},
			{
				payloadJson: {
					agentEventType: "finalize.received",
					payload: { message: "完了しました。" },
				},
			},
		);

		const res = await app.request(
			`http://localhost/api/runs/${run.id}/activity-events`,
		);
		expect(res.status).toBe(200);
		const replay = await res.json();
		expect(replay.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					taskId: task.id,
					runId: run.id,
					kind: "llm.schema_result",
					turnId: `assistant:${run.id}`,
					text: expect.stringContaining("apply_patch"),
					payloadJson: expect.objectContaining({
						agentEventType: "round2.parsed",
					}),
				}),
				expect.objectContaining({
					taskId: task.id,
					runId: run.id,
					kind: "runtime.state",
					turnId: `assistant:${run.id}`,
					text: "procedures/minor_code_edit.md",
					payloadJson: expect.objectContaining({
						agentEventType: "procedure.loaded",
						payload: expect.objectContaining({
							procedurePath: "procedures/minor_code_edit.md",
							procedure: expect.stringContaining("# minor_code_edit"),
						}),
					}),
				}),
			]),
		);
		expect(
			replay.events.some(
				(event: unknown) =>
					event.payloadJson?.agentEventType === "finalize.received",
			),
		).toBe(false);
	});

	it("persists Blueprint design settings per session", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Blueprint Design Settings ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Blueprint design settings target",
			description: "Persist design token settings",
			status: "draft",
		});

		const settings = {
			theme: "mint",
			density: "comfortable",
			shape: "pill",
			shadow: "strong",
			shadowDirection: "135deg",
			font: "mono",
			contrast: "high",
			motion: "reduced",
			componentVariants: {
				button: "outline",
				card: "elevated",
				table: "dense-grid",
				input: "filled",
			},
		};

		const saveRes = await app.request(
			`http://localhost/api/tasks/${task.id}/blueprint-design-settings`,
			{
				method: "PUT",
				headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
				body: JSON.stringify(settings),
			},
		);
		expect(saveRes.status).toBe(200);
		expect(await saveRes.json()).toMatchObject({
			sessionId: task.id,
			settings,
		});

		const getRes = await app.request(
			`http://localhost/api/tasks/${task.id}/blueprint-design-settings`,
			{ headers: sameOriginHeaders },
		);
		expect(getRes.status).toBe(200);
		expect(await getRes.json()).toMatchObject({
			sessionId: task.id,
			settings,
		});
	});

	it("persists independent Blueprint adoption decisions per session message", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: Blueprint Adoption ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: Blueprint adoption target",
			description: "Persist adoption states",
			status: "draft",
		});
		const message = await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: "# Blueprint",
			messageType: "markdown_document",
			payloadJson: { intent: "app_blueprint" },
		});

		const endpoints = ["blueprint-adoption", "blueprint-design-token-adoption"];

		for (const endpoint of endpoints) {
			const initialRes = await app.request(
				`http://localhost/api/tasks/${task.id}/${endpoint}?messageId=${message.id}`,
				{ headers: sameOriginHeaders },
			);
			expect(initialRes.status).toBe(200);
			expect(await initialRes.json()).toMatchObject({
				sessionId: task.id,
				messageId: message.id,
				adopted: false,
			});
		}

		const getBlueprintRes = await app.request(
			`http://localhost/api/tasks/${task.id}/blueprint-adoption?messageId=${message.id}`,
			{ headers: sameOriginHeaders },
		);
		const getDesignTokenRes = await app.request(
			`http://localhost/api/tasks/${task.id}/blueprint-design-token-adoption?messageId=${message.id}`,
			{ headers: sameOriginHeaders },
		);

		expect(await getBlueprintRes.json()).toMatchObject({ adopted: false });
		expect(await getDesignTokenRes.json()).toMatchObject({ adopted: false });
	});
});
