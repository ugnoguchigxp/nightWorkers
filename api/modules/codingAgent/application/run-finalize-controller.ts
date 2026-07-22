import * as repo from "../../nightworkers/nightworkers.repository";
import {
	type CodingAgentCompletionReadiness,
	evaluateCodingAgentCompletionReadiness,
} from "./completion-readiness.service";

export type RunCompletionSnapshot = {
	planRevision: number;
	todos: Array<{
		id: string;
		revision: number;
		status: string;
		title: string;
	}>;
	readiness?: CodingAgentCompletionReadiness;
};

export type FinalizeGuardResult = {
	allowFinalize: boolean;
	code:
		| "FINALIZE_ALLOWED"
		| "FINALIZE_RECONCILIATION_REQUIRED"
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

export type RunFinalizeControllerDependencies = {
	getTaskRun: typeof repo.getTaskRun;
	listTaskRunTodosForRun: typeof repo.listTaskRunTodosForRun;
	evaluateReadiness: typeof evaluateCodingAgentCompletionReadiness;
};

const defaultDependencies: RunFinalizeControllerDependencies = {
	getTaskRun: (...args) => repo.getTaskRun(...args),
	listTaskRunTodosForRun: (...args) => repo.listTaskRunTodosForRun(...args),
	evaluateReadiness: (...args) =>
		evaluateCodingAgentCompletionReadiness(...args),
};

export class RunFinalizeController {
	private readonly dependencies: RunFinalizeControllerDependencies;

	constructor(dependencies: Partial<RunFinalizeControllerDependencies> = {}) {
		this.dependencies = { ...defaultDependencies, ...dependencies };
	}

	async evaluateCandidate(input: {
		runId: string;
		repositoryRoot?: string;
		candidateRevision?: number;
		finalCandidate?: string;
		expectedPlanRevision?: number;
		expectedTodoRevisions?: Record<string, number>;
	}): Promise<FinalizeGuardResult> {
		const run = await this.dependencies.getTaskRun(input.runId);
		if (!run) {
			return blocked("RUN_NOT_FOUND", "対象Runが存在しません。", [], null);
		}
		const todos = await this.dependencies.listTaskRunTodosForRun(input.runId);
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
					todos.find((todo) => todo.id === id || todo.todoKey === id)
						?.revision !== revision,
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
		const readiness = await this.dependencies.evaluateReadiness({
			taskId: run.taskId,
			runId: run.id,
			repositoryRoot: input.repositoryRoot ?? "",
			candidateRevision: input.candidateRevision,
			finalCandidate: input.finalCandidate,
		});
		const readinessSnapshot = { ...snapshot, readiness };
		if (!readiness.ready) {
			return blocked(
				"FINALIZE_RECONCILIATION_REQUIRED",
				"現在のTask、source、検証証跡、最終回答候補に未解決の差分があります。",
				readiness.satisfactionConditions,
				readinessSnapshot,
			);
		}
		return {
			allowFinalize: true,
			code: "FINALIZE_ALLOWED",
			message: "Run completion readinessが整合しました。",
			missingConditions: [],
			snapshot: readinessSnapshot,
			idempotent: false,
		};
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
