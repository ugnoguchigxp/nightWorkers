export type TodoEvidenceKind =
	| "observation"
	| "workspace_mutation"
	| "verification"
	| "decision"
	| "approval";

export type TodoEvidenceRequirement = {
	kind: TodoEvidenceKind;
	freshness: "after_todo_start" | "after_last_mutation" | "any";
	minimumCount?: number;
};

export type EvidenceTodoMode = "off" | "observe" | "managed" | "enforce";

export function readEvidenceTodoMode(): EvidenceTodoMode {
	const value = process.env.NIGHTWORKERS_EVIDENCE_TODO_MODE;
	if (
		value === "off" ||
		value === "observe" ||
		value === "managed" ||
		value === "enforce"
	)
		return value;
	return "observe";
}

export function normalizeEvidenceRequirements(
	value: unknown,
): TodoEvidenceRequirement[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return [];
		const record = item as Record<string, unknown>;
		if (!isEvidenceKind(record.kind) || !isFreshness(record.freshness))
			return [];
		const minimumCount =
			typeof record.minimumCount === "number" &&
			Number.isInteger(record.minimumCount) &&
			record.minimumCount > 0
				? record.minimumCount
				: undefined;
		return [{ kind: record.kind, freshness: record.freshness, minimumCount }];
	});
}

function isEvidenceKind(value: unknown): value is TodoEvidenceKind {
	return (
		value === "observation" ||
		value === "workspace_mutation" ||
		value === "verification" ||
		value === "decision" ||
		value === "approval"
	);
}

function isFreshness(
	value: unknown,
): value is TodoEvidenceRequirement["freshness"] {
	return (
		value === "after_todo_start" ||
		value === "after_last_mutation" ||
		value === "any"
	);
}
