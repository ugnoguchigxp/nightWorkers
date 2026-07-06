export function firstRecord(...values: unknown[]) {
	return values.find(isRecord) || null;
}

export function stringValue(value: unknown) {
	return typeof value === "string" ? value.trim() : "";
}

export function formatCanonicalSource(value: string) {
	const labels: Record<string, string> = {
		ddl: "DDL",
		json_shape: "JSON shape",
		typescript_type: "TypeScript type",
		zod_schema: "Zod schema",
		storage_contract: "Storage contract",
	};
	return labels[value] || value;
}

export function responseDescription(value: unknown) {
	if (!isRecord(value)) return "";
	return stringValue(value.description) || "Response";
}

export function toStringArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

export function toNumberArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is number => typeof item === "number")
		: [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function toRecordArray(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}
