export function validateTaskOperatorJsonSchema(
	schema: Record<string, unknown>,
	value: unknown,
	path = "arguments",
): string | null {
	if (Array.isArray(schema.type)) {
		const errors = schema.type.map((type) =>
			validateTaskOperatorJsonSchema({ ...schema, type }, value, path),
		);
		if (errors.some((error) => error === null)) return null;
		return errors[0] ?? `${path} has an invalid type`;
	}
	if (
		Array.isArray(schema.enum) &&
		!schema.enum.some((candidate) => Object.is(candidate, value))
	)
		return `${path} must be one of the allowed values`;
	if (schema.type === "null")
		return value === null ? null : `${path} must be null`;
	if (schema.type === "object") return validateObject(schema, value, path);
	if (schema.type === "string") return validateString(schema, value, path);
	if (schema.type === "boolean" && typeof value !== "boolean")
		return `${path} must be a boolean`;
	if (
		schema.type === "integer" &&
		(!Number.isInteger(value) ||
			(typeof schema.minimum === "number" &&
				(value as number) < schema.minimum))
	)
		return `${path} must be a non-negative integer`;
	if (schema.type === "array") return validateArray(schema, value, path);
	return null;
}

function validateObject(
	schema: Record<string, unknown>,
	value: unknown,
	path: string,
) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return `${path} must be an object`;
	const record = value as Record<string, unknown>;
	for (const required of Array.isArray(schema.required) ? schema.required : [])
		if (!((required as string) in record))
			return `${path}.${String(required)} is required`;
	const properties =
		schema.properties && typeof schema.properties === "object"
			? (schema.properties as Record<string, Record<string, unknown>>)
			: {};
	if (schema.additionalProperties === false)
		for (const key of Object.keys(record))
			if (!properties[key]) return `${path}.${key} is not allowed`;
	for (const [key, child] of Object.entries(properties))
		if (key in record) {
			const error = validateTaskOperatorJsonSchema(
				child,
				record[key],
				`${path}.${key}`,
			);
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
		return `${path} must not be empty`;
	if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
		return `${path} must contain at most ${schema.maxLength} characters`;
	if (
		typeof schema.pattern === "string" &&
		!new RegExp(schema.pattern).test(value)
	)
		return `${path} has an invalid format`;
	if (
		schema.format === "uuid" &&
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			value,
		)
	)
		return `${path} must be a UUID`;
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
	if (schema.items && typeof schema.items === "object")
		for (const [index, item] of value.entries()) {
			const error = validateTaskOperatorJsonSchema(
				schema.items as Record<string, unknown>,
				item,
				`${path}[${index}]`,
			);
			if (error) return error;
		}
	return null;
}
