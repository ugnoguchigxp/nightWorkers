const REPOSITORY_INSPECTION_KEYS = [
	"git",
	"gitHead",
	"localPath",
	"materialization",
	"repoRoot",
	"repository",
	"repositoryId",
	"repositoryRef",
	"repositoryState",
	"worktree",
	"worktreePath",
] as const;

export function sanitizeMissionPilotContext(value: unknown) {
	const context = record(value);
	const sanitized = omitRepositoryInspectionFields(context);
	if (context.session)
		sanitized.session = omitRepositoryInspectionFields(record(context.session));
	if (context.task)
		sanitized.task = omitRepositoryInspectionFields(record(context.task));
	return sanitized;
}

function omitRepositoryInspectionFields(value: Record<string, unknown>) {
	const sanitized = { ...value };
	for (const key of REPOSITORY_INSPECTION_KEYS) delete sanitized[key];
	return sanitized;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
