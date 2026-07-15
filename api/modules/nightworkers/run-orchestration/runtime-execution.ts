import type { TaskRunStatus } from "../../../db/schema";
import { logger } from "../../../lib/logger";
import { runE2eFixtureRuntime } from "../../../services/agent-runtime/e2e-fixture-runtime";
import { createLedgerSink } from "../../../services/agent-runtime/ledger-sink";
import {
	buildOpenTodoRuntimeContractWarning,
	mergeRuntimeContractSnapshot,
	normalizeRuntimeContractWarnings,
	summarizeRuntimeContractWarnings,
} from "../../../services/agent-runtime/shared";
import type { AgentRuntimeResult } from "../../../services/agent-runtime/types";
import {
	continueMissionPilotAfterRun,
	resolveMissionPilotParentTaskStatus,
} from "../../missionPilot/mission-pilot-post-queue-coordinator.service";
import {
	executeMissionPilotContinuation,
	markMissionPilotContinuationFailed,
} from "../../missionPilot/mission-pilot-runtime-continuation.service";
import {
	boundaryAuditEventSeverity,
	buildOntologyBoundaryAuditSnapshot,
} from "../../ontology";
import {
	autoStartReviewSessionForRun,
	finalizeReviewRunFromRuntime,
	startReviewRunForSession,
} from "../../review";
import { safelyContinueReviewCorrectionAfterRun } from "../../review/review-correction-continuation.service";
import { outcomeFromRuntimeResult } from "../nightworkers.basic.service";
import * as repo from "../nightworkers.repository";
import { createPlanningArtifactMessageIfNeeded } from "../nightworkers.workbench.service";
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
import { refreshConversationContextForRuntimeLane } from "./runtime-conversation-closeout";
import { handleRuntimeExecutionFailure } from "./runtime-execution-failure";
import type { LaunchRuntimeExecutionInput } from "./runtime-execution-types";
import { readRuntimeFailureTerminalReason } from "./runtime-failure";
import { appendTestModeNextStepLink } from "./runtime-final-report";
import { ACTIVE_RUN_HEARTBEAT_INTERVAL_MS } from "./runtime-heartbeat";
import {
	recordPreservedNeedsHumanOutcome,
	resolveRuntimeOutcomeGuard,
} from "./runtime-outcome-guard";

export {
	appendTestModeNextStepLink,
	sanitizeReviewFinalReportLinks,
} from "./runtime-final-report";

type RuntimeTerminalStatus = Parameters<
	typeof finalizeReviewRunFromRuntime
>[0]["status"];

function isRuntimeTerminalStatus(
	status: TaskRunStatus,
): status is RuntimeTerminalStatus {
	return [
		"blocked",
		"cancelled",
		"completed",
		"failed",
		"needs_human",
		"needs_review",
		"timed_out",
	].includes(status);
}

import { safelyCreateReviewRecommendation } from "./runtime-routing";
import {
	isSecurityOracleFinalizationBlocked,
	resolveRuntimeSecurityCloseout,
} from "./runtime-security-closeout";
import {
	assertRunStatusTransition,
	resolveGuardedRunOutcomeStatus,
	runStatusTransitionTable,
} from "./status";
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

export function launchRuntimeExecution(input: LaunchRuntimeExecutionInput) {
	const {
		taskId,
		task,
		run,
		repoInfo,
		compiledPromptText,
		runtimeLatestUserMessage,
		runtimeImageAttachments,
		runtimeContextSnapshot,
		runtimeOptions,
		runtimeLaneDefinition,
		runtimeLaneResolution,
		agentModeSessionId,
	} = input;
	const runtime = runtimeLaneDefinition.createAdapter();
	const sink = createLedgerSink(run.id);
	const usesE2eFixture =
		process.env.NIGHTWORKERS_E2E === "1" &&
		process.env.NIGHTWORKERS_E2E_RUNTIME_FIXTURE === "1";

	void (async () => {
		try {
			await repo.updateTaskStatus(taskId, "running");
			const runtimeTodosBeforeStart = await repo.listTaskRunTodosForRun(run.id);
			const heartbeatTimer = setInterval(() => {
				void Promise.all([
					repo.refreshImplementationQueueLeaseForRun({
						runId: run.id,
						leaseTtlMs: IMPLEMENTATION_QUEUE_LEASE_TTL_MS,
					}),
					repo.heartbeatActiveTaskRun(run.id),
				]);
			}, ACTIVE_RUN_HEARTBEAT_INTERVAL_MS);
			heartbeatTimer.unref?.();
			let runtimeResult: AgentRuntimeResult;
			try {
				await Promise.all([
					repo.refreshImplementationQueueLeaseForRun({
						runId: run.id,
						leaseTtlMs: IMPLEMENTATION_QUEUE_LEASE_TTL_MS,
					}),
					repo.heartbeatActiveTaskRun(run.id),
				]);
				runtimeResult = usesE2eFixture
					? await runE2eFixtureRuntime(
							{
								runId: run.id,
								taskId,
								agentModeSessionId,
								repositoryId: task.repositoryId,
								repoRoot: repoInfo.localPath,
								compiledPrompt: compiledPromptText,
								latestUserMessage: runtimeLatestUserMessage,
								imageAttachments: runtimeImageAttachments,
								timeoutSeconds: task.timeoutSeconds ?? 3600,
								safetyPolicy: repoInfo.safetyPolicy || undefined,
								contextSnapshot: runtimeContextSnapshot,
								runtimeOptions,
								todoPlan: runtimeTodosBeforeStart.map(
									toAgentRuntimeTodoContext,
								),
							},
							sink,
						)
					: await runtime.start(
							{
								runId: run.id,
								taskId,
								agentModeSessionId,
								repositoryId: task.repositoryId,
								repoRoot: repoInfo.localPath,
								compiledPrompt: compiledPromptText,
								latestUserMessage: runtimeLatestUserMessage,
								imageAttachments: runtimeImageAttachments,
								timeoutSeconds: task.timeoutSeconds ?? 3600,
								safetyPolicy: repoInfo.safetyPolicy || undefined,
								contextSnapshot: runtimeContextSnapshot,
								runtimeOptions,
								todoPlan: runtimeTodosBeforeStart.map(
									toAgentRuntimeTodoContext,
								),
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
			const runtimeContractWarningSummary = summarizeRuntimeContractWarnings(
				runtimeContractWarnings,
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
					contractWarningSummary: runtimeContractWarningSummary,
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
				const statusBeforeCancel = latestRunBeforeFinalize?.status || "running";
				const cancelStatus = resolveGuardedRunOutcomeStatus({
					currentStatus: statusBeforeCancel,
					outcomeStatus: "cancelled",
					finalizationBlocked: false,
				});
				if (cancelStatus !== "cancelled") return;
				assertRunStatusTransition(statusBeforeCancel, "cancelled");
				const cancelledRun = await repo.updateTaskRunIfStatusWithoutPublish(
					run.id,
					statusBeforeCancel,
					{
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
					},
				);
				if (!cancelledRun) return;
				const todosBeforeCancelCloseout = await repo.listTaskRunTodosForRun(
					run.id,
				);
				await closeOpenTodosForCancelledRun({
					runId: run.id,
					taskId,
					todos: todosBeforeCancelCloseout,
					evidence: runtimeResult.stoppedBy || runtimeResult.terminalState,
				});
				await repo.updateTaskStatus(taskId, "ready");
				await completeImplementationQueueEntryForRun(run.id, "cancelled");
				await finalizeReviewRunFromRuntime({
					runId: run.id,
					taskId,
					status: "cancelled",
					contextSnapshot: contextSnapshotWithBoundaryAudit,
					runtimeResult,
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
						status: "cancelled",
					},
				});
				await refreshConversationContextForRuntimeLane({
					runtimeLaneResolution,
					taskId,
					runId: run.id,
				});
				await repo.publishTaskRunUpdate(cancelledRun);
				return;
			}

			let statusBeforeFinalize = latestRunBeforeFinalize?.status || "running";
			const transitionTable: Record<string, readonly string[]> =
				runStatusTransitionTable;
			const canEnterFinalizing =
				statusBeforeFinalize === "finalizing" ||
				transitionTable[statusBeforeFinalize]?.includes("finalizing") === true;
			let enteredFinalizing = statusBeforeFinalize === "finalizing";

			if (statusBeforeFinalize !== "finalizing" && canEnterFinalizing) {
				assertRunStatusTransition(statusBeforeFinalize, "finalizing");
				const finalizingRun = await repo.updateTaskRunIfStatus(
					run.id,
					statusBeforeFinalize,
					{
						status: "finalizing",
						logContent: runtimeResult.logContent,
						diffPatch: runtimeResult.diffPatch,
						testResults: runtimeResult.testResults,
						finalReport: runtimeResult.finalReport,
						summary: runtimeResult.summary,
					},
				);
				enteredFinalizing = Boolean(finalizingRun);
				if (finalizingRun) {
					statusBeforeFinalize = "finalizing";
					await repo.updateTaskStatus(taskId, "finalizing");
				} else {
					statusBeforeFinalize =
						(await repo.getTaskRun(run.id))?.status ?? statusBeforeFinalize;
				}
			} else {
				await repo.updateTaskRunIfStatus(run.id, statusBeforeFinalize, {
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
			let finalTodos = await repo.listTaskRunTodosForRun(run.id);
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
			const securityCloseout = await resolveRuntimeSecurityCloseout({
				runId: run.id,
				taskId,
				repositoryId: repoInfo.id,
				repoRoot: repoInfo.localPath,
				executionMode: runtimeContextSnapshot.executionMode ?? "implementation",
				outcomeStatus: outcome.status,
				finalTodos,
				skipSecurityOracle: usesE2eFixture,
			});
			finalTodos = securityCloseout.finalTodos;
			const securityGate = securityCloseout.securityGate;
			const securityOracleSkipped = securityCloseout.securityOracleSkipped;
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
			const securityFinalizationBlocked = isSecurityOracleFinalizationBlocked({
				outcomeStatus: outcome.status,
				executionMode: runtimeContextSnapshot.executionMode,
				usesE2eFixture,
				securityOracleSkipped,
				allowFinalize: securityGate?.allowFinalize,
			});
			const outcomeGuard = resolveRuntimeOutcomeGuard({
				currentStatus: statusBeforeFinalize,
				outcomeStatus: outcome.status,
				todoFinalizationBlocked,
				securityFinalizationBlocked,
				openTodoSummary: openTodos
					.map((todo) => `#${todo.seq} ${todo.title} (${todo.status})`)
					.join(", "),
				securityGateMessage: securityGate?.message,
			});
			const guardedStatus = outcomeGuard.status;
			if (!isRuntimeTerminalStatus(guardedStatus)) return;
			const baseFinalReport =
				outcomeGuard.reportNotes.length > 0
					? [
							runtimeResult.finalReport || outcome.summary,
							"",
							...outcomeGuard.reportNotes,
						].join("\n")
					: runtimeResult.finalReport || outcome.summary;
			const finalReport = appendTestModeNextStepLink({
				finalReport: baseFinalReport,
				taskId,
				executionMode: runtimeContextSnapshot.executionMode ?? "implementation",
				status: guardedStatus,
				repoRoot: repoInfo.localPath,
			});
			const statusBeforeOutcome = statusBeforeFinalize;
			assertRunStatusTransition(statusBeforeOutcome, guardedStatus);
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
			if (outcomeGuard.externallyHeldStatus) {
				await recordPreservedNeedsHumanOutcome({
					runId: run.id,
					taskId,
					previousStatus: statusBeforeFinalize,
					runtimeOutcomeStatus: outcome.status,
					nextStatus: guardedStatus,
				});
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
			await refreshConversationContextForRuntimeLane({
				runtimeLaneResolution,
				taskId,
				runId: run.id,
			});
			// Publish the terminal status only after all closeout writes have
			// completed. Consumers use a terminal run as a handoff boundary and
			// must not start the next mode while this run still owns SQLite writes.
			let finalizedRun = await repo.updateTaskRunIfStatusWithoutPublish(
				run.id,
				statusBeforeOutcome,
				{
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
					summary:
						outcomeGuard.summary || runtimeResult.summary || outcome.summary,
				},
			);
			let finalStatus: TaskRunStatus = guardedStatus;
			if (!finalizedRun) {
				const concurrentRun = await repo.getTaskRun(run.id);
				if (!concurrentRun) {
					throw new Error("Task run disappeared during runtime finalization.");
				}
				finalizedRun = concurrentRun;
				finalStatus = concurrentRun.status;
				await repo.createRunEvent({
					version: 1,
					runId: run.id,
					taskId,
					timestamp: new Date().toISOString(),
					type: "run.outcome_decided",
					severity: "warning",
					actor: "system",
					message:
						"Runtime terminal outcome did not overwrite a concurrently changed run status.",
					data: {
						expectedStatus: statusBeforeOutcome,
						runtimeOutcomeStatus: guardedStatus,
						preservedStatus: finalStatus,
					},
				});
			}
			if (!isRuntimeTerminalStatus(finalStatus)) {
				return;
			}
			const parentTaskStatus = await resolveMissionPilotParentTaskStatus({
				runId: run.id,
				runStatus: finalStatus,
				executionMode: runtimeContextSnapshot.executionMode ?? "implementation",
			});
			await repo.updateTaskStatus(taskId, parentTaskStatus);
			await completeImplementationQueueEntryForRun(run.id, finalStatus);
			await repo.publishTaskRunUpdate(finalizedRun);
			await finalizeReviewRunFromRuntime({
				runId: run.id,
				taskId,
				status: finalStatus,
				contextSnapshot: contextSnapshotWithBoundaryAudit,
				runtimeResult: { ...runtimeResult, finalReport },
			});
			const reviewRunStartedByCorrection =
				await safelyContinueReviewCorrectionAfterRun({
					taskId,
					runId: run.id,
					status: finalStatus,
					contextSnapshot: contextSnapshotWithBoundaryAudit,
				});
			let reviewRunStartedByMissionPilot = false;
			try {
				const missionContinuation = await continueMissionPilotAfterRun({
					taskId,
					runId: run.id,
					executionMode:
						runtimeContextSnapshot.executionMode ?? "implementation",
					runStatus: finalStatus,
				});
				await executeMissionPilotContinuation(missionContinuation);
				reviewRunStartedByMissionPilot =
					missionContinuation.kind === "start_review";
			} catch (error) {
				await markMissionPilotContinuationFailed(run.id, error);
				logger.error(
					{ error: toErrorMessage(error), runId: run.id },
					"Mission Pilot continuation failed after the run was finalized",
				);
			}
			if (
				finalStatus === "needs_review" &&
				(runtimeContextSnapshot.executionMode ?? "implementation") !==
					"review" &&
				!reviewRunStartedByCorrection &&
				!reviewRunStartedByMissionPilot
			) {
				try {
					const reviewSession = await autoStartReviewSessionForRun(run.id);
					await startReviewRunForSession(reviewSession.session.id);
				} catch (error) {
					logger.warn(
						{ error: toErrorMessage(error), runId: run.id },
						"failed to auto-start Review Run",
					);
					await repo.createRunEvent({
						version: 1,
						runId: run.id,
						taskId,
						timestamp: new Date().toISOString(),
						type: "review.required_section_auto_failed",
						severity: "warning",
						actor: "system",
						message: "Review Run could not be automatically started.",
						data: { error: toErrorMessage(error) },
					});
				}
			}
			if (shouldContinueSessionQueue(finalStatus)) {
				void runSessionQueueForRepository(task.repositoryId);
			}
		} catch (err: unknown) {
			await handleRuntimeExecutionFailure({
				error: err,
				taskId,
				task,
				run,
				runtimeLaneResolution,
				runtimeContextSnapshot: input.runtimeContextSnapshot,
			});
		}
	})();
}
