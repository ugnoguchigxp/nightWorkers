import { describe, expect, it } from "vitest";
import { toProviderToolCalls } from "../../api/services/structured-llm/openai-tool-call-codec";
import {
	decodeProviderToolCall,
	parseProviderToolArguments,
} from "../../api/services/structured-llm/tool-argument-codec";

const readOnlyTool = {
	name: "read_status",
	description: "状態を読む",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
};

const mutatingTool = {
	name: "write_status",
	description: "状態を更新する",
	inputSchema: {
		type: "object",
		properties: { message: { type: "string" } },
		required: ["message"],
		additionalProperties: false,
	},
};

const boundedTool = {
	name: "list_items",
	description: "項目を読む",
	inputSchema: {
		type: "object",
		properties: {
			limit: { type: "integer", minimum: 1, maximum: 100 },
		},
		required: ["limit"],
		additionalProperties: false,
	},
};

const oneOfTool = {
	name: "control",
	description: "状態を制御する",
	inputSchema: {
		oneOf: [
			{
				type: "object",
				properties: {
					op: { type: "string", const: "start" },
					token: { type: "string", pattern: "^run_[a-z]+$" },
				},
				required: ["op", "token"],
				additionalProperties: false,
			},
			{
				type: "object",
				properties: { op: { type: "string", const: "stop" } },
				required: ["op"],
				additionalProperties: false,
			},
		],
	},
};

describe("provider tool argument codec", () => {
	it.each([
		["invalid JSON", "{not-json", "invalid_json"],
		["array", "[]", "non_object"],
		["null", "null", "non_object"],
		["number", "1", "non_object"],
		["string", '"value"', "non_object"],
	] as const)("keeps %s as an invalid argument result", (_name, raw, failure) => {
		expect(parseProviderToolArguments(raw)).toEqual({
			ok: false,
			raw,
			failure,
		});
	});

	it("accepts an empty string only when the target schema accepts an empty object", () => {
		expect(
			decodeProviderToolCall({
				provider: "fixture",
				call: { id: "read-1", name: "read_status", arguments: "" },
				tools: [readOnlyTool, mutatingTool],
			}),
		).toEqual({ id: "read-1", name: "read_status", arguments: {} });

		expect(() =>
			decodeProviderToolCall({
				provider: "fixture",
				call: { id: "write-1", name: "write_status", arguments: "" },
				tools: [readOnlyTool, mutatingTool],
			}),
		).toThrow(/invalid arguments/);
	});

	it("rejects schema mismatches and unknown tools before dispatch while retaining raw input", () => {
		const error = (() => {
			try {
				decodeProviderToolCall({
					provider: "fixture",
					call: {
						id: "write-2",
						name: "write_status",
						arguments: '{"unexpected":true}',
					},
					tools: [readOnlyTool, mutatingTool],
					content: "本文は保持する",
				});
			} catch (caught) {
				return caught;
			}
			throw new Error("expected a schema failure");
		})();
		expect(error).toMatchObject({
			name: "StructuredProviderError",
			kind: "invalid_response",
			code: "INVALID_TOOL_ARGUMENTS",
			retryable: false,
		});
		expect((error as { providerBody?: string }).providerBody).toContain(
			'{\\"unexpected\\":true}',
		);
		expect((error as { providerBody?: string }).providerBody).toContain(
			"本文は保持する",
		);
	});

	it("enforces numeric schema bounds before dispatch", () => {
		for (const argumentsJson of ['{"limit":0}', '{"limit":101}']) {
			expect(() =>
				decodeProviderToolCall({
					provider: "fixture",
					call: {
						id: "bounded-invalid",
						name: "list_items",
						arguments: argumentsJson,
					},
					tools: [boundedTool],
				}),
			).toThrow(/invalid arguments/);
		}
		expect(
			decodeProviderToolCall({
				provider: "fixture",
				call: {
					id: "bounded-valid",
					name: "list_items",
					arguments: '{"limit":100}',
				},
				tools: [boundedTool],
			}),
		).toEqual({
			id: "bounded-valid",
			name: "list_items",
			arguments: { limit: 100 },
		});
	});

	it("enforces oneOf, const, and pattern constraints before dispatch", () => {
		for (const argumentsJson of [
			'{"op":"start","token":"invalid"}',
			'{"op":"delete"}',
		]) {
			expect(() =>
				decodeProviderToolCall({
					provider: "fixture",
					call: {
						id: "control-invalid",
						name: "control",
						arguments: argumentsJson,
					},
					tools: [oneOfTool],
				}),
			).toThrow(/invalid arguments/);
		}
		expect(
			decodeProviderToolCall({
				provider: "fixture",
				call: {
					id: "control-valid",
					name: "control",
					arguments: '{"op":"start","token":"run_ready"}',
				},
				tools: [oneOfTool],
			}),
		).toEqual({
			id: "control-valid",
			name: "control",
			arguments: { op: "start", token: "run_ready" },
		});
	});

	it("applies the same failure contract to OpenAI-compatible tool calls", () => {
		const error = (() => {
			try {
				toProviderToolCalls({
					provider: "OpenAI",
					calls: [
						{
							id: "openai-1",
							function: { name: "read_status", arguments: "[]" },
						},
					],
					tools: [readOnlyTool],
				});
			} catch (caught) {
				return caught;
			}
			throw new Error("expected an invalid response");
		})();
		expect(error).toMatchObject({
			kind: "invalid_response",
			code: "INVALID_TOOL_ARGUMENTS",
			retryable: false,
		});
		expect((error as { providerBody?: string }).providerBody).toContain("[]");
	});
});
