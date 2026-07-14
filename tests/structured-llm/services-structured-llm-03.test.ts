import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	callStructuredLlmResult,
	callSupervisorLLM,
	createStructuredOutputContract,
} from "../../api/services/structured-llm";
import { installStructuredLlmEnvHooks } from "./structured-llm-test-env";

describe("Supervisor LLM schema-first parsing", () => {
	installStructuredLlmEnvHooks();

	it("requires explicit fixture JSON instead of falling back to hardcoded tool calls", async () => {
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
		delete process.env.SUPERVISOR_FIXTURE_ROUND2_OUTPUT;

		await expect(
			callSupervisorLLM("system", JSON.stringify({ toolResults: [] }), {
				round: 2,
				schemaFirst: true,
			}),
		).rejects.toThrow(/SUPERVISOR_FIXTURE_ROUND2_OUTPUT/);
	});

	it("uses explicit fixture JSON for structured JSON calls", async () => {
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
			title: "Configured fixture output",
			items: ["one"],
		});

		const result = await callStructuredLlmResult("system", "user", {
			contract: createStructuredOutputContract({
				name: "example_schema",
				runtimeSchema: z
					.object({ title: z.string(), items: z.array(z.string()) })
					.strict(),
			}),
		});

		expect(result).toMatchObject({
			ok: true,
			value: {
				title: "Configured fixture output",
				items: ["one"],
			},
		});
	});

	it("returns non-JSON structured fixture output as parse failure data", async () => {
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		process.env.SUPERVISOR_FIXTURE_OUTPUT = "plain fixture text";

		const result = await callStructuredLlmResult("system", "user", {
			contract: createStructuredOutputContract({
				name: "example_schema",
				runtimeSchema: z.object({}).strict(),
			}),
		});

		expect(result).toMatchObject({
			ok: false,
			attempt: { rawText: "plain fixture text" },
			issues: [{ stage: "parse", code: "invalid_json" }],
		});
	});

	it("returns a typed value without changing semantic fields", async () => {
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
			verdict: "revise",
			note: "モデル自身の判断",
		});
		const contract = createStructuredOutputContract({
			name: "semantic_preservation",
			runtimeSchema: z
				.object({ verdict: z.enum(["pass", "revise"]), note: z.string() })
				.strict(),
		});

		const result = await callStructuredLlmResult("system", "user", {
			contract,
		});

		expect(result).toMatchObject({
			ok: true,
			value: { verdict: "revise", note: "モデル自身の判断" },
			attempt: { rawText: process.env.SUPERVISOR_FIXTURE_OUTPUT },
		});
	});

	it("keeps extraction and syntax repair provenance separate", async () => {
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		process.env.SUPERVISOR_FIXTURE_OUTPUT = '```json\n{"answer":"ok"}\n```';
		const contract = createStructuredOutputContract({
			name: "extracted_json",
			runtimeSchema: z.object({ answer: z.string() }).strict(),
		});

		const extracted = await callStructuredLlmResult("system", "user", {
			contract,
		});

		expect(extracted).toMatchObject({
			ok: true,
			attempt: {
				extractedText: '{"answer":"ok"}',
				repairedText: null,
				repairKind: "extracted_candidate",
			},
		});

		process.env.SUPERVISOR_FIXTURE_OUTPUT = '{"answer":"ok"';
		const repaired = await callStructuredLlmResult("system", "user", {
			contract,
		});

		expect(repaired).toMatchObject({
			ok: true,
			attempt: {
				extractedText: '{"answer":"ok"',
				repairedText: '{"answer":"ok"}',
				repairKind: "balanced_json",
			},
		});
	});

	it("rejects schema defaults and unknown-field stripping as non-lossless", async () => {
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		process.env.SUPERVISOR_FIXTURE_OUTPUT = '{"answer":"ok"}';

		const defaulted = await callStructuredLlmResult("system", "user", {
			contract: createStructuredOutputContract({
				name: "defaulted_schema",
				runtimeSchema: z.object({
					answer: z.string(),
					note: z.string().default("fixed note"),
				}),
			}),
		});

		expect(defaulted).toMatchObject({
			ok: false,
			attempt: { rawText: '{"answer":"ok"}' },
			issues: [{ code: "non_lossless_schema_parse" }],
		});

		process.env.SUPERVISOR_FIXTURE_OUTPUT =
			'{"answer":"ok","implementationFallback":"fixed"}';
		const stripped = await callStructuredLlmResult("system", "user", {
			contract: createStructuredOutputContract({
				name: "stripping_schema",
				runtimeSchema: z.object({ answer: z.string() }),
			}),
		});

		expect(stripped).toMatchObject({
			ok: false,
			attempt: {
				rawText: '{"answer":"ok","implementationFallback":"fixed"}',
			},
			issues: [{ code: "non_lossless_schema_parse" }],
		});
	});

	it("returns raw model text and issue paths on schema failure", async () => {
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		process.env.SUPERVISOR_FIXTURE_OUTPUT =
			'{"verdict":"revise","score":"high"}';
		const contract = createStructuredOutputContract({
			name: "schema_failure",
			runtimeSchema: z
				.object({ verdict: z.string(), score: z.number() })
				.strict(),
		});

		const result = await callStructuredLlmResult("system", "user", {
			contract,
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.attempt.rawText).toBe(process.env.SUPERVISOR_FIXTURE_OUTPUT);
		expect(result.issues).toContainEqual(
			expect.objectContaining({ stage: "schema", path: ["score"] }),
		);
	});

	it("returns raw non-JSON model text instead of a fixed response", async () => {
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		process.env.SUPERVISOR_FIXTURE_OUTPUT = "JSONではないモデル本文";
		const contract = createStructuredOutputContract({
			name: "parse_failure",
			runtimeSchema: z.object({ answer: z.string() }).strict(),
		});

		const result = await callStructuredLlmResult("system", "user", {
			contract,
		});

		expect(result).toMatchObject({
			ok: false,
			attempt: { rawText: "JSONではないモデル本文" },
			issues: [expect.objectContaining({ stage: "parse" })],
		});
	});
});
