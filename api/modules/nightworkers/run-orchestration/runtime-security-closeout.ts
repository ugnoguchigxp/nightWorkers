import type { AgentRuntimeResult } from "../../../services/agent-runtime/types";
import type { RuntimePromptSnapshot } from "../../../services/todo-context";
import {
	collectVulnWorkbenchOntologyHandoff,
	getProjectSecurityIntelligenceSettings,
} from "../../ontology";
import {
	readLatestSecurityGateResult,
	runSecurityOracleGate,
} from "../../review";
import * as repo from "../nightworkers.repository";

export async function resolveRuntimeSecurityCloseout(input: {
	runId: string;
	taskId: string;
	repositoryId: string;
	repoRoot: string;
	executionMode?: RuntimePromptSnapshot["executionMode"] | null;
	outcomeStatus: AgentRuntimeResult["terminalState"];
	finalTodos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>;
	skipSecurityOracle?: boolean;
}) {
	let finalTodos = input.finalTodos;
	if (input.skipSecurityOracle) {
		return { finalTodos, securityGate: null };
	}
	let securityGate =
		input.executionMode === "implementation"
			? await readLatestSecurityGateResult(input.runId)
			: null;
	if (
		input.outcomeStatus === "completed" &&
		input.executionMode === "implementation" &&
		!securityGate &&
		!hasOpenTodos(finalTodos)
	) {
		const securitySettings = await getProjectSecurityIntelligenceSettings(
			input.repositoryId,
		);
		securityGate = await runSecurityOracleGate({
			runId: input.runId,
			taskId: input.taskId,
			repoRoot: input.repoRoot,
			maxIterations: securitySettings.settings.securityMaxIterations,
		});
		finalTodos = await repo.listTaskRunTodosForRun(input.runId);
	}
	if (
		securityGate?.allowFinalize &&
		securityGate.scanRunId &&
		input.executionMode === "implementation"
	) {
		const securitySettings = await getProjectSecurityIntelligenceSettings(
			input.repositoryId,
		);
		if (securitySettings.ontology.toolProfile === "ontology_extended") {
			await collectVulnWorkbenchOntologyHandoff({
				runId: input.runId,
				taskId: input.taskId,
				scanRunId: securityGate.scanRunId,
			});
		}
	}
	return { finalTodos, securityGate };
}

function hasOpenTodos(
	todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>,
) {
	return todos.some((todo) => ["pending", "running"].includes(todo.status));
}
