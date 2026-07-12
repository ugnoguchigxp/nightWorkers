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
		if (
			input.outcomeStatus === "completed" &&
			input.executionMode === "implementation"
		) {
			await persistSecurityOracleSkipped(input, null, "runtime_fixture");
		}
		return { finalTodos, securityGate: null, securityOracleSkipped: true };
	}
	let securityOracleSkipped = false;
	let securityGate =
		input.executionMode === "implementation"
			? await readLatestSecurityGateResult(input.runId)
			: null;
	const securitySettings =
		input.executionMode === "implementation"
			? await getProjectSecurityIntelligenceSettings(input.repositoryId)
			: null;
	if (
		input.outcomeStatus === "completed" &&
		input.executionMode === "implementation" &&
		!securityGate &&
		!hasOpenTodos(finalTodos)
	) {
		if (!securitySettings?.securityOracle.effectiveEnabled) {
			await persistSecurityOracleSkipped(input, securitySettings);
			securityOracleSkipped = true;
		} else {
			securityGate = await runSecurityOracleGate({
				runId: input.runId,
				taskId: input.taskId,
				repoRoot: input.repoRoot,
				maxIterations: securitySettings.settings.securityMaxIterations,
			});
			finalTodos = await repo.listTaskRunTodosForRun(input.runId);
		}
	}
	if (
		securityGate?.allowFinalize &&
		securityGate.scanRunId &&
		input.executionMode === "implementation"
	) {
		if (securitySettings?.ontology.toolProfile === "ontology_extended") {
			await collectVulnWorkbenchOntologyHandoff({
				runId: input.runId,
				taskId: input.taskId,
				scanRunId: securityGate.scanRunId,
			});
		}
	}
	return { finalTodos, securityGate, securityOracleSkipped };
}

export function isSecurityOracleFinalizationBlocked(input: {
	outcomeStatus: AgentRuntimeResult["terminalState"];
	executionMode?: RuntimePromptSnapshot["executionMode"] | null;
	usesE2eFixture: boolean;
	securityOracleSkipped: boolean;
	allowFinalize: boolean | null | undefined;
}) {
	return (
		input.outcomeStatus === "completed" &&
		input.executionMode === "implementation" &&
		!input.usesE2eFixture &&
		!input.securityOracleSkipped &&
		input.allowFinalize !== true
	);
}

async function persistSecurityOracleSkipped(
	input: { runId: string; taskId: string },
	settings: Awaited<
		ReturnType<typeof getProjectSecurityIntelligenceSettings>
	> | null,
	reasonOverride?: string,
) {
	const reason =
		reasonOverride ??
		settings?.securityOracle.reason ??
		"measurement_unavailable";
	await repo.createRunEvent({
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: new Date().toISOString(),
		type: "system.info",
		severity: "info",
		actor: "system",
		message: `Security Oracle was skipped by the effective Project policy (${reason}).`,
		data: {
			action: "security.oracle_gate_skipped",
			status: "skipped",
			reason,
			eligibility: settings?.eligibility ?? null,
			storedEnabled: settings?.settings.securityOracleEnabled ?? null,
		},
	});
}

function hasOpenTodos(
	todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>,
) {
	return todos.some((todo) => ["pending", "running"].includes(todo.status));
}
