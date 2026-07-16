import type { RuntimeContractWarning } from "./contracts";

export function normalizeRuntimeContractWarnings(
	value: unknown,
): RuntimeContractWarning[] {
	if (!Array.isArray(value)) return [];
	const warnings: RuntimeContractWarning[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		if (typeof record.code !== "string" || typeof record.message !== "string")
			continue;
		const severity =
			record.severity === "info" ||
			record.severity === "warning" ||
			record.severity === "error"
				? record.severity
				: "warning";
		warnings.push({
			code: record.code,
			severity,
			message: record.message,
			providerItemId:
				typeof record.providerItemId === "string"
					? record.providerItemId
					: null,
			toolName: typeof record.toolName === "string" ? record.toolName : null,
			todoId: typeof record.todoId === "string" ? record.todoId : null,
			todoSeq: typeof record.todoSeq === "number" ? record.todoSeq : null,
			changedFiles: Array.isArray(record.changedFiles)
				? record.changedFiles.filter(
						(file): file is string => typeof file === "string",
					)
				: undefined,
			command: typeof record.command === "string" ? record.command : null,
			todoEvidenceSource:
				record.todoEvidenceSource === "db" ||
				record.todoEvidenceSource === "context" ||
				record.todoEvidenceSource === "none"
					? record.todoEvidenceSource
					: undefined,
			sequence:
				typeof record.sequence === "number" && Number.isFinite(record.sequence)
					? Math.max(0, Math.floor(record.sequence))
					: undefined,
			occurredAt:
				typeof record.occurredAt === "string" ? record.occurredAt : undefined,
			count:
				typeof record.count === "number" && Number.isFinite(record.count)
					? Math.max(1, Math.floor(record.count))
					: undefined,
		});
	}
	return warnings;
}

export function dedupeRuntimeContractWarnings(
	warnings: RuntimeContractWarning[],
) {
	const merged: RuntimeContractWarning[] = [];
	const seen = new Map<string, RuntimeContractWarning>();
	for (const warning of warnings) {
		const key = [
			warning.code,
			warning.providerItemId ?? "",
			warning.toolName ?? "",
			warning.todoId ?? "",
			warning.todoSeq ?? "",
			warning.command ?? "",
			warning.todoEvidenceSource ?? "",
			(warning.changedFiles ?? []).join(","),
		].join("|");
		const existing = seen.get(key);
		if (existing) {
			existing.count =
				Math.max(1, existing.count ?? 1) + Math.max(1, warning.count ?? 1);
			continue;
		}
		seen.set(key, warning);
		merged.push(warning);
	}
	return merged;
}

export function summarizeRuntimeContractWarnings(value: unknown) {
	const warnings = normalizeRuntimeContractWarnings(value);
	const byCode = new Map<
		string,
		{
			code: string;
			severity: RuntimeContractWarning["severity"];
			count: number;
		}
	>();
	const severityRank = { info: 0, warning: 1, error: 2 } as const;
	for (const warning of warnings) {
		const count = Math.max(1, warning.count ?? 1);
		const existing = byCode.get(warning.code);
		if (existing) {
			existing.count += count;
			if (severityRank[warning.severity] > severityRank[existing.severity]) {
				existing.severity = warning.severity;
			}
			continue;
		}
		byCode.set(warning.code, {
			code: warning.code,
			severity: warning.severity,
			count,
		});
	}
	const codes = [...byCode.values()].sort(
		(a, b) =>
			severityRank[b.severity] - severityRank[a.severity] ||
			b.count - a.count ||
			a.code.localeCompare(b.code),
	);
	const totalCount = codes.reduce((sum, item) => sum + item.count, 0);
	return {
		totalCount,
		warningCount: codes
			.filter((item) => item.severity === "warning")
			.reduce((sum, item) => sum + item.count, 0),
		errorCount: codes
			.filter((item) => item.severity === "error")
			.reduce((sum, item) => sum + item.count, 0),
		codes,
	};
}

export function mergeRuntimeContractSnapshot(
	snapshot: unknown,
	warnings: RuntimeContractWarning[],
	input: { lane?: string | null } = {},
) {
	const base =
		snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
			? (snapshot as Record<string, unknown>)
			: {};
	const existingRuntimeContract =
		base.runtimeContract &&
		typeof base.runtimeContract === "object" &&
		!Array.isArray(base.runtimeContract)
			? (base.runtimeContract as Record<string, unknown>)
			: {};
	const existingCodexContract =
		base.codexContract &&
		typeof base.codexContract === "object" &&
		!Array.isArray(base.codexContract)
			? (base.codexContract as Record<string, unknown>)
			: {};
	const existingWarnings = [
		...normalizeRuntimeContractWarnings(existingRuntimeContract.warnings),
		...normalizeRuntimeContractWarnings(existingCodexContract.warnings),
	];
	const mergedWarnings = dedupeRuntimeContractWarnings([
		...existingWarnings,
		...warnings,
	]);
	const runtimeContract = {
		...existingRuntimeContract,
		lane: input.lane ?? existingRuntimeContract.lane ?? null,
		warnings: mergedWarnings,
		warningSummary: summarizeRuntimeContractWarnings(mergedWarnings),
	};
	return {
		...base,
		runtimeContract,
	};
}

export function buildOpenTodoRuntimeContractWarning<
	TTodo extends { id: string; seq: number; title: string },
>(openTodos: TTodo[]): RuntimeContractWarning {
	return {
		code: "codex_open_todos_before_completion",
		severity: "warning",
		message:
			"Runtime reported completion while DB Todo state still had pending or running Todos.",
		providerItemId: null,
		toolName: null,
		todoId: openTodos[0]?.id ?? null,
		todoSeq: openTodos[0]?.seq ?? null,
	};
}
