import { z } from "@hono/zod-openapi";

type JsonSchema = Record<string, unknown>;

export function validateJsonSchemaValue(
	schema: JsonSchema,
	value: unknown,
): { success: true } | { success: false; message: string } {
	const issue = validate(schema, value, "arguments");
	return issue ? { success: false, message: issue } : { success: true };
}

function validate(
	schema: JsonSchema,
	value: unknown,
	path: string,
): string | null {
	const allowedTypes = Array.isArray(schema.type)
		? schema.type.filter((type): type is string => typeof type === "string")
		: typeof schema.type === "string"
			? [schema.type]
			: [];
	if (
		allowedTypes.length &&
		!allowedTypes.some((type) => hasType(type, value))
	) {
		return `${path} must be ${allowedTypes.join(" or ")}`;
	}
	if (value === null) return null;
	if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
		return `${path} must be one of ${schema.enum.join(", ")}`;
	}
	if (typeof value === "string") {
		if (schema.format === "uuid" && !z.string().uuid().safeParse(value).success)
			return `${path} must be a UUID`;
		if (typeof schema.minLength === "number" && value.length < schema.minLength)
			return `${path} is shorter than ${schema.minLength}`;
	}
	if (
		typeof value === "number" &&
		typeof schema.minimum === "number" &&
		value < schema.minimum
	) {
		return `${path} must be at least ${schema.minimum}`;
	}
	if (Array.isArray(value)) {
		const itemSchema = asSchema(schema.items);
		if (!itemSchema) return null;
		for (let index = 0; index < value.length; index++) {
			const issue = validate(itemSchema, value[index], `${path}[${index}]`);
			if (issue) return issue;
		}
		return null;
	}
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const properties = asSchemaMap(schema.properties);
	const required = Array.isArray(schema.required)
		? schema.required.filter((key): key is string => typeof key === "string")
		: [];
	for (const key of required) {
		if (record[key] === undefined) return `${path}.${key} is required`;
	}
	if (schema.additionalProperties === false) {
		const extra = Object.keys(record).find((key) => !(key in properties));
		if (extra) return `${path}.${extra} is not allowed`;
	}
	for (const [key, childSchema] of Object.entries(properties)) {
		if (record[key] === undefined) continue;
		const issue = validate(childSchema, record[key], `${path}.${key}`);
		if (issue) return issue;
	}
	return null;
}

function hasType(type: string, value: unknown) {
	switch (type) {
		case "null":
			return value === null;
		case "object":
			return (
				Boolean(value) && typeof value === "object" && !Array.isArray(value)
			);
		case "array":
			return Array.isArray(value);
		case "string":
			return typeof value === "string";
		case "integer":
			return typeof value === "number" && Number.isInteger(value);
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "boolean":
			return typeof value === "boolean";
		default:
			return true;
	}
}

function asSchema(value: unknown): JsonSchema | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonSchema)
		: null;
}

function asSchemaMap(value: unknown): Record<string, JsonSchema> {
	const schema = asSchema(value);
	if (!schema) return {};
	return Object.fromEntries(
		Object.entries(schema).flatMap(([key, child]) => {
			const childSchema = asSchema(child);
			return childSchema ? [[key, childSchema]] : [];
		}),
	);
}
