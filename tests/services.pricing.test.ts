import { describe, expect, it } from "vitest";
import {
	calculateUsageCost,
	findPricingForUsage,
	importPublicPricingRows,
	listPricingRowsPage,
	seedCodexPricingRows,
	upsertPricingRow,
} from "../api/services/pricing";

describe("LLM pricing calculation", () => {
	it("pages filtered pricing rows with a stable cursor and bounded page size", async () => {
		const provider = `paging-${Date.now()}`;
		for (let index = 54; index >= 0; index -= 1) {
			await upsertPricingRow({
				provider,
				model: `model-${String(index).padStart(3, "0")}`,
			});
		}
		const first = await listPricingRowsPage({ provider, limit: 50 });
		const second = await listPricingRowsPage({
			provider,
			limit: 50,
			offset: Number(first.nextCursor),
		});
		expect(first.rows).toHaveLength(50);
		expect(first.totalCount).toBe(55);
		expect(first.nextCursor).toBe("50");
		expect(second.rows).toHaveLength(5);
		expect(second.nextCursor).toBeNull();
		expect([...first.rows, ...second.rows].map((row) => row.model)).toEqual(
			Array.from(
				{ length: 55 },
				(_, index) => `model-${String(index).padStart(3, "0")}`,
			),
		);
		const filtered = await listPricingRowsPage({
			provider,
			model: "model-01",
			limit: 10_000,
		});
		expect(filtered.rows).toHaveLength(10);
		expect(filtered.rows.every((row) => row.model.includes("model-01"))).toBe(
			true,
		);
	});
	it("separates uncached and cached input tokens without double counting", () => {
		const result = calculateUsageCost({
			inputTokens: 1000,
			cachedInputTokens: 400,
			outputTokens: 500,
			reasoningOutputTokens: null,
			pricing: {
				id: "pricing-test",
				createdAt: new Date(),
				updatedAt: new Date(),
				provider: "openai",
				model: "priced-model",
				currencyCode: "USD",
				inputPer1m: 10,
				cachedInputPer1m: 1,
				outputPer1m: 20,
				reasoningOutputPer1m: null,
				sourceUrl: null,
				sourceLabel: null,
				effectiveFrom: new Date(0),
				fetchedAt: new Date(),
				manualOverride: true,
				enabled: true,
			},
		});

		expect(result.inputCost).toBeCloseTo(0.006);
		expect(result.cachedInputCost).toBeCloseTo(0.0004);
		expect(result.outputCost).toBeCloseTo(0.01);
		expect(result.totalCost).toBeCloseTo(0.0164);
	});

	it("includes reasoning output token cost when a reasoning price is configured", () => {
		const result = calculateUsageCost({
			inputTokens: 0,
			cachedInputTokens: 0,
			outputTokens: 0,
			reasoningOutputTokens: 2000,
			pricing: {
				id: "pricing-reasoning-test",
				createdAt: new Date(),
				updatedAt: new Date(),
				provider: "openai",
				model: "reasoning-priced-model",
				currencyCode: "USD",
				inputPer1m: 10,
				cachedInputPer1m: 1,
				outputPer1m: 20,
				reasoningOutputPer1m: 30,
				sourceUrl: null,
				sourceLabel: null,
				effectiveFrom: new Date(0),
				fetchedAt: new Date(),
				manualOverride: true,
				enabled: true,
			},
		});

		expect(result.reasoningCost).toBeCloseTo(0.06);
		expect(result.totalCost).toBeCloseTo(0.06);
	});

	it("seeds official Codex credit pricing rows", async () => {
		const rows = await seedCodexPricingRows();

		expect(rows).toHaveLength(3);
		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					provider: "codex",
					model: "gpt-5.4-mini",
					currencyCode: "CREDITS",
					inputPer1m: 18.75,
					cachedInputPer1m: 1.875,
					outputPer1m: 113,
				}),
			]),
		);
		expect(rows.some((row) => row.model === "gpt-5.3-codex")).toBe(false);
	});

	it("imports covered public pricing rows from LiteLLM JSON", async () => {
		const result = await importPublicPricingRows({
			fetchImpl: async () => ({
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => ({
					"gpt-5.5": {
						litellm_provider: "openai",
						input_cost_per_token: 0.000005,
						output_cost_per_token: 0.00003,
						cache_read_input_token_cost: 0.0000005,
					},
					"gpt-5.4-mini": {
						litellm_provider: "openai",
						input_cost_per_token: 0.00000075,
						output_cost_per_token: 0.0000045,
						cache_read_input_token_cost: 0.000000075,
					},
					"gpt-5.2": {
						litellm_provider: "openai",
						input_cost_per_token: 0.00000175,
						output_cost_per_token: 0.000014,
					},
					"claude-opus-4-8": {
						litellm_provider: "anthropic",
						input_cost_per_token: 0.000005,
						output_cost_per_token: 0.000025,
					},
					"claude-fable-5": {
						litellm_provider: "anthropic",
						input_cost_per_token: 0.00001,
						output_cost_per_token: 0.00005,
					},
					"claude-opus-4-1": {
						litellm_provider: "anthropic",
						input_cost_per_token: 0.000015,
						output_cost_per_token: 0.000075,
					},
					"gemini/gemini-3.5-flash": {
						litellm_provider: "gemini",
						input_cost_per_token: 0.0000015,
						output_cost_per_token: 0.000009,
					},
					"xai/grok-4": {
						litellm_provider: "xai",
						input_cost_per_token: 0.000003,
						output_cost_per_token: 0.000015,
					},
					"gemini/gemini-3-flash-preview": {
						litellm_provider: "gemini",
						input_cost_per_token: 0.0000005,
						output_cost_per_token: 0.000003,
					},
					"deepseek/deepseek-v3.2": {
						litellm_provider: "deepseek",
						input_cost_per_token: 0.00000028,
						output_cost_per_token: 0.0000004,
					},
					"fireworks_ai/deepseek-v4-pro": {
						litellm_provider: "fireworks_ai",
						input_cost_per_token: 0.0000006,
						output_cost_per_token: 0.0000018,
					},
					"fireworks_ai/deepseek-v4-flash": {
						litellm_provider: "fireworks_ai",
						input_cost_per_token: 0.0000003,
						output_cost_per_token: 0.0000009,
					},
					"openrouter/z-ai/glm-5.1": {
						litellm_provider: "openrouter",
						input_cost_per_token: 0.00000105,
						output_cost_per_token: 0.0000035,
					},
					"bedrock/us-east-1/qwen.qwen3-coder-next": {
						litellm_provider: "bedrock",
						input_cost_per_token: 0.0000005,
						output_cost_per_token: 0.0000012,
					},
					"openrouter/qwen/qwen3.6-plus": {
						litellm_provider: "openrouter",
						input_cost_per_token: 0.0000004,
						output_cost_per_token: 0.0000012,
					},
					"dashscope/qwen3.5-plus": {
						litellm_provider: "dashscope",
						input_cost_per_token: 0.0000003,
						output_cost_per_token: 0.0000009,
					},
					"openrouter/qwen/qwen-2.5-coder-32b-instruct": {
						litellm_provider: "openrouter",
						input_cost_per_token: 0.0000002,
						output_cost_per_token: 0.0000008,
					},
					"openrouter/deepseek/deepseek-v3.1": {
						litellm_provider: "openrouter",
						input_cost_per_token: 0.0000002,
						output_cost_per_token: 0.0000008,
					},
					"vercel-only-model": {
						litellm_provider: "vercel",
						input_cost_per_token: 0.000001,
						output_cost_per_token: 0.000001,
					},
					image_only_model: {
						litellm_provider: "openai",
						mode: "image_generation",
					},
				}),
			}),
			sourceUrl: "https://example.test/model_prices_and_context_window.json",
		});

		expect(result.imported).toBe(11);
		expect(result.skipped).toBe(9);
		expect(result.providers).toEqual([
			"anthropic",
			"deepseek",
			"google",
			"openai",
			"qwen",
		]);
		expect(result.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					provider: "openai",
					model: "gpt-5.5",
					inputPer1m: 5,
					cachedInputPer1m: 0.5,
					outputPer1m: 30,
				}),
				expect.objectContaining({
					provider: "openai",
					model: "gpt-5.4-mini",
					inputPer1m: 0.75,
					cachedInputPer1m: 0.075,
					outputPer1m: 4.5,
				}),
				expect.objectContaining({
					provider: "anthropic",
					model: "claude-opus-4-8",
					inputPer1m: 5,
					outputPer1m: 25,
				}),
				expect.objectContaining({
					provider: "anthropic",
					model: "claude-fable-5",
					inputPer1m: 10,
					outputPer1m: 50,
				}),
				expect.objectContaining({
					provider: "qwen",
					model: "qwen3-coder-next",
					sourceLabel: "LiteLLM model_prices_and_context_window.json (bedrock)",
				}),
			]),
		);
		expect(result.rows.map((row) => row.model).sort()).toEqual([
			"claude-fable-5",
			"claude-opus-4-8",
			"deepseek-v3.2",
			"deepseek-v4-flash",
			"deepseek-v4-pro",
			"gemini-3.5-flash",
			"gpt-5.4-mini",
			"gpt-5.5",
			"qwen3-coder-next",
			"qwen3.5-plus",
			"qwen3.6-plus",
		]);

		const qwenPricing = await findPricingForUsage({
			provider: "openai",
			model: "qwen3-coder-next",
			createdAt: new Date(),
		});
		expect(qwenPricing).toEqual(
			expect.objectContaining({
				provider: "qwen",
				model: "qwen3-coder-next",
				inputPer1m: 0.5,
				outputPer1m: 1.2,
			}),
		);

		await upsertPricingRow({
			provider: "openai",
			model: "gpt-5.5-2026-04-23",
			inputPer1m: 5,
			outputPer1m: 30,
			effectiveFrom: "2026-04-23T00:00:00.000Z",
			fetchedAt: new Date().toISOString(),
			manualOverride: false,
		});
		const visibleOpenAiRows = await listPricingRowsPage({
			provider: "openai",
			model: "gpt-5.5",
		});
		expect(visibleOpenAiRows.rows.map((row) => row.model)).toEqual(["gpt-5.5"]);
	});

	it("matches pricing when model names differ by spacing and punctuation", async () => {
		await upsertPricingRow({
			provider: "openai",
			model: "gpt-5.5",
			inputPer1m: 5,
			outputPer1m: 30,
			effectiveFrom: "1970-01-01T00:00:00.000Z",
			fetchedAt: new Date().toISOString(),
			manualOverride: false,
			enabled: true,
		});
		await upsertPricingRow({
			provider: "anthropic",
			model: "claude-opus-4-8",
			inputPer1m: 5,
			outputPer1m: 25,
			effectiveFrom: "1970-01-01T00:00:00.000Z",
			fetchedAt: new Date().toISOString(),
			manualOverride: false,
			enabled: true,
		});
		await upsertPricingRow({
			provider: "openai",
			model: "gpt-5.4-mini",
			inputPer1m: 0.75,
			cachedInputPer1m: 0.075,
			outputPer1m: 4.5,
			effectiveFrom: "1970-01-01T00:00:00.000Z",
			fetchedAt: new Date().toISOString(),
			manualOverride: false,
			enabled: true,
		});

		await expect(
			findPricingForUsage({
				provider: "openai",
				model: "GPT 5 5",
				createdAt: new Date(),
			}),
		).resolves.toEqual(
			expect.objectContaining({ provider: "openai", model: "gpt-5.5" }),
		);
		await expect(
			findPricingForUsage({
				provider: "openai",
				model: "claude opus 4.8",
				createdAt: new Date(),
			}),
		).resolves.toEqual(
			expect.objectContaining({
				provider: "anthropic",
				model: "claude-opus-4-8",
			}),
		);
		await expect(
			findPricingForUsage({
				provider: "azure-openai",
				model: "gpt 5.4 mini",
				createdAt: new Date(),
			}),
		).resolves.toEqual(
			expect.objectContaining({ provider: "openai", model: "gpt-5.4-mini" }),
		);
	});
});
