import {
	p as defaultP,
	type SystemContextP,
} from "../../../systemContexts/catalog";
import type { CodingAgentSystemContext } from "./types";

export const CODING_AGENT_SYSTEM_CONTEXT_VERSION = 14;

export function getCodingAgentRoleInstructions(p: SystemContextP = defaultP) {
	return p("codingAgent.role-instructions", {});
}

export function getCodingAgentDddFallbackInstructions(
	p: SystemContextP = defaultP,
) {
	return p("codingAgent.ddd-fallback-combined", {
		dddFallback: p("codingAgent.ddd-fallback", {}).trimEnd(),
		domainModuleBoundary: p("codingAgent.domain-module-boundary", {}).trimEnd(),
	});
}

export function getCodingAgentTodoRequirement(p: SystemContextP = defaultP) {
	return p("codingAgent.todo-requirement", {});
}

export function getCodingAgentInitialPreparationTodo(
	p: SystemContextP = defaultP,
) {
	return p("codingAgent.initial-preparation-todo", {});
}

export function getCodingAgentCompletionReportTodo(
	p: SystemContextP = defaultP,
) {
	return p("codingAgent.completion-report-todo", {});
}

export function getCodingAgentStandaloneExecution(
	p: SystemContextP = defaultP,
) {
	return p("codingAgent.standalone-execution", {});
}

export function getCodingAgentRuntimeReminders(p: SystemContextP = defaultP) {
	return Object.freeze([p("codingAgent.runtime-reminders", {})]);
}

export function getCodingAgentFailureRecovery(p: SystemContextP = defaultP) {
	return p("codingAgent.failure-recovery", {});
}

export function getCodingAgentCompletionRule(p: SystemContextP = defaultP) {
	return p("codingAgent.completion-rule", {
		completionReportFormat: p(
			"codingAgent.completion-report-format",
			{},
		).trimEnd(),
	});
}

export function getCodingAgentToolContract(p: SystemContextP = defaultP) {
	return p("codingAgent.tool-contract", {});
}

export function getCodingAgentDirectPlanMode(p: SystemContextP = defaultP) {
	return p("codingAgent.direct-plan-mode", {});
}

export function getCodingAgentNightworkersMcpInstructions() {
	return defaultP("codingAgent.nightworkers-mcp", {});
}

export function buildCodingAgentTaskGoal(input: {
	title?: string | null;
	objective?: string | null;
	description?: string | null;
	acceptanceCriteria?: string | null;
}) {
	return [
		input.title?.trim() ? `Taskタイトル: ${input.title.trim()}` : null,
		input.objective?.trim() ? `目的: ${input.objective.trim()}` : null,
		input.description?.trim() ? `説明: ${input.description.trim()}` : null,
		input.acceptanceCriteria?.trim()
			? `完了条件: ${input.acceptanceCriteria.trim()}`
			: null,
	]
		.filter((value): value is string => Boolean(value))
		.join("\n");
}

export function buildCodingAgentSystemContext(
	input: {
		taskGoal: string;
		projectRulesJa?: string[];
		registeredRepositoryRoot: string;
		planModeRequested?: boolean;
	},
	p: SystemContextP = defaultP,
): CodingAgentSystemContext {
	const roleInstructions = getCodingAgentRoleInstructions(p);
	const domainModuleBoundary = getCodingAgentDddFallbackInstructions(p);
	const todoRequirementJa = p("codingAgent.todo-policy", {
		todoRequirement: getCodingAgentTodoRequirement(p).trimEnd(),
		initialPreparationTodo: getCodingAgentInitialPreparationTodo(p).trimEnd(),
		completionReportTodo: getCodingAgentCompletionReportTodo(p).trimEnd(),
		standaloneExecution: getCodingAgentStandaloneExecution(p).trimEnd(),
		directPlanMode: input.planModeRequested
			? getCodingAgentDirectPlanMode(p).trimEnd()
			: "",
	});
	return {
		version: CODING_AGENT_SYSTEM_CONTEXT_VERSION,
		planModeRequested: Boolean(input.planModeRequested),
		todoPolicy: "adaptive",
		roleInstructionsJa: roleInstructions,
		domainModuleBoundaryJa: domainModuleBoundary,
		taskGoal: input.taskGoal.trim(),
		projectRulesJa: input.projectRulesJa ?? [],
		todoRequirementJa,
		failureRecoveryJa: getCodingAgentFailureRecovery(p),
		completionRuleJa: getCodingAgentCompletionRule(p),
		toolContractJa: getCodingAgentToolContract(p),
		registeredRepositoryRoot: input.registeredRepositoryRoot,
	};
}

export function rebindCodingAgentSystemContext(
	context: CodingAgentSystemContext,
	p: SystemContextP,
): CodingAgentSystemContext {
	return buildCodingAgentSystemContext(
		{
			taskGoal: context.taskGoal,
			projectRulesJa: context.projectRulesJa,
			registeredRepositoryRoot: context.registeredRepositoryRoot,
			planModeRequested: context.planModeRequested,
		},
		p,
	);
}

export function readCodingAgentPlanModeRequested(contextSnapshot: unknown) {
	return record(contextSnapshot)?.planModeRequested === true;
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
