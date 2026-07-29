import {
	p as defaultP,
	type SystemContextP,
} from "../../../systemContexts/catalog";
import type { CodingAgentSystemContext } from "./types";

export type RuntimeTodo = {
	id: string;
	seq: number;
	title: string;
	taskType: string;
	status: string;
	objective?: string | null;
	systemContext?: string | null;
	context?: string | null;
	nextAction?: string | null;
	acceptanceCriteria?: string[];
	lastFailure?: string | null;
	attemptCount?: number;
	revision?: number;
};

export function renderCodingAgentRuntimeSystemContext(
	context: CodingAgentSystemContext,
	options: { includeTaskGoal?: boolean } = {},
	p: SystemContextP = defaultP,
) {
	const sharedValues = {
		version: context.version,
		todoPolicy: context.todoPolicy,
		roleInstructions: context.roleInstructionsJa.trimEnd(),
		domainModuleBoundary:
			context.domainModuleBoundaryJa?.trimEnd() ??
			p("codingAgent.domain-module-boundary", {}).trimEnd(),
		registeredRepositoryRoot: context.registeredRepositoryRoot,
		projectRules: context.projectRulesJa,
		todoRequirement: context.todoRequirementJa.trimEnd(),
		failureRecovery: context.failureRecoveryJa.trimEnd(),
		completionRule: context.completionRuleJa.trimEnd(),
		toolContract: context.toolContractJa.trimEnd(),
	};
	return options.includeTaskGoal === false
		? p("codingAgent.runtime-system-without-task-goal", sharedValues)
		: p("codingAgent.runtime-system", {
				...sharedValues,
				taskGoal: context.taskGoal,
			});
}

export function renderCodingAgentTodoPlanSummary(
	todos: readonly RuntimeTodo[] | undefined,
	p: SystemContextP = defaultP,
) {
	if (!todos?.length) return null;
	const next = todos.find((todo) => todo.status === "pending") ?? null;
	const terminal = todos.filter((todo) =>
		["passed", "skipped"].includes(todo.status),
	).length;
	return p("codingAgent.todo-plan-summary", {
		progress: {
			terminal,
			total: todos.length,
			needsHuman: todos.filter((todo) => todo.status === "needs_human").length,
		},
		next: next ? { title: next.title, status: next.status } : null,
	});
}

export function renderCodingAgentTodoSystemContext(
	todo: RuntimeTodo,
	p: SystemContextP = defaultP,
) {
	return p(
		"codingAgent.current-todo",
		codingAgentTodoSystemContextValues(todo),
	);
}

export function codingAgentTodoSystemContextValues(todo: RuntimeTodo) {
	return {
		todo: {
			title: todo.title,
			systemContext: todo.systemContext ?? todo.context ?? "",
			lastFailure: todo.lastFailure ?? "",
			attemptCount: todo.attemptCount ?? 0,
		},
	};
}
