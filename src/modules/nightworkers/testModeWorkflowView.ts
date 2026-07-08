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
	const implementationStep = steps.find(
		(step) => step.id === "implementation_complete",
	);
	const unitStep = steps.find((step) => step.id === "unit_test");
	const evidenceStep = steps.find((step) => step.id === "evidence_check");
	for (const event of run.events ?? []) {
		const toolEvent = readManagedToolEvent(event);
		if (!toolEvent) continue;
		if (toolEvent.toolName === "read_current_specification") {
			if (firstStep) firstStep.status = toolEventStatus(toolEvent);
			continue;
		}
		if (isTestImplementationTool(toolEvent.toolName)) {
			if (firstStep && firstStep.status === "pending") {
				firstStep.status = "passed";
			}
			if (implementationStep) {
				implementationStep.status = toolEventStatus(toolEvent);
			}
			continue;
		}
		if (toolEvent.toolName === "run_check" && toolEvent.checkKind === "test") {
			if (firstStep && firstStep.status === "pending") {
				firstStep.status = "passed";
			}
			if (implementationStep && implementationStep.status === "pending") {
				implementationStep.status = "passed";
			}
			if (unitStep) unitStep.status = toolEventStatus(toolEvent);
			continue;
		}
		if (toolEvent.toolName === "completion_check") {
			if (firstStep && firstStep.status === "pending") {
				firstStep.status = "passed";
			}
			if (implementationStep && implementationStep.status === "pending") {
				implementationStep.status = "passed";
			}
			if (unitStep && unitStep.status === "pending") {
				unitStep.status = "passed";
			}
			if (evidenceStep) evidenceStep.status = toolEventStatus(toolEvent);
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

type ManagedToolEvent = {
	toolName: string;
	checkKind?: string | null;
	ok?: boolean;
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
	const resultPayload = firstRecord(
		rawResult.payload,
		toDeepRecord(rawResult.result).payload,
		rawResult.result,
		payloadPayload.payload,
	);
	const toolName = readFirstString(
		runEventData.toolName,
		rawResult.toolName,
		payload.toolName,
		payloadPayload.toolName,
	);
	if (!toolName) return null;
	return {
		toolName,
		checkKind: readRecordString(resultPayload, "checkKind"),
		ok: typeof rawResult.ok === "boolean" ? rawResult.ok : undefined,
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

function toolEventStatus(event: ManagedToolEvent): TestModeWorkflowStepStatus {
	if (event.ok === true) return "passed";
	if (event.ok === false) return "failed";
	return "running";
}

function isTestImplementationTool(toolName: string) {
	return toolName === "apply_patch" || toolName === "replace_content";
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
