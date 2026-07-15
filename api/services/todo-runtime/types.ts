/** Legacy planning metadata retained for artifact compatibility only. */
export type ImplementationTodoInput = {
	seq?: number;
	title: string;
	description?: string | null;
	taskType?: string;
	procedureId?: string | null;
	dependsOn?: Array<string | number> | null;
	evidenceRequirements?: unknown[] | null;
};

/** Legacy read-only snapshot; the Coding Agent runtime does not derive this. */
export type TodoVerificationPolicy = {
	suppressE2eTodos: boolean;
	source: "questionnaire_unit_primary" | "default";
	reason?: string | null;
};

export type TodoRuntimeStatus =
	| "pending"
	| "running"
	| "passed"
	| "failed"
	| "skipped"
	| "needs_human";

export type TodoRuntimeTodo = {
	id: string;
	seq: number;
	title: string;
	description?: string | null;
	taskType: string;
	status: string;
	procedureId?: string | null;
	procedureSnapshot?: unknown;
	statusReason?: string | null;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
};
