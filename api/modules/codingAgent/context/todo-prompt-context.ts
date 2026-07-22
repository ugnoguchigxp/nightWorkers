import {
	bindSystemContextTextCatalog,
	type SystemContextP,
} from "../../../systemContexts/catalog";
import type { CodingAgentSystemContext } from "./types";

type RuntimeTodo = {
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

const MAX_PROMPT_TODO_SUMMARIES = 16;
const MAX_RECENT_TERMINAL_TODO_SUMMARIES = 4;

export function renderCodingAgentRuntimeSystemContext(
	context: CodingAgentSystemContext,
	options: { includeTaskGoal?: boolean } = {},
	p: SystemContextP = bindSystemContextTextCatalog().p,
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
	p: SystemContextP = bindSystemContextTextCatalog().p,
) {
	if (!todos?.length) return null;
	const active = todos
		.filter((todo) => !["passed", "skipped"].includes(todo.status))
		.slice(0, MAX_PROMPT_TODO_SUMMARIES);
	const remainingCapacity = MAX_PROMPT_TODO_SUMMARIES - active.length;
	const recentTerminalCount = Math.min(
		remainingCapacity,
		MAX_RECENT_TERMINAL_TODO_SUMMARIES,
	);
	const recentTerminal = recentTerminalCount
		? todos
				.filter((todo) => ["passed", "skipped"].includes(todo.status))
				.slice(-recentTerminalCount)
		: [];
	const visible = [...active, ...recentTerminal].sort((a, b) => a.seq - b.seq);
	const omittedCount = todos.length - visible.length;
	return p("codingAgent.todo-plan-summary", {
		visibleTodos: visible.map(({ id, seq, status, taskType, title }) => ({
			id,
			seq,
			status,
			taskType,
			title,
		})),
		omittedCount,
	});
}

export function renderCodingAgentTodoSystemContext(
	todo: RuntimeTodo,
	p: SystemContextP = bindSystemContextTextCatalog().p,
) {
	return p("codingAgent.current-todo", {
		todo: {
			id: todo.id,
			revision: todo.revision ?? 0,
			taskType: todo.taskType,
			title: todo.title,
			objective: todo.objective ?? "",
			systemContext: todo.systemContext ?? todo.context ?? "",
			nextAction: todo.nextAction ?? "",
			acceptanceCriteria: todo.acceptanceCriteria ?? [],
			lastFailure: todo.lastFailure ?? "",
			attemptCount: todo.attemptCount ?? 0,
		},
	});
}
