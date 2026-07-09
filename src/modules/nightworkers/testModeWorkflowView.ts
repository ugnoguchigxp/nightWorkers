import { toDeepRecord } from "../../../shared/json-record";
import {
	TEST_MODE_WORKFLOW_ACTION,
	TEST_MODE_WORKFLOW_STEPS,
	type TestModeWorkflowStepId,
} from "../../../shared/test-mode-workflow";
import type { TaskRun } from "./types";

export type TestModeWorkflowStepStatus =
	| "pending"
	| "running"
	| "passed"
	| "failed"
	| "needs_human"
	| "skipped";

export type TestModeWorkflowStepView = {
	id: TestModeWorkflowStepId;
	todoTitle: string;
	status: TestModeWorkflowStepStatus;
};

const ACTIVE_RUN_STATUSES = new Set([
	"context_compiling",
	"compiling_context",
	"running",
	"finalizing",
]);

export function buildTestModeWorkflowSteps(input: {
	latestRun?: TaskRun | null;
	localStatus?: string | null;
}): TestModeWorkflowStepView[] {
	const localActionStatus = readTestModeWorkflowActionStatus(input.localStatus);
	const steps = TEST_MODE_WORKFLOW_STEPS.map((step) => ({
		id: step.id,
		todoTitle: step.todoTitle,
		status: "pending" as TestModeWorkflowStepStatus,
	}));
	applyToolEventProgress(steps, input.latestRun);
	const hasObservedWorkflowProgress = steps.some(isObservedStep);

	if (!hasObservedWorkflowProgress) {
		const firstStep = steps[0];
		if (localActionStatus === "failed") {
			if (firstStep) firstStep.status = "failed";
		} else if (
			localActionStatus === "starting" ||
			localActionStatus === "started" ||
			isActiveTestModeWorkflowRun(input.latestRun)
		) {
			if (firstStep) firstStep.status = "running";
		}
	}
	return steps;
}

export function readTestModeWorkflowActionStatus(status?: string | null) {
	const prefix = `${TEST_MODE_WORKFLOW_ACTION}:`;
	return status?.startsWith(prefix) ? status.slice(prefix.length) : null;
}

export function isTestModeWorkflowInProgress(
	steps: TestModeWorkflowStepView[],
) {
	return steps.some((step) => step.status === "running");
}

export function isTestModeWorkflowComplete(steps: TestModeWorkflowStepView[]) {
	return steps.every((step) => step.status === "passed");
}

function applyToolEventProgress(
	steps: TestModeWorkflowStepView[],
	run?: TaskRun | null,
) {
	if (!run) return;
	const firstStep = steps.find((step) => step.id === "implementation_start");
	const unitStep = steps.find((step) => step.id === "unit_test");
	const evidenceStep = steps.find((step) => step.id === "evidence_check");
	const reviewStep = steps.find((step) => step.id === "llm_code_review");
	for (const event of run.events ?? []) {
		const toolEvent = readManagedToolEvent(event);
		const reviewEvent = readReviewerEvent(event);
		if (reviewEvent) {
			markPassedIfNotTerminal(firstStep);
			markPassedIfNotTerminal(unitStep);
			markPassedIfNotTerminal(evidenceStep);
			if (reviewStep) reviewStep.status = reviewEventStatus(reviewEvent);
			continue;
		}
		if (!toolEvent) continue;
		if (toolEvent.toolName === "read_current_specification") {
			const status = toolEventStatus(toolEvent);
			if (firstStep)
				firstStep.status = status === "passed" ? "running" : status;
			continue;
		}
		if (toolEvent.toolName === "run_check" && isTestRunCheckKind(toolEvent)) {
			markPassedIfNotTerminal(firstStep);
			if (unitStep) unitStep.status = toolEventStatus(toolEvent);
			continue;
		}
		if (toolEvent.toolName === "completion_check") {
			markPassedIfNotTerminal(firstStep);
			markPassedIfNotTerminal(unitStep);
			if (evidenceStep) evidenceStep.status = toolEventStatus(toolEvent);
			continue;
		}
		if (isLlmReviewTool(toolEvent.toolName)) {
			markPassedIfNotTerminal(firstStep);
			markPassedIfNotTerminal(unitStep);
			markPassedIfNotTerminal(evidenceStep);
			if (reviewStep) reviewStep.status = reviewerToolEventStatus(toolEvent);
		}
	}
	if (
		isActiveTestModeWorkflowRun(run) &&
		!steps.some((step) => step.status === "failed")
	) {
		const firstPending = steps.find((step) => step.status === "pending");
		if (firstPending) firstPending.status = "running";
	}
}

function isObservedStep(step: TestModeWorkflowStepView) {
	return step.status !== "pending";
}

function markPassedIfNotTerminal(step?: TestModeWorkflowStepView) {
	if (!step) return;
	if (step.status === "failed" || step.status === "needs_human") return;
	step.status = "passed";
}

type ManagedToolEvent = {
	toolName: string;
	checkKind?: string | null;
	ok?: boolean;
	status?: string | null;
};

type ReviewerEvent = {
	type: string;
	ok?: boolean;
	status?: string | null;
};

function readManagedToolEvent(
	event: NonNullable<TaskRun["events"]>[number],
): ManagedToolEvent | null {
	const payload = toDeepRecord(event.payloadJson);
	const runEvent = toDeepRecord(payload.runEvent);
	const runEventData = toDeepRecord(runEvent.data);
	const payloadPayload = toDeepRecord(payload.payload);
	const rawResult = firstRecord(
		runEventData.result,
		runEventData.toolResult,
		payload.result,
		payloadPayload.result,
	);
	const rawResultRecord = toDeepRecord(rawResult.result);
	const structuredContent = firstRecord(
		rawResult.structuredContent,
		rawResult.structured_content,
		rawResultRecord.structuredContent,
		rawResultRecord.structured_content,
	);
	const resultPayload = firstRecord(
		rawResult.payload,
		rawResultRecord.payload,
		toDeepRecord(structuredContent.payload),
		rawResult.result,
		rawResult,
		payloadPayload.payload,
	);
	const toolName = readFirstString(
		runEventData.mcpTool,
		runEventData.toolName,
		rawResult.toolName,
		payload.toolName,
		payloadPayload.toolName,
	);
	if (!toolName) return null;
	return {
		toolName: normalizeToolName(toolName),
		checkKind: readRecordString(resultPayload, "checkKind"),
		ok: readFirstBoolean(rawResult.ok, runEventData.ok, payload.ok),
		status: readFirstString(
			rawResult.status,
			runEventData.status,
			payload.status,
		),
	};
}

function readReviewerEvent(
	event: NonNullable<TaskRun["events"]>[number],
): ReviewerEvent | null {
	const payload = toDeepRecord(event.payloadJson);
	const runEvent = toDeepRecord(payload.runEvent);
	const runEventData = toDeepRecord(runEvent.data);
	const type = readFirstString(
		runEvent.type,
		payload.type,
		event.eventType,
		event.type,
	);
	if (!type?.startsWith("review.")) return null;
	if (
		type !== "review.llm_started" &&
		type !== "review.llm_finished" &&
		type !== "review.evaluation_finished"
	) {
		return null;
	}
	if (type === "review.evaluation_finished") {
		const reviewer = toDeepRecord(runEventData.reviewer);
		const reviewerKind = readRecordString(reviewer, "kind");
		if (!runEventData.llmVerdict && reviewerKind !== "combined") return null;
	}
	return {
		type,
		ok: readFirstBoolean(runEventData.ok, payload.ok),
		status: readFirstString(runEventData.status, payload.status),
	};
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
	for (const value of values) {
		const record = toDeepRecord(value);
		if (Object.keys(record).length > 0) return record;
	}
	return {};
}

function readFirstString(...values: unknown[]) {
	for (const value of values) {
		if (typeof value === "string" && value.length > 0) return value;
	}
	return null;
}

function readFirstBoolean(...values: unknown[]) {
	for (const value of values) {
		if (typeof value === "boolean") return value;
	}
	return undefined;
}

function toolEventStatus(event: ManagedToolEvent): TestModeWorkflowStepStatus {
	if (event.ok === true) return "passed";
	if (event.ok === false) return "failed";
	if (event.status === "failed") return "failed";
	if (event.status === "completed") return "passed";
	return "running";
}

function reviewEventStatus(event: ReviewerEvent): TestModeWorkflowStepStatus {
	if (event.status === "degraded") return "needs_human";
	if (event.ok === true) return "passed";
	if (event.ok === false) return "failed";
	if (event.status === "failed") return "failed";
	if (event.status === "completed" || event.type === "review.llm_finished") {
		return "passed";
	}
	return "running";
}

function reviewerToolEventStatus(
	event: ManagedToolEvent,
): TestModeWorkflowStepStatus {
	if (event.status === "degraded") return "needs_human";
	return toolEventStatus(event);
}

function isTestRunCheckKind(event: ManagedToolEvent) {
	return (
		event.checkKind === "test" ||
		event.checkKind === "coverage" ||
		event.checkKind === "verify"
	);
}

function isLlmReviewTool(toolName: string) {
	return (
		toolName === "llm_code_review" ||
		toolName === "reviewer_evaluation" ||
		toolName === "reviewer-evaluation"
	);
}

function normalizeToolName(toolName: string) {
	return toolName.startsWith("nightworkers.")
		? toolName.slice("nightworkers.".length)
		: toolName;
}

function isActiveTestModeWorkflowRun(run?: TaskRun | null) {
	if (!run || !ACTIVE_RUN_STATUSES.has(run.status)) return false;
	const snapshot = toDeepRecord(run.contextSnapshot);
	const testMode = toDeepRecord(snapshot.testMode);
	const action = readRecordString(testMode, "action");
	return readRecordString(snapshot, "executionMode") === "test"
		? action === TEST_MODE_WORKFLOW_ACTION || action === undefined
		: false;
}

function readRecordString(record: Record<string, unknown>, key: string) {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}
