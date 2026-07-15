import crypto from "node:crypto";

export function buildRunActionIdentity(input: {
	toolName: string;
	arguments: unknown;
	workspaceIdentity?: string | null;
}) {
	const normalizedArguments = normalizeActionValue(input.arguments);
	const normalized = {
		toolName: input.toolName.trim(),
		workspaceIdentity: input.workspaceIdentity?.trim() || null,
		arguments: normalizedArguments,
	};
	const serialized = serializeNormalized(normalized);
	const normalizedArgsDigest = digestJson(normalizedArguments);
	return {
		actionKey: `sha256:${crypto.createHash("sha256").update(serialized).digest("hex")}`,
		normalizedArgsDigest,
		normalizedArguments,
	};
}

export function digestJson(value: unknown) {
	return `sha256:${crypto
		.createHash("sha256")
		.update(serializeNormalized(normalizeActionValue(value)))
		.digest("hex")}`;
}

export function normalizeActionValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalizeActionValue);
	if (!value || typeof value !== "object") {
		if (typeof value === "number" && !Number.isFinite(value))
			return String(value);
		if (typeof value === "bigint") return `${value.toString()}n`;
		if (typeof value === "undefined") return { $type: "undefined" };
		return value;
	}
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, normalizeActionValue(entry)]),
	);
}

function serializeNormalized(value: unknown) {
	return JSON.stringify(value) ?? '{"$type":"undefined"}';
}
