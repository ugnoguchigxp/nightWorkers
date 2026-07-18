import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	llmUsageRecords,
	llmUsageSummaryBuckets,
	llmUsageSummaryWarnings,
} from "../api/db/schema";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import {
	recordLlmUsage,
	summarizeLlmUsageForTask,
} from "../api/services/llm-usage";
import {
	checkLlmUsageSummaryIntegrity,
	rebuildLlmUsageSummary,
} from "../api/services/llm-usage/summary";
import { upsertPricingRow } from "../api/services/pricing";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("LLM usage summary", () => {
	it("increments summary buckets when usage records are created", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: LLM Summary ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: LLM summary task",
			status: "draft",
		});
		await upsertPricingRow({
			provider: "openai",
			model: "summary-priced-model",
			currencyCode: "USD",
			inputPer1m: 100,
			cachedInputPer1m: 10,
			outputPer1m: 200,
			manualOverride: true,
			enabled: true,
		});

		await recordLlmUsage({
			taskId: task.id,
			callId: crypto.randomUUID(),
			provider: "openai",
			model: "summary-priced-model",
			label: "first",
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
		await recordLlmUsage({
			taskId: task.id,
			callId: crypto.randomUUID(),
			provider: "openai",
			model: "summary-priced-model",
			label: "second",
			usage: {
				inputTokens: 300,
				outputTokens: 200,
				cachedInputTokens: 0,
				reasoningOutputTokens: null,
				totalTokens: 500,
				mode: "measured",
			},
			durationMs: 500,
		});

		const [summary] = await db
			.select()
			.from(llmUsageSummaryBuckets)
			.where(
				and(
					eq(llmUsageSummaryBuckets.repositoryKey, createdRepo.id),
					eq(llmUsageSummaryBuckets.provider, "openai"),
					eq(llmUsageSummaryBuckets.modelKey, "summary-priced-model"),
				),
			);

		expect(summary).toMatchObject({
			callCount: 2,
			pricedCallCount: 2,
			manualPricedCallCount: 2,
			inputTokens: 1300,
			outputTokens: 700,
			totalTokens: 2000,
			totalDurationMs: 1500,
			outputDurationMs: 1500,
			measuredDurationCallCount: 2,
		});
	});

	it("keeps cached reads exclusive when provider usage exceeds input", async () => {
		const model = `summary-cached-anomaly-${crypto.randomUUID()}`;
		const createdRepo = await repo.createRepository({
			name: `TEST: LLM Summary Cached Anomaly ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: LLM summary cached anomaly",
			status: "draft",
		});
		await upsertPricingRow({
			provider: "openai",
			model,
			currencyCode: "USD",
			inputPer1m: 100,
			cachedInputPer1m: 10,
			outputPer1m: 200,
			manualOverride: true,
			enabled: true,
		});

		await recordLlmUsage({
			taskId: task.id,
			callId: crypto.randomUUID(),
			provider: "openai",
			model,
			label: "cached-anomaly",
			usage: {
				inputTokens: 100,
				outputTokens: 0,
				cachedInputTokens: 150,
				reasoningOutputTokens: null,
				totalTokens: 100,
				mode: "measured",
			},
			durationMs: 100,
		});

		const [summary] = await db
			.select()
			.from(llmUsageSummaryBuckets)
			.where(eq(llmUsageSummaryBuckets.repositoryKey, createdRepo.id));
		const warnings = await db
			.select()
			.from(llmUsageSummaryWarnings)
			.where(eq(llmUsageSummaryWarnings.repositoryKey, createdRepo.id));

		expect(summary).toMatchObject({
			inputTokens: 100,
			cachedInputTokens: 100,
			inputCost: 0,
			cachedInputCost: 0.001,
		});
		expect(warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "usage_token_anomaly",
					detailKey: "cached_input_exceeds_input",
				}),
			]),
		);
		await expect(summarizeLlmUsageForTask(task.id)).resolves.toMatchObject({
			inputTokens: 100,
			cachedInputTokens: 100,
			nonCachedInputTokens: 0,
		});
	});

	it("backfills summaries and detects integrity drift", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: LLM Summary Backfill ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: LLM summary backfill task",
			status: "draft",
		});
		await upsertPricingRow({
			provider: "openai",
			model: "summary-backfill-model",
			currencyCode: "USD",
			inputPer1m: 100,
			outputPer1m: 200,
			manualOverride: true,
			enabled: true,
		});
		const now = new Date();
		await db.insert(llmUsageRecords).values({
			createdAt: now,
			updatedAt: now,
			taskId: task.id,
			callId: crypto.randomUUID(),
			provider: "openai",
			model: "summary-backfill-model",
			label: "raw-only",
			usageMode: "measured",
			inputTokens: 200,
			outputTokens: 100,
			totalTokens: 300,
			durationMs: 250,
		});

		await expect(
			rebuildLlmUsageSummary({
				repositoryId: createdRepo.id,
				dryRun: true,
			}),
		).resolves.toMatchObject({
			dryRun: true,
			selectedRecords: 1,
			existingSummaryBuckets: 0,
		});

		await expect(
			rebuildLlmUsageSummary({ repositoryId: createdRepo.id }),
		).resolves.toMatchObject({
			dryRun: false,
			selectedRecords: 1,
			updatedSummaryBuckets: 1,
		});
		await expect(
			checkLlmUsageSummaryIntegrity({ repositoryId: createdRepo.id }),
		).resolves.toMatchObject({ ok: true });

		await db
			.update(llmUsageSummaryBuckets)
			.set({
				inputTokens: sql`${llmUsageSummaryBuckets.inputTokens} + 1`,
			})
			.where(eq(llmUsageSummaryBuckets.repositoryKey, createdRepo.id));

		const drift = await checkLlmUsageSummaryIntegrity({
			repositoryId: createdRepo.id,
		});
		expect(drift.ok).toBe(false);
		expect(drift.mismatches).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ field: "inputTokens" }),
			]),
		);
	});

	it("backfills from the start of the affected hour when since is inside a bucket", async () => {
		const createdRepo = await repo.createRepository({
			name: `TEST: LLM Summary Since ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: createdRepo.id,
			title: "TEST: LLM summary since task",
			status: "draft",
		});
		await upsertPricingRow({
			provider: "openai",
			model: "summary-since-model",
			currencyCode: "USD",
			inputPer1m: 100,
			outputPer1m: 200,
			manualOverride: true,
			enabled: true,
		});
		const bucketStart = new Date("2026-07-08T01:00:00.000Z");
		await db.insert(llmUsageRecords).values([
			{
				createdAt: new Date("2026-07-08T01:05:00.000Z"),
				updatedAt: bucketStart,
				taskId: task.id,
				callId: crypto.randomUUID(),
				provider: "openai",
				model: "summary-since-model",
				label: "before-since",
				usageMode: "measured",
				inputTokens: 100,
				outputTokens: 50,
				totalTokens: 150,
				durationMs: 100,
			},
			{
				createdAt: new Date("2026-07-08T01:45:00.000Z"),
				updatedAt: bucketStart,
				taskId: task.id,
				callId: crypto.randomUUID(),
				provider: "openai",
				model: "summary-since-model",
				label: "after-since",
				usageMode: "measured",
				inputTokens: 300,
				outputTokens: 150,
				totalTokens: 450,
				durationMs: 300,
			},
		]);

		await expect(
			rebuildLlmUsageSummary({
				repositoryId: createdRepo.id,
				since: new Date("2026-07-08T01:30:00.000Z"),
			}),
		).resolves.toMatchObject({
			selectedRecords: 2,
			updatedSummaryBuckets: 1,
		});

		await expect(
			checkLlmUsageSummaryIntegrity({
				repositoryId: createdRepo.id,
				since: new Date("2026-07-08T01:30:00.000Z"),
			}),
		).resolves.toMatchObject({
			ok: true,
			checkedRecords: 2,
			expectedBuckets: 1,
			actualBuckets: 1,
		});
	});
});
