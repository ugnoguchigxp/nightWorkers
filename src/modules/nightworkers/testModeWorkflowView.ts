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

export function selectTestModeWorkflowSteps(input: {
	liveSteps: TestModeWorkflowStepView[];
	frozenSteps?: TestModeWorkflowStepView[] | null;
	latestRun?: TaskRun | null;
}): TestModeWorkflowStepView[] {
	if (input.frozenSteps?.length && !isTestModeWorkflowRun(input.latestRun)) {
		return input.frozenSteps;
	}
	return input.liveSteps;
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
	if (!isTestModeWorkflowRun(run)) return;
	const firstStep = steps.find((step) => step.id === "implementation_start");
	const unitStep = steps.find((step) => step.id === "unit_test");
	const evidenceStep = steps.find((step) => step.id === "evidence_check");
	for (const event of run.events ?? []) {
		const toolEvent = readManagedToolEvent(event);
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
			const status = toolEventStatus(toolEvent);
			if (status === "passed") {
				markPassedIfNotTerminal(firstStep);
				markPassedIfNotTerminal(unitStep);
			}
			if (evidenceStep) evidenceStep.status = status;
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

function readManagedToolEvent(
	event: NonNullable<TaskRun["events"]>[number],
): ManagedToolEvent | null {
	const payload = toDeepRecord(event.payloadJson);
	const runEvent = toDeepRecord(payload.runEvent);
	const runEventData = toDeepRecord(runEvent.data);
	const commandExecutionEvent = readCommandExecutionToolEvent(
		event,
		runEvent,
		runEventData,
	);
	if (commandExecutionEvent) return commandExecutionEvent;
	const payloadPayload = toDeepRecord(payload.payload);
	const rawResult = firstRecord(
		runEventData.result,
		runEventData.toolResult,
		payload.result,
		payloadPayload.result,
	);
	const parsedTextResult = parseToolTextResult(rawResult);
	const rawResultRecord = toDeepRecord(rawResult.result);
	const structuredContent = firstRecord(
		rawResult.structuredContent,
		rawResult.structured_content,
		rawResultRecord.structuredContent,
		rawResultRecord.structured_content,
	);
	const resultPayload = firstRecord(
		parsedTextResult.payload,
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
		parsedTextResult.toolName,
		rawResult.toolName,
		payload.toolName,
		payloadPayload.toolName,
	);
	if (!toolName) return null;
	const argumentsPayload = toDeepRecord(runEventData.arguments);
	return {
		toolName: normalizeToolName(toolName),
		checkKind:
			readRecordString(resultPayload, "checkKind") ||
			readRecordString(argumentsPayload, "checkKind"),
		ok: readFirstBoolean(
			parsedTextResult.ok,
			rawResult.ok,
			runEventData.ok,
			payload.ok,
		),
		status: readFirstString(
			readRecordString(resultPayload, "status"),
			parsedTextResult.status,
			rawResult.status,
			runEventData.status,
			payload.status,
		),
	};
}

function readCommandExecutionToolEvent(
	event: NonNullable<TaskRun["events"]>[number],
	runEvent: Record<string, unknown>,
	runEventData: Record<string, unknown>,
): ManagedToolEvent | null {
	if (readRecordString(runEventData, "toolName") !== "command_execution") {
		return null;
	}
	const eventType = readFirstString(
		readRecordString(runEvent, "type"),
		event.eventType,
		event.type,
	);
	if (eventType !== "tool.call_finished") return null;
	const commandClass = readRecordString(runEventData, "commandClass");
	if (
		commandClass !== "verification" &&
		commandClass !== "broad_verification"
	) {
		return null;
	}
	const checkKind = inferCommandExecutionCheckKind(
		readRecordString(runEventData, "command") || "",
		commandClass,
	);
	if (checkKind === "other") return null;
	const exitCode = readFirstNumber(runEventData.exitCode);
	return {
		toolName: "run_check",
		checkKind,
		ok: typeof exitCode === "number" ? exitCode === 0 : undefined,
		status: readRecordString(runEventData, "status"),
	};
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
	for (const value of values) {
		const record = toDeepRecord(value);
		if (Object.keys(record).length > 0) return record;
	}
	return {};
}

function parseToolTextResult(result: Record<string, unknown>) {
	const content = result.content;
	if (!Array.isArray(content)) return {};
	for (const item of content) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		if (record.type !== "text" || typeof record.text !== "string") continue;
		try {
			return toDeepRecord(JSON.parse(record.text));
		} catch {
			return {};
		}
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

function readFirstNumber(...values: unknown[]) {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
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

function isTestRunCheckKind(event: ManagedToolEvent) {
	return (
		event.checkKind === "test" ||
		event.checkKind === "coverage" ||
		event.checkKind === "verify"
	);
}

function inferCommandExecutionCheckKind(
	command: string,
	commandClass?: string | null,
) {
	if (commandClass === "broad_verification") return "verify";
	const normalized = command.toLowerCase();
	if (/\b(?:typecheck|tsc)\b/.test(normalized)) return "typecheck";
	if (/\b(?:lint|eslint)\b/.test(normalized)) return "lint";
	if (/\b(?:format|biome\s+check)\b/.test(normalized)) return "format_check";
	if (/\bcoverage\b/.test(normalized)) return "coverage";
	if (/\bbuild\b/.test(normalized)) return "build";
	if (/\b(?:test|vitest|jest|playwright)\b/.test(normalized)) return "test";
	return "other";
}

function normalizeToolName(toolName: string) {
	return toolName.startsWith("nightworkers.")
		? toolName.slice("nightworkers.".length)
		: toolName;
}

export function isTestModeWorkflowRun(run?: TaskRun | null) {
	if (!run) return false;
	const snapshot = toDeepRecord(run.contextSnapshot);
	const testMode = toDeepRecord(snapshot.testMode);
	const action = readRecordString(testMode, "action");
	return readRecordString(snapshot, "executionMode") === "test"
		? action === TEST_MODE_WORKFLOW_ACTION || action === undefined
		: false;
}

function isActiveTestModeWorkflowRun(run?: TaskRun | null) {
	if (!run || !ACTIVE_RUN_STATUSES.has(run.status)) return false;
	return isTestModeWorkflowRun(run);
}

function readRecordString(record: Record<string, unknown>, key: string) {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}
