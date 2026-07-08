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
	const todos = input.latestRun?.todos ?? [];
	const localActionStatus = readTestModeWorkflowActionStatus(input.localStatus);
	const workflowTodoTitles = new Set<string>(
		TEST_MODE_WORKFLOW_STEPS.map((step) => step.todoTitle),
	);
	const todoByTitle = new Map(
		todos
			.filter((todo) => workflowTodoTitles.has(todo.title))
			.map((todo) => [todo.title, todo]),
	);
	const steps = TEST_MODE_WORKFLOW_STEPS.map((step) => ({
		id: step.id,
		todoTitle: step.todoTitle,
		status: toWorkflowStepStatus(todoByTitle.get(step.todoTitle)?.status),
	}));
	const hasObservedWorkflowProgress = steps.some(
		(step) => step.status !== "pending",
	);

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

function toWorkflowStepStatus(
	status?: string | null,
): TestModeWorkflowStepStatus {
	if (
		status === "running" ||
		status === "passed" ||
		status === "failed" ||
		status === "needs_human" ||
		status === "skipped"
	) {
		return status;
	}
	return "pending";
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
