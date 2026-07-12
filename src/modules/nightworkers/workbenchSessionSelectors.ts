import type {
	CodexContractWarningSummary,
	CodexMcpDiagnosticsSummary,
	ImplementationQueueEntry,
	ReviewResult,
	Task,
	TaskEvent,
	TaskMessage,
	TaskRun,
	TaskRunTodo,
	WorkbenchPhase,
	WorkbenchProgressBlocker,
	WorkbenchProgressSnapshot,
	WorkbenchSessionGroup,
	WorkbenchSessionView,
} from "./types";
import { buildWorkbenchArtifactRefs } from "./workbenchArtifactSelectors";
import { getRunEventType } from "./workbenchSelectorUtils";

const PROCESSING_TASK_STATUSES = new Set([
	"context_compiling",
	"compiling_context",
	"running",
	"finalizing",
	"verifying",
	"needs_review",
	"needs_human",
	"blocked",
	"timed_out",
]);
const QUEUE_TASK_STATUSES = new Set(["ready", "queued"]);
const ARCHIVE_TASK_STATUSES = new Set(["archived"]);
const ACTIVE_RUN_STATUSES = new Set([
	"context_compiling",
	"compiling_context",
	"running",
	"finalizing",
]);

export type SessionEvidence = {
	latestRun?: TaskRun;
	queueEntry?: ImplementationQueueEntry;
	planReady?: boolean;
	todos?: TaskRunTodo[];
	events?: TaskEvent[];
	reviews?: ReviewResult[];
	messages?: TaskMessage[];
};

type SessionGroupOptions = {
	now?: unknown;
};

export function getSessionGroup(
	task: Task,
	latestRun?: TaskRun,
	_options: SessionGroupOptions = {},
): WorkbenchSessionGroup {
	if (latestRun && ACTIVE_RUN_STATUSES.has(latestRun.status))
		return "processing";
	if (PROCESSING_TASK_STATUSES.has(task.status)) return "processing";
	if (QUEUE_TASK_STATUSES.has(task.status)) return "queue";
	if (task.status === "completed") return "processing";
	if (ARCHIVE_TASK_STATUSES.has(task.status)) return "archive";
	return "processing";
}

export function getSessionPhase(
	task: Task,
	evidence: SessionEvidence = {},
): WorkbenchPhase {
	const latestRun = evidence.latestRun;
	const events = evidence.events || [];
	const todos = evidence.todos || [];
	const reviews = evidence.reviews || [];

	if (
		task.status === "needs_human" ||
		task.status === "blocked" ||
		task.status === "timed_out"
	) {
		return "Needs Attention";
	}
	if (
		latestRun &&
		["needs_human", "blocked", "timed_out"].includes(latestRun.status)
	) {
		return "Needs Attention";
	}
	if (task.status === "archived") return "Archived";
	if (task.status === "cancelled" || task.status === "failed")
		return "Needs Attention";
	if (isReviewNeededSession(task, evidence)) return "Reviewing";
	if (task.status === "completed") return "Completed";
	if (task.status === "queued" || task.status === "ready") return "Queued";
	if (evidence.queueEntry?.status === "queued") return "Queued";
	if (
		task.status === "context_compiling" ||
		latestRun?.status === "context_compiling"
	) {
		return "Prompt Preparing";
	}
	if (latestRun?.status === "needs_review" || task.status === "needs_review")
		return "Reviewing";
	if (reviews.some((review) => review.verdict === "changes_requested"))
		return "Improving";
	if (
		latestRun?.status === "verifying" ||
		task.status === "verifying" ||
		events.some((event) => getRunEventType(event).startsWith("verification."))
	) {
		return "Verifying";
	}
	if (
		latestRun?.status === "running" ||
		task.status === "running" ||
		todos.some((todo) => todo.status === "running")
	) {
		return "Implementing";
	}
	return "Analyzing";
}

export function getSessionEmailState(
	task: Task,
	evidence: SessionEvidence = {},
): WorkbenchSessionView["emailState"] {
	const latestRun = evidence.latestRun;
	const queueStatus = evidence.queueEntry?.status;
	if (task.status === "archived") return "done";
	if (
		task.status === "needs_human" ||
		task.status === "blocked" ||
		task.status === "timed_out" ||
		["needs_human", "blocked", "timed_out"].includes(latestRun?.status || "") ||
		queueStatus === "needs_human"
	) {
		return "needs_input";
	}
	if (
		task.status === "failed" ||
		task.status === "cancelled" ||
		latestRun?.status === "failed" ||
		queueStatus === "failed" ||
		queueStatus === "cancelled"
	) {
		return "failed";
	}
	if (isReviewNeededSession(task, evidence)) return "review_needed";
	if (task.status === "completed") return "done";
	if (
		ACTIVE_RUN_STATUSES.has(latestRun?.status || "") ||
		PROCESSING_TASK_STATUSES.has(task.status) ||
		["claimed", "processing", "awaiting_commit_decision"].includes(
			queueStatus || "",
		)
	) {
		return "running";
	}
	if (task.status === "queued" || queueStatus === "queued") return "queued";
	if (
		task.status === "ready" ||
		evidence.planReady ||
		hasImplementationPlanEvidence(evidence.messages || [])
	) {
		return "plan_ready";
	}
	return "draft";
}

export function getSessionPrimaryAction(
	state: WorkbenchSessionView["emailState"],
): WorkbenchSessionView["primaryAction"] {
	if (state === "plan_ready") return "queue";
	if (state === "queued") return "remove";
	if (state === "running") return "open_run";
	if (state === "needs_input") return "respond";
	if (state === "review_needed") return "review";
	if (state === "failed") return "inspect";
	return "open";
}

export function getSessionProgress(
	task: Task,
	evidence: SessionEvidence = {},
): WorkbenchProgressSnapshot {
	const latestRun = evidence.latestRun;
	const todos = evidence.todos || [];
	const events = evidence.events || [];
	const reviews = evidence.reviews || [];
	const messages = evidence.messages || [];
	const basis: WorkbenchProgressSnapshot["basis"] = [
		{
			kind: "task_status",
			refId: task.id,
			label: `Task status: ${task.status}`,
		},
	];
	const blockers: WorkbenchProgressBlocker[] = [];
	let percent = 0;

	if (
		messages.some((message) => message.role === "user") ||
		task.description?.trim()
	) {
		percent = Math.max(percent, 10);
		basis.push({
			kind: "artifact",
			refId: task.id,
			label: "User message persisted",
		});
	}
	if (task.objective?.trim() || task.acceptanceCriteria?.trim()) {
		percent = Math.max(percent, 20);
		basis.push({
			kind: "artifact",
			refId: task.id,
			label: "Task draft has objective or criteria",
		});
	}
	if (task.compiledPrompt?.trim() || latestRun?.contextSnapshot) {
		percent = Math.max(percent, 30);
		basis.push({
			kind: "prompt_snapshot",
			refId: latestRun?.id,
			label: "Runtime prompt snapshot exists",
		});
	}
	if (latestRun) {
		percent = Math.max(percent, 50);
		basis.push({
			kind: "run_status",
			refId: latestRun.id,
			label: `Latest run: ${latestRun.status}`,
		});
	}
	if (
		todos.length > 0 ||
		events.some((event) => getRunEventType(event) === "turn.started")
	) {
		percent = Math.max(percent, 65);
		basis.push({
			kind: "todo_status",
			refId: latestRun?.id,
			label: "Todo plan or implementation event exists",
		});
	}
	if (
		latestRun?.testResults ||
		events.some((event) => getRunEventType(event).startsWith("verification."))
	) {
		percent = Math.max(percent, 75);
		basis.push({
			kind: "run_event",
			refId: latestRun?.id,
			label: "Verification record exists",
		});
	}
	if (
		reviews.some((review) => review.verdict === "approved") ||
		latestRun?.status === "needs_review"
	) {
		percent = Math.max(percent, 85);
		basis.push({
			kind: "review_result",
			refId: reviews[0]?.id,
			label: "Review evidence exists",
		});
	}
	if (task.status === "completed") percent = 100;

	if (task.status === "needs_human") {
		blockers.push({
			kind: "needs_human",
			message: "Task requires human input",
			evidenceRef: task.id,
		});
	}
	if (task.status === "blocked") {
		blockers.push({
			kind: "runtime",
			message: "Task is blocked",
			evidenceRef: task.id,
		});
	}
	if (task.status === "timed_out" || latestRun?.status === "timed_out") {
		blockers.push({
			kind: "timeout",
			message: "Run timed out",
			evidenceRef: latestRun?.id || task.id,
		});
	}
	if (task.status === "failed" || latestRun?.status === "failed") {
		blockers.push({
			kind: "runtime",
			message: "Latest execution failed",
			evidenceRef: latestRun?.id || task.id,
		});
	}
	for (const event of events) {
		const type = getRunEventType(event);
		if (type === "tool.policy_blocked" || type === "safety.policy_violation") {
			blockers.push({
				kind: "policy",
				message: event.message,
				evidenceRef: event.id,
			});
		}
		if (type === "verification.finished" && hasFailedVerification(event)) {
			blockers.push({
				kind: "verification",
				message: event.message,
				evidenceRef: event.id,
			});
		}
	}

	return {
		percent,
		phase: getSessionPhase(task, evidence),
		basis,
		blockers,
	};
}

export function getSessionBadges(input: {
	task: Task;
	progress: WorkbenchProgressSnapshot;
	latestRun?: TaskRun;
	contractWarnings?: CodexContractWarningSummary;
	mcpDiagnostics?: CodexMcpDiagnosticsSummary;
}): string[] {
	const badges: string[] = [];
	if (input.progress.blockers.length > 0)
		badges.push(input.progress.blockers[0].kind);
	if (input.latestRun?.testResults) badges.push("tests");
	if (input.latestRun?.diffPatch?.trim()) badges.push("diff");
	if (input.contractWarnings?.totalCount) {
		badges.push(
			input.contractWarnings.errorCount > 0
				? `contract:${input.contractWarnings.errorCount} error`
				: `contract:${input.contractWarnings.warningCount} warning`,
		);
	}
	if (input.mcpDiagnostics?.degraded) badges.push("mcp:degraded");
	if (input.task.priority > 0) badges.push(`P${input.task.priority}`);
	return badges;
}

export function buildWorkbenchSessionView(
	task: Task,
	evidence: SessionEvidence = {},
): WorkbenchSessionView {
	const progress = getSessionProgress(task, evidence);
	const latestEvent = (evidence.events || []).at(-1);
	const emailState = getSessionEmailState(task, evidence);
	const codexContractWarnings = getCodexContractWarningSummary(
		evidence.latestRun,
		evidence.events || [],
	);
	const codexMcpDiagnostics = getCodexMcpDiagnosticsSummary(evidence.latestRun);
	return {
		task,
		group: getSessionGroup(task, evidence.latestRun),
		emailState,
		primaryAction: getSessionPrimaryAction(emailState),
		queueEntry: evidence.queueEntry,
		phase: progress.phase,
		progress,
		latestRun: evidence.latestRun,
		latestEventSummary: latestEvent?.message,
		reviewNeed: progress.blockers.find((blocker) => blocker.kind === "review")
			?.message,
		artifactCounts: countArtifacts(
			buildWorkbenchArtifactRefs({
				task,
				latestRun: evidence.latestRun,
				todos: evidence.todos || [],
				reviews: evidence.reviews || [],
				messages: evidence.messages || [],
			}),
		),
		badges: getSessionBadges({
			task,
			progress,
			latestRun: evidence.latestRun,
			contractWarnings: codexContractWarnings,
			mcpDiagnostics: codexMcpDiagnostics,
		}),
		codexContractWarnings,
		codexMcpDiagnostics,
	};
}

import {
	countArtifacts,
	getCodexContractWarningSummary,
	getCodexMcpDiagnosticsSummary,
	hasFailedVerification,
	hasImplementationPlanEvidence,
	isReviewNeededSession,
} from "./workbenchSessionDiagnostics";

export {
	getCodexContractWarningSummary,
	getCodexMcpDiagnosticsSummary,
	groupWorkbenchSessions,
} from "./workbenchSessionDiagnostics";
