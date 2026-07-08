export const LLM_WRITABLE_TODO_TASK_TYPES = [
	"implementation",
	"inspection",
	"investigation",
	"scaffold",
	"focused_verification",
	"verification",
	"code_edit",
	"code_change",
	"test",
	"test_change",
	"documentation",
	"docs",
	"migration",
	"data_migration",
	"config",
	"dependency",
	"refactor",
	"import",
	"copy",
	"git",
	"release",
] as const;

export const NIGHTWORKERS_MANAGED_TODO_TASK_TYPES = [
	"initial_instructions",
	"context_compile",
	"knowledge_capture",
	"completion_report",
] as const;

export const TODO_TASK_TYPE_ALIASES = ["closeout", "quality_gate"] as const;

export const NIGHTWORKERS_TODO_TASK_TYPES = [
	...LLM_WRITABLE_TODO_TASK_TYPES,
	...NIGHTWORKERS_MANAGED_TODO_TASK_TYPES,
	...TODO_TASK_TYPE_ALIASES,
] as const;

export type NightWorkersTodoTaskType =
	(typeof NIGHTWORKERS_TODO_TASK_TYPES)[number];

const NIGHTWORKERS_TODO_TASK_TYPE_SET = new Set<string>(
	NIGHTWORKERS_TODO_TASK_TYPES,
);

const STORAGE_TASK_TYPE_ALIASES = new Map<string, NightWorkersTodoTaskType>([
	["closeout", "completion_report"],
	["quality_gate", "verification"],
]);

export function isKnownTodoTaskType(value: string) {
	return NIGHTWORKERS_TODO_TASK_TYPE_SET.has(value);
}

export function normalizeTodoTaskTypeForStorage(
	value: string | null | undefined,
) {
	const taskType = typeof value === "string" ? value.trim() : "";
	if (!taskType) return "implementation";
	const aliasedTaskType = STORAGE_TASK_TYPE_ALIASES.get(taskType);
	if (aliasedTaskType) return aliasedTaskType;
	if (isKnownTodoTaskType(taskType)) return taskType;
	return "implementation";
}
