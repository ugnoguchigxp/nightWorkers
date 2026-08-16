import {
	providerInvalidToolArgumentsError,
	type StructuredProviderError,
} from "./provider-failure";
import type { ProviderToolCall, ProviderToolDefinition } from "./tool-calls";

export type ParsedToolArguments =
	| { ok: true; value: Record<string, unknown>; raw: string }
	| { ok: false; raw: string; failure: "invalid_json" | "non_object" };

type ToolArgumentFailure =
	| "invalid_json"
	| "non_object"
	| "unknown_tool"
	| "schema_invalid";

/**
 * Parses a provider tool input without changing its meaning.  In particular,
 * non-object JSON values never become a synthetic { value } object.
 */
export function parseProviderToolArguments(
	value: unknown,
): ParsedToolArguments {
	if (typeof value === "string") return parseToolArgumentJson(value);
	const raw = serializeProviderToolArguments(value);
	return isRecord(value)
		? { ok: true, value, raw }
		: { ok: false, raw, failure: "non_object" };
}

export function decodeProviderToolCall(input: {
	provider: string;
	call: { id: string; name: string; arguments: unknown };
	tools: readonly ProviderToolDefinition[];
	content?: string;
	responseBody?: string;
}): ProviderToolCall {
	const parsed = parseProviderToolArguments(input.call.arguments);
	if (!parsed.ok) {
		throw invalidToolArgumentsError({
			...input,
			raw: parsed.raw,
			failure: parsed.failure,
		});
	}
	const definition = input.tools.find((tool) => tool.name === input.call.name);
	if (!definition) {
		throw invalidToolArgumentsError({
			...input,
			raw: parsed.raw,
			failure: "unknown_tool",
		});
	}
	const schemaError = validateProviderToolArguments(
		definition.inputSchema,
		parsed.value,
	);
	if (schemaError) {
		throw invalidToolArgumentsError({
			...input,
			raw: parsed.raw,
			failure: "schema_invalid",
			schemaError,
		});
	}
	return { id: input.call.id, name: input.call.name, arguments: parsed.value };
}

export function decodeProviderToolCalls(input: {
	provider: string;
	calls: readonly { id: string; name: string; arguments: unknown }[];
	tools: readonly ProviderToolDefinition[];
	content?: string;
	responseBody?: string;
}): ProviderToolCall[] {
	return input.calls.map((call) => decodeProviderToolCall({ ...input, call }));
}

function parseToolArgumentJson(raw: string): ParsedToolArguments {
	if (!raw.trim()) return { ok: true, value: {}, raw };
	try {
		const value: unknown = JSON.parse(raw);
		return isRecord(value)
			? { ok: true, value, raw }
			: { ok: false, raw, failure: "non_object" };
	} catch {
		return { ok: false, raw, failure: "invalid_json" };
	}
}

function invalidToolArgumentsError(input: {
	provider: string;
	call: { id: string; name: string; arguments: unknown };
	raw: string;
	failure: ToolArgumentFailure;
	content?: string;
	responseBody?: string;
	schemaError?: string;
}): StructuredProviderError {
	return providerInvalidToolArgumentsError({
		provider: input.provider,
		toolName: input.call.name,
		rawArguments: input.raw,
		failure: input.failure,
		content: input.content,
		responseBody: input.responseBody,
		...(input.schemaError ? { schemaError: input.schemaError } : {}),
	});
}

function validateProviderToolArguments(
	schema: Record<string, unknown>,
	value: Record<string, unknown>,
): string | null {
	return validateJsonSchema(schema, value, "arguments");
}

function validateJsonSchema(
	schema: unknown,
	value: unknown,
	path: string,
): string | null {
	if (schema === false) return `${path} is not allowed`;
	if (schema === true || !isRecord(schema)) return null;
	const compositionError = validateSchemaComposition(schema, value, path);
	if (compositionError) return compositionError;
	if (Array.isArray(schema.type)) {
		const errors = schema.type.map((type) =>
			validateJsonSchema({ ...schema, type }, value, path),
		);
		if (errors.some((error) => error === null)) return null;
		return errors[0] ?? `${path} has an invalid type`;
	}
	if ("const" in schema && !isJsonEqual(schema.const, value))
		return `${path} must equal the expected value`;
	if (
		Array.isArray(schema.enum) &&
		!schema.enum.some((candidate) => isJsonEqual(candidate, value))
	)
		return `${path} must be one of the allowed values`;
	if (schema.type === "null")
		return value === null ? null : `${path} must be null`;
	if (schema.type === "object") return validateObject(schema, value, path);
	if (schema.type === "string") return validateString(schema, value, path);
	if (schema.type === "boolean")
		return typeof value === "boolean" ? null : `${path} must be a boolean`;
	if (schema.type === "number" || schema.type === "integer") {
		if (typeof value !== "number" || !Number.isFinite(value))
			return `${path} must be a ${schema.type}`;
		if (schema.type === "integer" && !Number.isInteger(value))
			return `${path} must be an integer`;
		return validateNumber(schema, value, path);
	}
	if (schema.type === "array") return validateArray(schema, value, path);
	return null;
}

function validateSchemaComposition(
	schema: Record<string, unknown>,
	value: unknown,
	path: string,
) {
	const allOf = schemaList(schema.allOf);
	for (const child of allOf) {
		const error = validateJsonSchema(child, value, path);
		if (error) return error;
	}
	const anyOf = schemaList(schema.anyOf);
	if (
		anyOf.length &&
		!anyOf.some((child) => !validateJsonSchema(child, value, path))
	)
		return `${path} must match at least one allowed schema`;
	const oneOf = schemaList(schema.oneOf);
	if (
		oneOf.length &&
		oneOf.filter((child) => !validateJsonSchema(child, value, path)).length !==
			1
	)
		return `${path} must match exactly one allowed schema`;
	return null;
}

function validateObject(
	schema: Record<string, unknown>,
	value: unknown,
	path: string,
) {
	if (!isRecord(value)) return `${path} must be an object`;
	for (const required of Array.isArray(schema.required)
		? schema.required
		: []) {
		if (typeof required === "string" && !(required in value))
			return `${path}.${required} is required`;
	}
	const properties = isRecord(schema.properties) ? schema.properties : {};
	for (const [key, entry] of Object.entries(value)) {
		if (key in properties) continue;
		if (schema.additionalProperties === false)
			return `${path}.${key} is not allowed`;
		if ("additionalProperties" in schema) {
			const error = validateJsonSchema(
				schema.additionalProperties,
				entry,
				`${path}.${key}`,
			);
			if (error) return error;
		}
	}
	for (const [key, childSchema] of Object.entries(properties)) {
		if (!(key in value)) continue;
		const error = validateJsonSchema(childSchema, value[key], `${path}.${key}`);
		if (error) return error;
	}
	return null;
}

function validateString(
	schema: Record<string, unknown>,
	value: unknown,
	path: string,
) {
	if (typeof value !== "string") return `${path} must be a string`;
	if (typeof schema.minLength === "number" && value.length < schema.minLength)
		return `${path} must contain at least ${schema.minLength} characters`;
	if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
		return `${path} must contain at most ${schema.maxLength} characters`;
	if (typeof schema.pattern === "string") {
		try {
			if (!new RegExp(schema.pattern).test(value))
				return `${path} has an invalid format`;
		} catch {
			return `${path} has an invalid schema pattern`;
		}
	}
	return null;
}

function validateNumber(
	schema: Record<string, unknown>,
	value: number,
	path: string,
) {
	if (typeof schema.minimum === "number" && value < schema.minimum)
		return `${path} must be at least ${schema.minimum}`;
	if (typeof schema.maximum === "number" && value > schema.maximum)
		return `${path} must be at most ${schema.maximum}`;
	if (
		typeof schema.exclusiveMinimum === "number" &&
		value <= schema.exclusiveMinimum
	)
		return `${path} must be greater than ${schema.exclusiveMinimum}`;
	if (
		typeof schema.exclusiveMaximum === "number" &&
		value >= schema.exclusiveMaximum
	)
		return `${path} must be less than ${schema.exclusiveMaximum}`;
	if (
		typeof schema.multipleOf === "number" &&
		schema.multipleOf > 0 &&
		!isMultipleOf(value, schema.multipleOf)
	)
		return `${path} must be a multiple of ${schema.multipleOf}`;
	return null;
}

function validateArray(
	schema: Record<string, unknown>,
	value: unknown,
	path: string,
) {
	if (!Array.isArray(value)) return `${path} must be an array`;
	if (typeof schema.minItems === "number" && value.length < schema.minItems)
		return `${path} must contain at least ${schema.minItems} item(s)`;
	if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
		return `${path} must contain at most ${schema.maxItems} item(s)`;
	if (!("items" in schema)) return null;
	for (const [index, item] of value.entries()) {
		const error = validateJsonSchema(schema.items, item, `${path}[${index}]`);
		if (error) return error;
	}
	return null;
}

function schemaList(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function isJsonEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) && Array.isArray(right))
		return (
			left.length === right.length &&
			left.every((value, index) => isJsonEqual(value, right[index]))
		);
	if (isRecord(left) && isRecord(right)) {
		const leftKeys = Object.keys(left);
		const rightKeys = Object.keys(right);
		return (
			leftKeys.length === rightKeys.length &&
			leftKeys.every(
				(key) => key in right && isJsonEqual(left[key], right[key]),
			)
		);
	}
	return false;
}

function isMultipleOf(value: number, divisor: number) {
	const quotient = value / divisor;
	return Math.abs(quotient - Math.round(quotient)) < Number.EPSILON;
}

function serializeProviderToolArguments(value: unknown) {
	try {
		const serialized = JSON.stringify(value);
		return typeof serialized === "string" ? serialized : String(value);
	} catch {
		return String(value);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
