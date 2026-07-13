import type { ImplementationTodoInput } from "../../services/todo-runtime";
import type { ReviewRunOptions, ReviewTarget } from "./review-mode.model";
import { summarizeTarget } from "./review-run-target-helpers";

export function buildReviewRunArtifact(input: {
	session: {
		runId: string;
		taskId: string;
		repositoryId: string;
	};
	options: ReviewRunOptions;
	target: ReviewTarget;
	todos: ImplementationTodoInput[];
	status: "not_started" | "running" | "needs_human" | "done" | "failed";
	reviewRunId: string | null;
	initialFindingCount: number;
}) {
	return {
		version: 1,
		kind: "review_run",
		runId: input.session.runId,
		reviewRunId: input.reviewRunId,
		taskId: input.session.taskId,
		repositoryId: input.session.repositoryId,
		options: input.options,
		status: input.status,
		target: summarizeTarget(input.target),
		todos: input.todos.map((todo, index) => ({
			seq: index + 1,
			title: todo.title,
			taskType: todo.taskType ?? "implementation",
			procedureId: todo.procedureId ?? null,
		})),
		findings: [],
		initialFindingCount: input.initialFindingCount,
		fixesApplied: false,
		commit: {
			requested: input.options.commitChanges,
			created: false,
			sha: null,
			message: null,
			error: null,
		},
		warnings: input.target.warnings,
	};
}
