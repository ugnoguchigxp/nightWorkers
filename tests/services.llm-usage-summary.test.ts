import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { llmUsageRecords, llmUsageSummaryBuckets } from "../api/db/schema";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { recordLlmUsage } from "../api/services/llm-usage";
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
});
