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
	summarizeRuntimeContractWarnings,
} from "../../../services/agent-runtime/shared";
import type { AgentRuntimeResult } from "../../../services/agent-runtime/types";
import type { RuntimePromptSnapshot } from "../../../services/todo-context";
import { outcomeFromRuntimeResult } from "../nightworkers.basic.service";
import * as repo from "../nightworkers.repository";
import { autoStartReviewSessionForRun } from "../nightworkers.review-mode.service";
import { finalizeReviewRunFromRuntime } from "../nightworkers.review-run-finalize.service";
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

const TEST_MODE_NEXT_STEP_LABEL =
	"テストモードに入り、完了条件テストの構築をする";
const REVIEW_MODE_NEXT_STEP_LABEL = "レビューモードに移行する";
const TEST_MODE_REVIEW_FIX_SYSTEM_CONTEXT =
	"コードレビューをしてください。改善するべき点が無くなるまで改善してください";
const TEST_MODE_REVIEW_UNRESOLVED_MARKER =
	"Test Mode reviewer_evaluation returned unresolved review findings.";

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

export function appendTestModeNextStepLink(input: {
	finalReport: string;
	taskId: string;
	executionMode?: RuntimePromptSnapshot["executionMode"] | null;
	status: AgentRuntimeResult["terminalState"];
}) {
	let report = input.finalReport.trim();
	if (input.executionMode === "test") {
		if (input.status !== "completed" && input.status !== "needs_review") {
			return report;
		}
		report = stripTestModeFollowUpSuggestions(report);
		const href = `/sessions/${encodeURIComponent(input.taskId)}?artifact=review_status`;
		report = removeReviewModeNextStepLinks(report);
		const link = `[${REVIEW_MODE_NEXT_STEP_LABEL}](${href})`;
		return report ? `${report}\n\n${link}` : link;
	}
	if (input.status !== "completed" && input.status !== "needs_review")
		return report;
	if (input.executionMode !== "implementation") return report;
	if (
		report.includes(TEST_MODE_NEXT_STEP_LABEL) ||
		report.includes("artifact=test_mode")
	) {
		return report;
	}
	const href = `/sessions/${encodeURIComponent(input.taskId)}?artifact=test_mode`;
	return [report, "", `[${TEST_MODE_NEXT_STEP_LABEL}](${href})`]
		.filter(Boolean)
		.join("\n");
}

function stripTestModeFollowUpSuggestions(report: string) {
	const lines = report.split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim().startsWith("必要なら次"));
	if (start < 0) return report.trim();
	const end = lines.findIndex(
		(line, index) =>
			index > start &&
			(line.includes(REVIEW_MODE_NEXT_STEP_LABEL) ||
				line.includes("artifact=review_status")),
	);
	const stripped =
		end >= 0
			? [...lines.slice(0, start), ...lines.slice(end)]
			: lines.slice(0, start);
	return stripped
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function removeReviewModeNextStepLinks(report: string) {
	return report
		.split(/\r?\n/)
		.filter(
			(line) =>
				!line.includes(REVIEW_MODE_NEXT_STEP_LABEL) &&
				!line.includes("artifact=review_status"),
		)
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export type TestModeReviewFeedback = {
	verdict: string;
	status: string | null;
	blockingFindingCount: number;
	findings: Array<{
		severity: string | null;
		title: string;
		body: string | null;
	}>;
};

export function findUnresolvedTestModeReviewFeedback(
	events: Array<{ payloadJson?: unknown }>,
): TestModeReviewFeedback | null {
	let latestReview: TestModeReviewFeedback | null = null;
	for (const event of events) {
		const payload = asRecord(event.payloadJson);
		const runEvent = asRecord(payload.runEvent);
		if (readString(runEvent.type) !== "review.evaluation_finished") continue;
		const data = asRecord(runEvent.data);
		const reviewResult = asRecord(data.reviewResult);
		const verdict =
			readString(data.finalReviewerVerdict) ||
			readString(reviewResult.verdict) ||
			"";
		const findings = readFindings(reviewResult.findings);
		const blockingFindingCount =
			readNumber(data.blockingFindingCount) ??
			findings.filter((finding) => finding.severity === "blocking").length;
		latestReview = {
			verdict,
			status: readString(data.status),
			blockingFindingCount,
			findings,
		};
	}
	if (!latestReview) return null;
	if (
		latestReview.verdict === "changes_requested" ||
		latestReview.blockingFindingCount > 0
	) {
		return latestReview;
	}
	return null;
}

export function appendTestModeReviewFixRequired(input: {
	finalReport: string;
	feedback: TestModeReviewFeedback;
}) {
	const report = sanitizeTestModeReviewFinalReport(input.finalReport);
	if (report.includes(TEST_MODE_REVIEW_UNRESOLVED_MARKER)) return report;
	const findingLines = input.feedback.findings
		.slice(0, 5)
		.map((finding) =>
			[
				`- ${finding.severity || "finding"}: ${finding.title}`,
				finding.body ? `  ${finding.body}` : null,
			]
				.filter(Boolean)
				.join("\n"),
		);
	return [
		report,
		"",
		`${TEST_MODE_REVIEW_UNRESOLVED_MARKER} This run is not complete.`,
		"未解決のレビュー指摘が残っています。修正後に必要な run_check / completion_check を再実行し、reviewer_evaluation が approved になるまで完了扱いにしません。",
		...findingLines,
	]
		.filter(Boolean)
		.join("\n");
}

function sanitizeTestModeReviewFinalReport(finalReport: string) {
	return finalReport
		.split(/\r?\n/)
		.filter((line) => {
			const trimmed = line.trim();
			if (trimmed.startsWith("SystemContext:")) return false;
			if (trimmed.includes(TEST_MODE_REVIEW_FIX_SYSTEM_CONTEXT)) return false;
			if (
				trimmed.startsWith("Action:") &&
				(trimmed.includes("reviewer_evaluation") ||
					trimmed.includes("指摘を即座に修正") ||
					trimmed.includes("approved になるまで"))
			) {
				return false;
			}
			return true;
		})
		.join("\n")
		.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function readString(value: unknown) {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readFindings(value: unknown) {
	return Array.isArray(value)
		? value.map((item) => {
				const finding = asRecord(item);
				return {
					severity: readString(finding.severity),
					title: readString(finding.title) || "Untitled review finding",
					body: readString(finding.body),
				};
			})
		: [];
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
			const testModeReviewFeedback =
				runtimeContextSnapshot.executionMode === "test" &&
				outcome.status === "completed"
					? findUnresolvedTestModeReviewFeedback(
							await repo.listTaskEventsForRun(run.id),
						)
					: null;
			const testModeReviewCloseoutBlocked = Boolean(testModeReviewFeedback);
			const openTodoWarning = todoFinalizationBlocked
				? buildOpenTodoRuntimeContractWarning(openTodos)
				: null;
			const finalContractWarnings = openTodoWarning
				? [...runtimeContractWarnings, openTodoWarning]
				: runtimeContractWarnings;
			const guardedStatus =
				todoFinalizationBlocked || testModeReviewCloseoutBlocked
					? "needs_human"
					: outcome.status;
			const baseFinalReport = testModeReviewFeedback
				? appendTestModeReviewFixRequired({
						finalReport: runtimeResult.finalReport || outcome.summary,
						feedback: testModeReviewFeedback,
					})
				: todoFinalizationBlocked
					? [
							runtimeResult.finalReport || outcome.summary,
							"",
							`Todo closeout incomplete: ${openTodos.map((todo) => `#${todo.seq} ${todo.title} (${todo.status})`).join(", ")}`,
							"Codex contract warning: codex_open_todos_before_completion.",
						]
							.filter(Boolean)
							.join("\n")
					: runtimeResult.finalReport || outcome.summary;
			const finalReport = appendTestModeNextStepLink({
				finalReport: baseFinalReport,
				taskId,
				executionMode: runtimeContextSnapshot.executionMode,
				status: guardedStatus,
			});
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
			if (testModeReviewFeedback) {
				await repo.createRunEvent({
					version: 1,
					runId: run.id,
					taskId,
					timestamp: new Date().toISOString(),
					type: "run.outcome_decided",
					severity: "warning",
					actor: "system",
					message:
						"Test Mode reviewer feedback remains unresolved; run cannot be marked completed.",
					data: {
						warningCode: "test_mode_review_findings_unresolved",
						systemContext: TEST_MODE_REVIEW_FIX_SYSTEM_CONTEXT,
						terminalState: outcome.status,
						nextStatus: guardedStatus,
						reviewerFeedback: testModeReviewFeedback,
					},
				});
			}
			await repo.updateTaskStatus(taskId, guardedStatus);
			await completeImplementationQueueEntryForRun(run.id, guardedStatus);
			await finalizeReviewRunFromRuntime({
				runId: run.id,
				taskId,
				status: guardedStatus,
				contextSnapshot: contextSnapshotWithBoundaryAudit,
				runtimeResult: {
					...runtimeResult,
					finalReport,
				},
			});
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
			const latestFailedRun = await repo.getTaskRun(run.id);
			await finalizeReviewRunFromRuntime({
				runId: run.id,
				taskId,
				status: "failed",
				contextSnapshot:
					latestFailedRun?.contextSnapshot ?? input.runtimeContextSnapshot,
				runtimeResult: {
					terminalState: "failed",
					summary: `Execution crashed: ${errorMessage}`,
					finalReport,
					stoppedBy: "llm_error",
					riskLevel: "high",
					logContent: `[System Error] ${errorMessage}`,
				},
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
