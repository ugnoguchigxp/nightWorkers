import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../../db/client";
import { llmUsageRecords, tasks } from "../../db/schema";
import {
	calculateUsageCost,
	findPricingForUsage,
} from "../../services/pricing";
import {
	convertCurrency,
	type NightWorkersCurrency,
	type readFxRateCache,
} from "../../services/settings/general-settings";
import {
	calculateOutputTokensPerSecond,
	normalizeTotal,
} from "./overview-usage-aggregation";

export async function buildRecentExpensiveCalls(input: {
	cutoff: Date | null;
	repositoryId?: string | null;
	currency: NightWorkersCurrency;
	fxCache: ReturnType<typeof readFxRateCache>;
}) {
	const conditions = [];
	if (input.cutoff)
		conditions.push(gte(llmUsageRecords.createdAt, input.cutoff));
	if (input.repositoryId)
		conditions.push(eq(tasks.repositoryId, input.repositoryId));
	const rows = await db
		.select({
			id: llmUsageRecords.id,
			taskId: llmUsageRecords.taskId,
			runId: llmUsageRecords.runId,
			provider: llmUsageRecords.provider,
			model: llmUsageRecords.model,
			label: llmUsageRecords.label,
			usageMode: llmUsageRecords.usageMode,
			inputTokens: llmUsageRecords.inputTokens,
			outputTokens: llmUsageRecords.outputTokens,
			cachedInputTokens: llmUsageRecords.cachedInputTokens,
			reasoningOutputTokens: llmUsageRecords.reasoningOutputTokens,
			stateCardTokens: llmUsageRecords.stateCardTokens,
			totalTokens: llmUsageRecords.totalTokens,
			durationMs: llmUsageRecords.durationMs,
			createdAt: llmUsageRecords.createdAt,
			repositoryId: tasks.repositoryId,
			taskTitle: tasks.title,
		})
		.from(llmUsageRecords)
		.leftJoin(tasks, eq(llmUsageRecords.taskId, tasks.id))
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(desc(llmUsageRecords.createdAt))
		.limit(100);

	const recentCalls = await Promise.all(
		rows.map(async (row) => {
			const pricing = await findPricingForUsage({
				provider: row.provider,
				model: row.model,
				createdAt: row.createdAt,
			});
			const cost = pricing
				? calculateUsageCost({
						inputTokens: row.inputTokens,
						outputTokens: row.outputTokens,
						cachedInputTokens: row.cachedInputTokens,
						reasoningOutputTokens: row.reasoningOutputTokens,
						pricing,
					})
				: null;
			const isCredits = pricing?.currencyCode === "CREDITS";
			const estimatedCost =
				cost && pricing && !isCredits
					? convertCurrency({
							amount: cost.totalCost,
							from: pricing.currencyCode as NightWorkersCurrency,
							to: input.currency,
							cache: input.fxCache,
						}).amount
					: null;
			return {
				id: row.id,
				taskId: row.taskId,
				runId: row.runId,
				repositoryId: row.repositoryId,
				taskTitle: row.taskTitle,
				provider: row.provider,
				model: row.model,
				label: row.label,
				inputTokens: row.inputTokens ?? 0,
				cachedInputTokens: row.cachedInputTokens ?? 0,
				outputTokens: row.outputTokens ?? 0,
				stateCardTokens: row.stateCardTokens ?? 0,
				totalTokens: normalizeTotal(row),
				outputTokensPerSecond: calculateOutputTokensPerSecond(row),
				estimatedCost,
				estimatedCredits: isCredits && cost ? cost.totalCost : null,
				usageMode: row.usageMode,
				createdAt: row.createdAt.toISOString(),
			};
		}),
	);

	return recentCalls
		.sort(
			(a, b) =>
				(b.estimatedCost ?? 0) - (a.estimatedCost ?? 0) ||
				(b.estimatedCredits ?? 0) - (a.estimatedCredits ?? 0) ||
				b.totalTokens - a.totalTokens,
		)
		.slice(0, 12);
}
