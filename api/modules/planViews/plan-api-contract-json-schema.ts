const jsonSchemaTypes = new Set([
	"null",
	"boolean",
	"object",
	"array",
	"number",
	"string",
	"integer",
]);

export function parseJsonSchemaObject(
	schemaJson: string,
	label: string,
): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(schemaJson);
	} catch {
		throw new Error(`${label} did not contain valid JSON Schema JSON.`);
	}
	if (!isRecord(parsed)) {
		throw new Error(`${label} must be a JSON Schema object.`);
	}
	validateJsonSchemaKeywordShapes(parsed, label);
	return parsed;
}

export function collectLocalComponentReferences(value: unknown): string[] {
	if (!isRecord(value)) return [];
	const references = [...localComponentNameFromReference(value.$ref)];
	for (const keyword of [
		"properties",
		"patternProperties",
		"$defs",
		"dependentSchemas",
	]) {
		const children = value[keyword];
		if (!isRecord(children)) continue;
		references.push(
			...Object.values(children).flatMap(collectLocalComponentReferences),
		);
	}
	for (const keyword of singleSubschemaKeywords) {
		references.push(...collectLocalComponentReferences(value[keyword]));
	}
	for (const keyword of arraySubschemaKeywords) {
		const children = value[keyword];
		if (Array.isArray(children)) {
			references.push(...children.flatMap(collectLocalComponentReferences));
		}
	}
	return references;
}

export function inferJsonSchemaStrictness(
	schema: unknown,
): "strict" | "passthrough" | "unknown" {
	if (!isRecord(schema)) return "unknown";
	if (schema.additionalProperties === false) return "strict";
	if (schema.additionalProperties === true) return "passthrough";
	return "unknown";
}

const singleSubschemaKeywords = [
	"items",
	"contains",
	"additionalProperties",
	"propertyNames",
	"not",
	"if",
	"then",
	"else",
	"unevaluatedProperties",
	"unevaluatedItems",
] as const;

const arraySubschemaKeywords = [
	"prefixItems",
	"allOf",
	"anyOf",
	"oneOf",
] as const;

function localComponentNameFromReference(value: unknown): string[] {
	if (value === undefined) return [];
	if (typeof value !== "string") {
		throw new Error("JSON Schema $ref must be a string.");
	}
	const prefix = "#/components/schemas/";
	if (!value.startsWith(prefix)) return [];
	const encodedName = value.slice(prefix.length).split("/")[0] ?? "";
	const name = encodedName.replaceAll("~1", "/").replaceAll("~0", "~");
	return [name];
}

function validateJsonSchemaKeywordShapes(
	value: unknown,
	label: string,
	path = "$",
) {
	if (typeof value === "boolean") return;
	if (!isRecord(value)) {
		throw new Error(
			`${label} ${path} must be a JSON Schema object or boolean.`,
		);
	}
	if (value.$ref !== undefined && typeof value.$ref !== "string") {
		throw new Error(`${label} ${path}.$ref must be a string.`);
	}
	if (value.type !== undefined) {
		const types = Array.isArray(value.type) ? value.type : [value.type];
		if (
			types.length === 0 ||
			types.some(
				(type) => typeof type !== "string" || !jsonSchemaTypes.has(type),
			)
		) {
			throw new Error(`${label} ${path}.type is not a valid JSON Schema type.`);
		}
	}
	if (
		value.required !== undefined &&
		(!Array.isArray(value.required) ||
			value.required.some((name) => typeof name !== "string"))
	) {
		throw new Error(`${label} ${path}.required must be an array of strings.`);
	}
	if (value.enum !== undefined && !Array.isArray(value.enum)) {
		throw new Error(`${label} ${path}.enum must be an array.`);
	}

	for (const keyword of [
		"properties",
		"patternProperties",
		"$defs",
		"dependentSchemas",
	]) {
		const children = value[keyword];
		if (children === undefined) continue;
		if (!isRecord(children)) {
			throw new Error(`${label} ${path}.${keyword} must be an object.`);
		}
		for (const [name, child] of Object.entries(children)) {
			validateJsonSchemaKeywordShapes(
				child,
				label,
				`${path}.${keyword}.${name}`,
			);
		}
	}
	for (const keyword of singleSubschemaKeywords) {
		const child = value[keyword];
		if (child === undefined) continue;
		validateJsonSchemaKeywordShapes(child, label, `${path}.${keyword}`);
	}
	for (const keyword of arraySubschemaKeywords) {
		const children = value[keyword];
		if (children === undefined) continue;
		if (!Array.isArray(children)) {
			throw new Error(`${label} ${path}.${keyword} must be an array.`);
		}
		children.forEach((child, index) => {
			validateJsonSchemaKeywordShapes(
				child,
				label,
				`${path}.${keyword}[${index}]`,
			);
		});
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
