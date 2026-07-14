import { describe, expect, it } from "vitest";
import { resolveCodexOutputSchemaMode } from "../../api/services/structured-llm/codex-output-schema";

describe("Codex structured LLM output schema routing", () => {
	it("uses native outputSchema for a strict required object", () => {
		expect(
			resolveCodexOutputSchemaMode({
				type: "object",
				additionalProperties: false,
				required: ["answer"],
				properties: { answer: { type: "string" } },
			}),
		).toEqual({ mode: "native_schema", reasons: [] });
	});

	it("uses prompt validation for schemas unsupported by strict mode", () => {
		const optional = resolveCodexOutputSchemaMode({
			type: "object",
			additionalProperties: false,
			properties: { answer: { type: "string" } },
		});
		expect(optional.mode).toBe("prompt_validated_json");
		expect(optional.reasons).toContain("optional_object_property:$");

		const open = resolveCodexOutputSchemaMode({
			type: "object",
			additionalProperties: true,
			required: [],
			properties: {},
		});
		expect(open.mode).toBe("prompt_validated_json");
		expect(open.reasons).toContain("non_strict_object:$");
	});

	it("does not inspect schema names or product vocabulary", () => {
		expect(resolveCodexOutputSchemaMode(undefined)).toEqual({
			mode: "prompt_validated_json",
			reasons: ["schema_missing"],
		});
	});
});
