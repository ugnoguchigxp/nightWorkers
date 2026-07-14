export type CodexOutputSchemaMode = {
	mode: "native_schema" | "prompt_validated_json";
	reasons: string[];
};

const CODEX_NATIVE_SCHEMA_MAX_BYTES = 32_000;

export function resolveCodexOutputSchemaMode(
	schema: unknown,
): CodexOutputSchemaMode {
	if (schema === undefined || schema === null) {
		return { mode: "prompt_validated_json", reasons: ["schema_missing"] };
	}
	const reasons = inspectSchema(schema);
	const bytes = Buffer.byteLength(JSON.stringify(schema), "utf8");
	if (bytes > CODEX_NATIVE_SCHEMA_MAX_BYTES) reasons.push("schema_too_large");
	return reasons.length > 0
		? { mode: "prompt_validated_json", reasons: [...new Set(reasons)] }
		: { mode: "native_schema", reasons: [] };
}

function inspectSchema(value: unknown, path = "$", reasons: string[] = []) {
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			inspectSchema(value[index], `${path}[${index}]`, reasons);
		}
		return reasons;
	}
	if (!value || typeof value !== "object") return reasons;
	const record = value as Record<string, unknown>;
	if (record.type === "object") {
		if (record.additionalProperties !== false) {
			reasons.push(`non_strict_object:${path}`);
		}
		const properties = isRecord(record.properties) ? record.properties : {};
		const required = Array.isArray(record.required)
			? new Set(record.required.map(String))
			: new Set<string>();
		if (Object.keys(properties).some((key) => !required.has(key))) {
			reasons.push(`optional_object_property:${path}`);
		}
	}
	for (const [key, child] of Object.entries(record)) {
		if (["patternProperties", "unevaluatedProperties"].includes(key)) {
			reasons.push(`unsupported_keyword:${key}`);
		}
		inspectSchema(child, `${path}.${key}`, reasons);
	}
	return reasons;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
