import * as repo from "../../modules/nightworkers/nightworkers.repository";

export type RunCompletionSnapshot = {
	planRevision: number;
	todos: Array<{
		id: string;
		revision: number;
		status: string;
		title: string;
	}>;
};

export type FinalizeGuardResult = {
	allowFinalize: boolean;
	code:
		| "FINALIZE_ALLOWED"
		| "RUN_NOT_FOUND"
		| "RUN_ALREADY_TERMINAL"
		| "RUN_HAS_OPEN_TODOS"
		| "RUN_NEEDS_HUMAN"
		| "TODO_STATE_INVALID"
		| "TODO_REVISION_CONFLICT";
	message: string;
	missingConditions: string[];
	snapshot: RunCompletionSnapshot | null;
	idempotent: boolean;
};

export class RunFinalizeController {
	async evaluateCandidate(input: {
		runId: string;
		expectedPlanRevision?: number;
		expectedTodoRevisions?: Record<string, number>;
	}): Promise<FinalizeGuardResult> {
		const run = await repo.getTaskRun(input.runId);
		if (!run) {
			return blocked("RUN_NOT_FOUND", "対象Runが存在しません。", [], null);
		}
		const todos = await repo.listTaskRunTodosForRun(input.runId);
		const snapshot: RunCompletionSnapshot = {
			planRevision: run.todoPlanRevision,
			todos: todos.map((todo) => ({
				id: todo.id,
				revision: todo.revision,
				status: todo.status,
				title: todo.title,
			})),
		};
		if (
			["completed", "failed", "cancelled", "timed_out"].includes(run.status)
		) {
			return {
				allowFinalize: run.status === "completed",
				code: "RUN_ALREADY_TERMINAL",
				message: `Runは既にterminalです (${run.status})。`,
				missingConditions: [],
				snapshot,
				idempotent: true,
			};
		}
		if (
			(input.expectedPlanRevision !== undefined &&
				input.expectedPlanRevision !== run.todoPlanRevision) ||
			Object.entries(input.expectedTodoRevisions ?? {}).some(
				([id, revision]) =>
					todos.find((todo) => todo.id === id)?.revision !== revision,
			)
		) {
			return blocked(
				"TODO_REVISION_CONFLICT",
				"Todo snapshotが更新済みです。最新状態を取得してください。",
				["todo_revision"],
				snapshot,
			);
		}
		const running = todos.filter((todo) => todo.status === "running");
		if (running.length > 1) {
			return blocked(
				"TODO_STATE_INVALID",
				"running Todoが複数存在します。",
				["single_running_todo"],
				snapshot,
			);
		}
		const open = todos.filter((todo) =>
			["pending", "running"].includes(todo.status),
		);
		if (open.length > 0) {
			return blocked(
				"RUN_HAS_OPEN_TODOS",
				"Runを完了する前にopen Todoを明示的に遷移してください。",
				open.map((todo) => `todo:${todo.id}:${todo.status}`),
				snapshot,
			);
		}
		const needsHuman = todos.filter((todo) => todo.status === "needs_human");
		if (needsHuman.length > 0) {
			return blocked(
				"RUN_NEEDS_HUMAN",
				"ユーザー回答待ちのTodoがあるためRunを完了できません。",
				needsHuman.map((todo) => `todo:${todo.id}:needs_human`),
				snapshot,
			);
		}
		if (todos.length === 0) {
			return blocked(
				"RUN_HAS_OPEN_TODOS",
				"Coding Agent RunにはTodo planが必要です。",
				["todo_plan_required"],
				snapshot,
			);
		}
		return {
			allowFinalize: true,
			code: "FINALIZE_ALLOWED",
			message: "Run completion preconditionsを満たしました。",
			missingConditions: [],
			snapshot,
			idempotent: false,
		};
	}

	async terminalize(runId: string) {
		return repo.getTaskRun(runId);
	}
}

function blocked(
	code: Exclude<FinalizeGuardResult["code"], "FINALIZE_ALLOWED">,
	message: string,
	missingConditions: string[],
	snapshot: RunCompletionSnapshot | null,
): FinalizeGuardResult {
	return {
		allowFinalize: false,
		code,
		message,
		missingConditions,
		snapshot,
		idempotent: false,
	};
}

export const runFinalizeController = new RunFinalizeController();
