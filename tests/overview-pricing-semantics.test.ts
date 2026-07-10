import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../api/app";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { recordLlmUsage } from "../api/services/llm-usage";
import { upsertPricingRow } from "../api/services/pricing";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("Overview pricing semantics", () => {
	it("keeps credits separate from configured currency costs", async () => {
		const model = `test-credit-model-${crypto.randomUUID()}`;
		const repository = await repo.createRepository({
			name: `TEST: Overview credits ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "TEST: Overview credit task",
			status: "draft",
		});
		await upsertPricingRow({
			provider: "test-credit-provider",
			model,
			currencyCode: "CREDITS",
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
			provider: "test-credit-provider",
			model,
			label: "credit-call",
			usage: {
				inputTokens: 1_000,
				outputTokens: 500,
				cachedInputTokens: 100,
				reasoningOutputTokens: null,
				totalTokens: 1_500,
				mode: "measured",
			},
			durationMs: 1_000,
		});

		const response = await app.request(
			`http://localhost/api/overview?range=30d&repositoryId=${repository.id}&currency=JPY`,
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.cost).toMatchObject({
			estimatedTotal: null,
			inputCost: null,
			cachedInputCost: null,
			outputCost: null,
			creditTotal: expect.any(Number),
		});
		expect(body.modelBreakdown).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					model,
					estimatedCost: null,
					estimatedCredits: expect.any(Number),
				}),
			]),
		);
		expect(body.recentExpensiveCalls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					model,
					estimatedCost: null,
					estimatedCredits: expect.any(Number),
				}),
			]),
		);
	});
});
