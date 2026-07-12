import * as repo from "../../../modules/nightworkers/nightworkers.repository";
import { collectVulnWorkbenchOntologyHandoff } from "../../../modules/ontology/handoff/vulnworkbench-handoff.service";
import { runSecurityOracleGate } from "../../../modules/review/security-gate.service";
import { runFinalizeController } from "../../run-control/finalize-controller";
import { readRunControlKernelMode } from "../../run-control/settings";
import type { ProviderToolCall } from "../../structured-llm/tool-calls";
import type { AgentRunContext, AgentRuntimeSink } from "../types";
import {
	continueWith,
	failedToolResult,
	openTodosRemainToolResult,
} from "./native-api-dispatch-results";
import type {
	NativeApiDispatchResult,
	NativeApiDispatchState,
} from "./native-api-dispatch-types";
import { readNativeApiExecutionMode } from "./native-api-mode";

export async function finalizeAnswer(input: {
	toolCall: ProviderToolCall;
	context: AgentRunContext;
	sink: AgentRuntimeSink;
	state: NativeApiDispatchState;
}): Promise<NativeApiDispatchResult> {
	const finalReport =
		typeof input.toolCall.arguments.finalReport === "string"
			? input.toolCall.arguments.finalReport.trim()
			: "";
	if (!finalReport) {
		return continueWith(
			failedToolResult(
				"INVALID_TOOL_ARGS",
				"finalize_answer requires finalReport.",
			),
			input.state,
		);
	}
	const guard = validateFinalizeGuard(input.state);
	if (guard) {
		return continueWith(
			failedToolResult(guard.code, guard.message),
			input.state,
		);
	}
	if (readRunControlKernelMode(input.context) === "enforce") {
		const controlGuard = await runFinalizeController.evaluateCandidate({
			runId: input.context.runId,
			allowedOpenTodoProcedureIds: ["final_completion_report"],
		});
		if (!controlGuard.allowFinalize) {
			return continueWith(
				failedToolResult(
					controlGuard.code,
					[controlGuard.message, controlGuard.recoveryCard]
						.filter(Boolean)
						.join("\n\n"),
					{ missingConditions: controlGuard.missingConditions },
				),
				input.state,
			);
		}
	}

	const openTodos = (
		await repo.listTaskRunTodosForRun(input.context.runId)
	).filter((todo) => ["pending", "running"].includes(todo.status));
	if (openTodos.length > 0 && !openTodos.every(isFinalCompletionReportTodo)) {
		return continueWith(openTodosRemainToolResult(openTodos), input.state);
	}

	let securityGateReport = "";
	const securityOracle = readSecurityOracleRuntimeOptions(input.context);
	if (
		readNativeApiExecutionMode(input.context) === "implementation" &&
		securityOracle?.enabled
	) {
		const securityGate = await runSecurityOracleGate({
			runId: input.context.runId,
			taskId: input.context.taskId,
			repoRoot: input.context.repoRoot,
			maxIterations: securityOracle.maxIterations,
		});
		if (!securityGate.allowFinalize) {
			return continueWith(
				failedToolResult(
					securityGate.status === "continue"
						? "SECURITY_FIX_REQUIRED"
						: "SECURITY_GATE_NEEDS_HUMAN",
					securityGate.message,
					securityGate,
				),
				input.state,
			);
		}
		securityGateReport = [
			"Security Oracle gate:",
			`- status: ${securityGate.status}`,
			`- scanRunId: ${securityGate.scanRunId ?? "(unknown)"}`,
			`- iteration: ${securityGate.iteration}/${securityGate.maxIterations}`,
			`- comparison: ${securityGate.comparison}`,
		].join("\n");
		if (
			securityOracle.ontologyToolProfile === "ontology_extended" &&
			securityGate.scanRunId
		) {
			const handoff = await collectVulnWorkbenchOntologyHandoff({
				runId: input.context.runId,
				taskId: input.context.taskId,
				scanRunId: securityGate.scanRunId,
			});
			securityGateReport += `\n- ontologyHandoff: ${String(handoff.status)}`;
		}
	}

	if (openTodos.length > 0) {
		const now = new Date();
		for (const todo of openTodos) {
			await repo.updateTaskRunTodo(
				todo.id,
				{
					status: "passed",
					startedAt: todo.startedAt ? new Date(String(todo.startedAt)) : now,
					completedAt: now,
				},
				{
					notifyTaskId: input.context.taskId,
					notifyRunId: input.context.runId,
				},
			);
		}

		const remainingOpenTodos = (
			await repo.listTaskRunTodosForRun(input.context.runId)
		).filter((todo) => ["pending", "running"].includes(todo.status));
		if (remainingOpenTodos.length > 0) {
			return continueWith(
				openTodosRemainToolResult(remainingOpenTodos),
				input.state,
			);
		}
	}

	const finalReportWithSecurityGate = securityGateReport
		? `${finalReport}\n\n${securityGateReport}`
		: finalReport;
	const summary =
		typeof input.toolCall.arguments.summary === "string" &&
		input.toolCall.arguments.summary.trim()
			? input.toolCall.arguments.summary.trim()
			: firstLine(finalReportWithSecurityGate);
	return {
		kind: "final",
		finalReport: finalReportWithSecurityGate,
		summary,
		toolResult: {
			ok: true,
			content: JSON.stringify({
				ok: true,
				summary,
				finalReport: finalReportWithSecurityGate,
			}),
			payload: {
				summary,
				finalReport: finalReportWithSecurityGate,
			},
		},
		state: input.state,
	};
}

function isFinalCompletionReportTodo(todo: {
	taskType?: string | null;
	procedureId?: string | null;
}) {
	return (
		todo.taskType === "completion_report" &&
		todo.procedureId === "final_completion_report"
	);
}

function validateFinalizeGuard(
	state: NativeApiDispatchState,
): { code: string; message: string } | null {
	if (state.importProjectFailed && !state.importProjectSucceeded) {
		return {
			code: "POST_IMPORT_FAILED",
			message:
				"finalize_answer is blocked because import_project failed. Do not use fallback project import or static implementation paths.",
		};
	}
	const importedProject =
		state.importProjectSucceeded || state.copyDirectorySucceeded;
	if (!importedProject) return null;
	if (!state.manifestReadAfterImport && !state.postImport?.manifest) {
		return {
			code: "POST_IMPORT_MANIFEST_REQUIRED",
			message:
				"finalize_answer is blocked after project import until package.json or pyproject.toml is read, or postImport.manifest exists.",
		};
	}
	const recommendedCommands =
		state.postImport?.recommendedVerificationCommands ?? [];
	if (recommendedCommands.length === 0) return null;
	if (state.postImport?.verifiedCommand) return null;
	const successfulCommands = state.successfulVerificationCommands ?? [];
	if (successfulCommands.length > 0) {
		return {
			code: "POST_IMPORT_RECOMMENDED_VERIFICATION_MISMATCH",
			message:
				"finalize_answer is blocked because successful post-import verification did not match any recommended verification command.",
		};
	}
	return {
		code: "POST_IMPORT_VERIFICATION_REQUIRED",
		message:
			"finalize_answer is blocked until at least one recommended post-import verification command succeeds.",
	};
}

function readSecurityOracleRuntimeOptions(context: AgentRunContext) {
	const value = context.runtimeOptions?.securityOracle;
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const options = value as Record<string, unknown>;
	if (options.enabled !== true) return null;
	const maxIterations = options.maxIterations;
	if (
		typeof maxIterations !== "number" ||
		!Number.isInteger(maxIterations) ||
		maxIterations < 1
	) {
		return null;
	}
	return {
		enabled: true as const,
		maxIterations,
		ontologyToolProfile:
			options.ontologyToolProfile === "ontology_extended"
				? ("ontology_extended" as const)
				: ("standard" as const),
	};
}

function firstLine(value: string) {
	return (
		value
			.split(/\r?\n/)
			.find((line) => line.trim())
			?.trim() || value.trim()
	);
}
