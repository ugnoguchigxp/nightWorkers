import { createHash } from "node:crypto";
import { rubricDefinitionSchema } from "../../../../shared/schemas/nightworkers.schema";
import { AppError } from "../../../lib/errors";
import { BUILTIN_RUBRICS } from "./builtin";
import type { LoadedRubric, RubricDefinition } from "./types";

export class RubricNotFoundError extends AppError {
	constructor(id: string) {
		super(404, "RUBRIC_NOT_FOUND", `Unknown review rubric: ${id}`, {
			rubricId: id,
		});
	}
}

export function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(
		([a], [b]) => a.localeCompare(b),
	);
	return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

export function digestObject(value: unknown): string {
	return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function listRubrics(): LoadedRubric[] {
	return Object.keys(BUILTIN_RUBRICS)
		.sort()
		.map((id) => loadRubric(id));
}

export function loadRubric(id: string): LoadedRubric {
	const candidate = BUILTIN_RUBRICS[id];
	if (!candidate) throw new RubricNotFoundError(id);
	const rubric = rubricDefinitionSchema.parse(candidate) as RubricDefinition;
	return {
		rubric,
		source: "builtin",
		digest: digestObject(rubric),
		criteriaCount: rubric.criteria.length,
	};
}
