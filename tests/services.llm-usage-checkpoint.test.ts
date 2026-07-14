import crypto from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	agentModeSessions,
	llmUsageCounterCheckpoints,
	llmUsageRecords,
	llmUsageSummaryBuckets,
} from "../api/db/schema";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { recordLlmUsage } from "../api/services/llm-usage";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("LLM usage checkpoint normalization", () => {
	it("stores cumulative Codex snapshots as deltas and is replay safe", async () => {
		const repository = await repo.createRepository({
			name: `TEST: usage checkpoint ${crypto.randomUUID()}`,
			localPath: "/tmp/usage-checkpoint",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "TEST: usage checkpoint",
			status: "draft",
		});
		const [session] = await db
			.insert(agentModeSessions)
			.values({
				taskId: task.id,
				repositoryId: repository.id,
				epoch: 1,
				executionMode: "implementation",
				llmRole: "implementation",
				runtimeLane: "codex-sdk",
				provider: "codex",
				providerEndpointId: "codex-default",
				model: "gpt-5",
				thinkingDepth: "high",
				routeFingerprint: crypto.randomUUID(),
				status: "active",
				openedAt: new Date(),
			})
			.returning();
		if (!session) throw new Error("session fixture was not created");

		const input = {
			taskId: task.id,
			provider: "codex",
			model: "gpt-5",
			label: "codex-runtime",
			durationMs: 1,
			agentModeSessionId: session.id,
			providerSessionKey: "thread-1",
			counterScope: "provider_session_cumulative" as const,
			usage: {
				inputTokens: 556_913,
				cachedInputTokens: 500_736,
				outputTokens: 3_150,
				reasoningOutputTokens: null,
				totalTokens: 560_063,
				mode: "measured" as const,
			},
		};
		await recordLlmUsage({ ...input, callId: "usage-call-1" });
		await recordLlmUsage({
			...input,
			callId: "usage-call-2",
			usage: {
				...input.usage,
				inputTokens: 8_873_949,
				cachedInputTokens: 8_654_336,
				outputTokens: 28_406,
				totalTokens: 8_902_355,
			},
		});
		await recordLlmUsage({ ...input, callId: "usage-call-2" });

		const records = await db
			.select()
			.from(llmUsageRecords)
			.where(eq(llmUsageRecords.agentModeSessionId, session.id))
			.orderBy(asc(llmUsageRecords.createdAt));
		expect(records).toHaveLength(2);
		expect(records.map((record) => record.inputTokens)).toEqual([
			556_913, 8_317_036,
		]);
		expect(records[1]).toMatchObject({
			cachedInputTokens: 8_153_600,
			outputTokens: 25_256,
			usageNormalizationStatus: "delta",
		});
		const [checkpoint] = await db
			.select()
			.from(llmUsageCounterCheckpoints)
			.where(
				and(
					eq(llmUsageCounterCheckpoints.agentModeSessionId, session.id),
					eq(llmUsageCounterCheckpoints.providerSessionKey, "thread-1"),
				),
			);
		expect(checkpoint?.rawInputTokens).toBe(8_873_949);
		const [summary] = await db
			.select()
			.from(llmUsageSummaryBuckets)
			.where(eq(llmUsageSummaryBuckets.repositoryKey, repository.id));
		expect(summary?.inputTokens).toBe(8_873_949);
	});
});
