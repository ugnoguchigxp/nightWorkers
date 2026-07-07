import { logger } from "../../../lib/logger";
import { createLedgerSink } from "../../../services/agent-runtime/ledger-sink";
import {
	boundaryAuditEventSeverity,
	buildOntologyBoundaryAuditSnapshot,
} from "../../../services/agent-runtime/ontology-runtime-context";
import type { resolveRuntimeLaneDefinition } from "../../../services/agent-runtime/registry";
import type { RuntimeLaneResolution } from "../../../services/agent-runtime/runtime-lane";
import {
	buildOpenTodoRuntimeContractWarning,
	mergeRuntimeContractSnapshot,
	normalizeRuntimeContractWarnings,
} from "../../../services/agent-runtime/shared";
import type { AgentRuntimeResult } from "../../../services/agent-runtime/types";
import type { RuntimePromptSnapshot } from "../../../services/todo-context";
import { outcomeFromRuntimeResult } from "../nightworkers.basic.service";
import * as repo from "../nightworkers.repository";
import { autoStartReviewSessionForRun } from "../nightworkers.review-mode.service";
import { createPlanningArtifactMessageIfNeeded } from "../nightworkers.workbench.service";
import {
	applyCoverageAutonomyFallback,
	readRuntimeFailureTerminalReason,
} from "./coverage-autonomy";
import {
	parseChangedPathsFromDiff,
	updateCommitOwnershipEvidence,
} from "./git-ownership";
import {
	completeImplementationQueueEntryForRun,
	IMPLEMENTATION_QUEUE_LEASE_TTL_MS,
	runSessionQueueForRepository,
	shouldContinueSessionQueue,
} from "./queues";
import {
	safelyCreateReviewRecommendation,
	safelyRefreshConversationContext,
} from "./runtime-routing";
import { assertRunStatusTransition, runStatusTransitionTable } from "./status";
import {
	closeOpenTodosForCancelledRun,
	closeOpenTodosForFailedRun,
	closePendingTodosForNeedsHumanRun,
	isPlanningOnlyRun,
	listOpenTodos,
	markRunningTodosNeedsHuman,
	toAgentRuntimeTodoContext,
} from "./todo-closeout";
import { toErrorMessage } from "./utils";

type RuntimeLaneDefinition = ReturnType<typeof resolveRuntimeLaneDefinition>;

type RuntimeOptions = Parameters<
	ReturnType<RuntimeLaneDefinition["createAdapter"]>["start"]
>[0]["runtimeOptions"];

type LaunchRuntimeExecutionInput = {
	taskId: string;
	task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>;
	run: NonNullable<Awaited<ReturnType<typeof repo.getTaskRun>>>;
	repoInfo: NonNullable<Awaited<ReturnType<typeof repo.getRepository>>>;
	compiledPromptText: string;
	runtimeLatestUserMessage: string;
	runtimeContextSnapshot: RuntimePromptSnapshot;
	runtimeOptions: RuntimeOptions;
	runtimeLaneDefinition: RuntimeLaneDefinition;
	runtimeLaneResolution: RuntimeLaneResolution;
};

async function refreshConversationContextForRuntimeLane(input: {
	runtimeLaneResolution: RuntimeLaneResolution;
	taskId: string;
	runId: string;
}) {
	if (input.runtimeLaneResolution.lane === "codex-sdk") return;
	await safelyRefreshConversationContext({
		taskId: input.taskId,
		runId: input.runId,
		reason: "run_finished",
	});
}

export function launchRuntimeExecution(input: LaunchRuntimeExecutionInput) {
	const {
		taskId,
		task,
		run,
		repoInfo,
		compiledPromptText,
		runtimeLatestUserMessage,
		runtimeContextSnapshot,
		runtimeOptions,
		runtimeLaneDefinition,
		runtimeLaneResolution,
	} = input;
	const runtime = runtimeLaneDefinition.createAdapter();
	const sink = createLedgerSink(run.id);

	void (async () => {
		try {
			await repo.updateTaskStatus(taskId, "running");
			const runtimeTodosBeforeStart = await repo.listTaskRunTodosForRun(run.id);
			const heartbeatIntervalMs = Math.min(
				60_000,
				Math.floor(IMPLEMENTATION_QUEUE_LEASE_TTL_MS / 3),
			);
			const heartbeatTimer = setInterval(() => {
				void repo.refreshImplementationQueueLeaseForRun({
					runId: run.id,
					leaseTtlMs: IMPLEMENTATION_QUEUE_LEASE_TTL_MS,
				});
			}, heartbeatIntervalMs);
			heartbeatTimer.unref?.();
			let runtimeResult: AgentRuntimeResult;
			try {
				await repo.refreshImplementationQueueLeaseForRun({
					runId: run.id,
					leaseTtlMs: IMPLEMENTATION_QUEUE_LEASE_TTL_MS,
				});
				runtimeResult = await runtime.start(
					{
						runId: run.id,
						taskId,
						repositoryId: task.repositoryId,
						repoRoot: repoInfo.localPath,
						compiledPrompt: compiledPromptText,
						latestUserMessage: runtimeLatestUserMessage,
						timeoutSeconds: task.timeoutSeconds ?? 3600,
						safetyPolicy: repoInfo.safetyPolicy || undefined,
						contextSnapshot: runtimeContextSnapshot,
						runtimeOptions,
						todoPlan: runtimeTodosBeforeStart.map(toAgentRuntimeTodoContext),
						currentTodo: runtimeTodosBeforeStart
							.filter((todo) => todo.status === "running")
							.sort((a, b) => a.seq - b.seq)
							.map(toAgentRuntimeTodoContext)[0],
					},
					sink,
				);
			} finally {
				clearInterval(heartbeatTimer);
			}
			await repo.refreshImplementationQueueLeaseForRun({
				runId: run.id,
				leaseTtlMs: IMPLEMENTATION_QUEUE_LEASE_TTL_MS,
			});
			const latestRunBeforeFinalize = await repo.getTaskRun(run.id);
			const stopWasRequested =
				latestRunBeforeFinalize?.status === "cancelled" ||
				runtimeResult.terminalState === "cancelled";
			const runtimeContractWarnings = normalizeRuntimeContractWarnings(
				runtimeResult.contractWarnings,
			);
			const contextSnapshotBeforeFinalize =
				latestRunBeforeFinalize?.contextSnapshot ?? runtimeContextSnapshot;

			await repo.createRunEvent({
				version: 1,
				runId: run.id,
				taskId,
				timestamp: new Date().toISOString(),
				type: "run.runtime_finished",
				severity: "checkpoint",
				actor: "runtime",
				message: `Runtime execution finished with terminal status: ${runtimeResult.terminalState}.`,
				data: {
					terminalState: runtimeResult.terminalState,
					stoppedBy: runtimeResult.stoppedBy,
					riskLevel: runtimeResult.riskLevel,
					contractWarnings: runtimeContractWarnings,
				},
			});
			await updateCommitOwnershipEvidence({
				runId: run.id,
				diffPatch: runtimeResult.diffPatch,
				testResults: runtimeResult.testResults,
			});
			const ontologyBoundaryAudit = await buildOntologyBoundaryAuditSnapshot({
				repoRoot: repoInfo.localPath,
				ontologyContext:
					contextSnapshotBeforeFinalize &&
					typeof contextSnapshotBeforeFinalize === "object" &&
					!Array.isArray(contextSnapshotBeforeFinalize)
						? (contextSnapshotBeforeFinalize as Record<string, unknown>)
								.ontologyContext
						: null,
				touchedFiles: parseChangedPathsFromDiff(runtimeResult.diffPatch),
			});
			const contextSnapshotWithBoundaryAudit = {
				...(contextSnapshotBeforeFinalize &&
				typeof contextSnapshotBeforeFinalize === "object" &&
				!Array.isArray(contextSnapshotBeforeFinalize)
					? contextSnapshotBeforeFinalize
					: runtimeContextSnapshot),
				ontologyBoundaryAudit,
			};
			await repo.createRunEvent({
				version: 1,
				runId: run.id,
				taskId,
				timestamp: new Date().toISOString(),
				type: "system.info",
				severity: boundaryAuditEventSeverity(ontologyBoundaryAudit),
				actor: "runtime",
				message: ontologyBoundaryAudit.available
					? `Ontology boundary audit completed with decision=${ontologyBoundaryAudit.decision}.`
					: "Ontology boundary audit skipped or unavailable.",
				data: {
					action: "ontology.boundary_closeout_audit",
					ontologyBoundaryAudit,
				},
			});

			if (stopWasRequested) {
				const outcome = outcomeFromRuntimeResult(runtimeResult);
				const finalReport = runtimeResult.finalReport || outcome.summary;
				const todosBeforeCancelCloseout = await repo.listTaskRunTodosForRun(
					run.id,
				);
				await closeOpenTodosForCancelledRun({
					runId: run.id,
					taskId,
					todos: todosBeforeCancelCloseout,
					evidence: runtimeResult.stoppedBy || runtimeResult.terminalState,
				});
				assertRunStatusTransition(
					latestRunBeforeFinalize?.status || "running",
					"cancelled",
				);
				await repo.updateTaskRun(run.id, {
					status: "cancelled",
					endedAt: new Date(),
					finishedAt: new Date(),
					logContent: runtimeResult.logContent,
					diffPatch: runtimeResult.diffPatch,
					testResults: runtimeResult.testResults,
					contextSnapshot: mergeRuntimeContractSnapshot(
						contextSnapshotWithBoundaryAudit,
						runtimeContractWarnings,
						{ lane: runtimeLaneResolution.lane },
					),
					finalReport,
					finalJudgment: null,
					summary: runtimeResult.summary || outcome.summary,
				});
				await repo.updateTaskStatus(taskId, "ready");
				await completeImplementationQueueEntryForRun(run.id, "cancelled");
				await repo.createTaskMessage({
					taskId,
					runId: run.id,
					role: "assistant",
					content: finalReport,
					messageType: "text",
					payloadJson: {
						finalReport,
						summary: runtimeResult.summary || outcome.summary,
						status: "cancelled",
					},
				});
				await refreshConversationContextForRuntimeLane({
					runtimeLaneResolution,
					taskId,
					runId: run.id,
				});
				return;
			}

			const preliminaryOutcome = outcomeFromRuntimeResult(runtimeResult);
			const todosBeforeCoverageFallback = await repo.listTaskRunTodosForRun(
				run.id,
			);
			const coverageFallbackBlockedByOpenTodos =
				preliminaryOutcome.status === "completed" &&
				listOpenTodos(todosBeforeCoverageFallback).length > 0 &&
				!isPlanningOnlyRun(todosBeforeCoverageFallback);
			if (!coverageFallbackBlockedByOpenTodos) {
				runtimeResult = await applyCoverageAutonomyFallback({
					runtimeResult,
					repoRoot: repoInfo.localPath,
					safetyPolicy: repoInfo.safetyPolicy || undefined,
					sink,
				});
			}

			const statusBeforeFinalize = latestRunBeforeFinalize?.status || "running";
			const transitionTable: Record<string, readonly string[]> =
				runStatusTransitionTable;
			const canEnterFinalizing =
				statusBeforeFinalize === "finalizing" ||
				transitionTable[statusBeforeFinalize]?.includes("finalizing") === true;
			const enteredFinalizing = canEnterFinalizing;

			if (statusBeforeFinalize !== "finalizing" && canEnterFinalizing) {
				assertRunStatusTransition(statusBeforeFinalize, "finalizing");
				await repo.updateTaskRun(run.id, {
					status: "finalizing",
					logContent: runtimeResult.logContent,
					diffPatch: runtimeResult.diffPatch,
					testResults: runtimeResult.testResults,
					finalReport: runtimeResult.finalReport,
					summary: runtimeResult.summary,
				});
				await repo.updateTaskStatus(taskId, "finalizing");
			} else {
				await repo.updateTaskRun(run.id, {
					logContent: runtimeResult.logContent,
					diffPatch: runtimeResult.diffPatch,
					testResults: runtimeResult.testResults,
					finalReport: runtimeResult.finalReport,
					summary: runtimeResult.summary,
				});
			}
			await repo.createRunEvent({
				version: 1,
				runId: run.id,
				taskId,
				timestamp: new Date().toISOString(),
				type: "run.finalizing_started",
				severity: "info",
				actor: "system",
				message: "Runtime result captured.",
				data: {
					terminalState: runtimeResult.terminalState,
					previousStatus: statusBeforeFinalize,
					finalizingTransitionApplied: enteredFinalizing,
				},
			});

			const outcome = outcomeFromRuntimeResult(runtimeResult);
			let finalTodos = coverageFallbackBlockedByOpenTodos
				? todosBeforeCoverageFallback
				: await repo.listTaskRunTodosForRun(run.id);
			if (outcome.status === "needs_human") {
				await markRunningTodosNeedsHuman({
					runId: run.id,
					taskId,
					todos: finalTodos,
					runtimeResult,
					outcomeStatus: outcome.status,
				});
				finalTodos = await repo.listTaskRunTodosForRun(run.id);
				await closePendingTodosForNeedsHumanRun({
					runId: run.id,
					taskId,
					todos: finalTodos,
					evidence:
						runtimeResult.finalReport ||
						runtimeResult.summary ||
						outcome.summary,
				});
				finalTodos = await repo.listTaskRunTodosForRun(run.id);
			}
			if (outcome.status === "failed") {
				const terminalReason =
					readRuntimeFailureTerminalReason(runtimeResult) ?? outcome.reason;
				await closeOpenTodosForFailedRun({
					runId: run.id,
					taskId,
					todos: finalTodos,
					evidence:
						runtimeResult.finalReport ||
						runtimeResult.summary ||
						outcome.summary,
					terminalReason,
					stoppedBy: runtimeResult.stoppedBy,
				});
				finalTodos = await repo.listTaskRunTodosForRun(run.id);
			}
			const openTodos = listOpenTodos(finalTodos);
			const todoFinalizationBlocked =
				outcome.status === "completed" &&
				openTodos.length > 0 &&
				!isPlanningOnlyRun(finalTodos);
			const openTodoWarning = todoFinalizationBlocked
				? buildOpenTodoRuntimeContractWarning(openTodos)
				: null;
			const finalContractWarnings = openTodoWarning
				? [...runtimeContractWarnings, openTodoWarning]
				: runtimeContractWarnings;
			const guardedStatus = todoFinalizationBlocked
				? "needs_human"
				: outcome.status;
			const finalReport = todoFinalizationBlocked
				? [
						runtimeResult.finalReport || outcome.summary,
						"",
						`Todo closeout incomplete: ${openTodos.map((todo) => `#${todo.seq} ${todo.title} (${todo.status})`).join(", ")}`,
						"Codex contract warning: codex_open_todos_before_completion.",
					]
						.filter(Boolean)
						.join("\n")
				: runtimeResult.finalReport || outcome.summary;
			const statusBeforeOutcome = enteredFinalizing
				? "finalizing"
				: statusBeforeFinalize;
			assertRunStatusTransition(statusBeforeOutcome, guardedStatus);
			await repo.updateTaskRun(run.id, {
				status: guardedStatus,
				endedAt: new Date(),
				finishedAt: new Date(),
				contextSnapshot: mergeRuntimeContractSnapshot(
					contextSnapshotWithBoundaryAudit,
					finalContractWarnings,
					{ lane: runtimeLaneResolution.lane },
				),
				finalReport,
				finalJudgment: null,
				summary: todoFinalizationBlocked
					? "Runtime finished without explicitly closing all open Todos."
					: runtimeResult.summary || outcome.summary,
			});
			if (todoFinalizationBlocked) {
				await repo.createRunEvent({
					version: 1,
					runId: run.id,
					taskId,
					timestamp: new Date().toISOString(),
					type: "run.outcome_decided",
					severity: "warning",
					actor: "system",
					message:
						"Runtime finished before explicit Todo closeout; run cannot be marked completed.",
					data: {
						warningCode: "codex_open_todos_before_completion",
						contractWarning: openTodoWarning,
						terminalState: outcome.status,
						nextStatus: guardedStatus,
						openTodos: openTodos.map((todo) => ({
							id: todo.id,
							seq: todo.seq,
							title: todo.title,
							status: todo.status,
						})),
					},
				});
			}
			await repo.updateTaskStatus(taskId, guardedStatus);
			await completeImplementationQueueEntryForRun(run.id, guardedStatus);
			if (shouldContinueSessionQueue(guardedStatus)) {
				void runSessionQueueForRepository(task.repositoryId);
			}

			await createPlanningArtifactMessageIfNeeded({
				taskId,
				runId: run.id,
				finalReport,
			});
			await repo.createTaskMessage({
				taskId,
				runId: run.id,
				role: "assistant",
				content: finalReport,
				messageType: "text",
				payloadJson: {
					finalReport,
					summary: runtimeResult.summary || outcome.summary,
					status: guardedStatus,
				},
			});
			await safelyCreateReviewRecommendation({ taskId, runId: run.id });
			if (guardedStatus === "needs_review") {
				try {
					await autoStartReviewSessionForRun(run.id);
				} catch (error) {
					logger.warn(
						{ error: toErrorMessage(error), runId: run.id },
						"failed to auto-start Review Mode session",
					);
					await repo.createRunEvent({
						version: 1,
						runId: run.id,
						taskId,
						timestamp: new Date().toISOString(),
						type: "review.required_section_auto_failed",
						severity: "warning",
						actor: "system",
						message: "Review Mode session could not be automatically started.",
						data: { error: toErrorMessage(error) },
					});
				}
			}
			await refreshConversationContextForRuntimeLane({
				runtimeLaneResolution,
				taskId,
				runId: run.id,
			});
		} catch (err: unknown) {
			const errorMessage = toErrorMessage(err);
			logger.error(
				{ error: errorMessage, runId: run.id },
				"NativeLocalRunner execution failed",
			);
			const finalReport = `実行に失敗しました: ${errorMessage}`;
			const todosBeforeFailedCloseout = await repo.listTaskRunTodosForRun(
				run.id,
			);
			await closeOpenTodosForFailedRun({
				runId: run.id,
				taskId,
				todos: todosBeforeFailedCloseout,
				evidence: errorMessage,
			});
			await repo.updateTaskStatus(taskId, "failed");
			assertRunStatusTransition("running", "failed");
			await repo.updateTaskRun(run.id, {
				status: "failed",
				endedAt: new Date(),
				finishedAt: new Date(),
				logContent: `[System Error] ${errorMessage}`,
				finalReport,
				finalJudgment: null,
				summary: `Execution crashed: ${errorMessage}`,
			});
			await completeImplementationQueueEntryForRun(run.id, "failed");
			if (shouldContinueSessionQueue("failed")) {
				void runSessionQueueForRepository(task.repositoryId);
			}

			await repo.createTaskMessage({
				taskId,
				runId: run.id,
				role: "assistant",
				content: finalReport,
				messageType: "text",
				payloadJson: {
					finalReport,
					summary: `Execution crashed: ${errorMessage}`,
					status: "failed",
				},
			});
			await safelyCreateReviewRecommendation({ taskId, runId: run.id });
			await refreshConversationContextForRuntimeLane({
				runtimeLaneResolution,
				taskId,
				runId: run.id,
			});
		}
	})();
}
