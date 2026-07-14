import * as repo from "../../modules/nightworkers/nightworkers.repository";
import type {
	ImplementationTodoInput,
	TodoVerificationPolicy,
} from "../todo-runtime";
import type {
	TodoActionPayload,
	TodoListOperation,
	TodoListReplaceReason,
	TodoMutationContext,
	TodoToolName,
} from "./todo-list";
import { hasDataMigrationMarker } from "./todo-list";
import { failedTodoActionResult } from "./todo-list-response";
import type { WorkerToolResult } from "./types";

export async function withRunContext(
	action: TodoToolName,
	rawRunId: string,
	operation: TodoListOperation,
	attemptedAction: {
		seq?: number;
		todoListReplaceReason?: TodoListReplaceReason;
	},
	fn: (context: {
		runId: string;
		taskId: string;
		requireDataMigrationGates: boolean;
		verificationPolicy: TodoVerificationPolicy | null;
	}) => Promise<WorkerToolResult<TodoActionPayload>>,
) {
	const runId = String(rawRunId || "").trim();
	const startedAt = new Date().toISOString();
	if (!runId) {
		return failedTodoActionResult(
			startedAt,
			action,
			operation,
			"",
			"",
			"INVALID_TOOL_ARGS",
			[],
			attemptedAction,
		);
	}
	try {
		const run = await repo.getTaskRun(runId);
		if (!run) {
			return failedTodoActionResult(
				startedAt,
				action,
				operation,
				runId,
				"",
				"RUN_NOT_FOUND",
				[],
				attemptedAction,
			);
		}
		return await fn({
			runId,
			taskId: run.taskId,
			requireDataMigrationGates: requiresDataMigrationFromRun(run),
			verificationPolicy: readVerificationPolicyFromRun(run),
		});
	} catch (error) {
		return {
			ok: false,
			toolName: action,
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: {
				runId,
				taskId: "",
				action,
				operation,
				todos: [],
				diagnostics: {
					errorCode: "TODO_ACTION_FAILED",
				},
			},
			error: {
				code: "TODO_ACTION_FAILED",
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

export async function withTodoMutationContext(
	action: TodoToolName,
	runId: string,
	operation: TodoListOperation,
	attemptedAction: {
		seq?: number;
		todoListReplaceReason?: TodoListReplaceReason;
	},
	fn: (
		context: TodoMutationContext,
	) => Promise<WorkerToolResult<TodoActionPayload>>,
) {
	return withRunContext(
		action,
		runId,
		operation,
		attemptedAction,
		async (base) => {
			const todos = await repo.listTaskRunTodosForRun(base.runId);
			return fn({ ...base, todos });
		},
	);
}

export function requireDataMigrationGatesForContext(input: {
	contextRequiresDataMigration: boolean;
	todos: ImplementationTodoInput[];
}) {
	return (
		input.contextRequiresDataMigration ||
		input.todos.some(hasDataMigrationMarker)
	);
}

export function requiresDataMigrationFromRun(run: {
	contextSnapshot?: unknown;
}) {
	const snapshot =
		run.contextSnapshot &&
		typeof run.contextSnapshot === "object" &&
		!Array.isArray(run.contextSnapshot)
			? (run.contextSnapshot as Record<string, unknown>)
			: null;
	const missionPilot =
		snapshot?.missionPilot &&
		typeof snapshot.missionPilot === "object" &&
		!Array.isArray(snapshot.missionPilot)
			? (snapshot.missionPilot as Record<string, unknown>)
			: null;
	return (
		snapshot?.jobType === "data_migration" ||
		snapshot?.requireDataMigrationGates === true ||
		missionPilot?.requireDataMigrationGates === true
	);
}

export function readVerificationPolicyFromRun(run: {
	contextSnapshot?: unknown;
}): TodoVerificationPolicy | null {
	const snapshot =
		run.contextSnapshot &&
		typeof run.contextSnapshot === "object" &&
		!Array.isArray(run.contextSnapshot)
			? (run.contextSnapshot as Record<string, unknown>)
			: null;
	const value = snapshot?.verificationPolicy;
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const policy = value as Record<string, unknown>;
	return {
		suppressE2eTodos: policy.suppressE2eTodos === true,
		source:
			policy.source === "questionnaire_unit_primary"
				? "questionnaire_unit_primary"
				: "default",
		reason: typeof policy.reason === "string" ? policy.reason : null,
	};
}
