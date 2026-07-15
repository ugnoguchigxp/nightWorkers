import {
	AlertTriangle,
	CheckCircle2,
	Circle,
	LoaderCircle,
} from "lucide-react";
import type { TaskRun } from "../types";
import { asArtifactRecord as asRecord } from "./ArtifactPane.controller";

type VerificationPanelModel = {
	specArtifactId: string;
	verificationDocumentId: string | null;
	missingReason?: string;
	conditions: Array<{
		id: string;
		text: string;
		status: string;
		required: boolean;
	}>;
};

export type TestModeCheckResult = {
	key: string;
	checkKind: string;
	label: string;
	status: "passed" | "failed" | "running" | "needs_action";
	summary: string;
};

export type TestModeCompletionConditionStatuses = {
	ok: boolean | null;
	statuses: Map<string, string>;
};

export function TestModeCheckResults({
	results,
}: {
	results: TestModeCheckResult[];
}) {
	if (results.length === 0) return null;
	return (
		<div className="mt-3 grid gap-2">
			{results.map((result) => (
				<div
					key={result.key}
					className="nightworkers-structured-artifact-row rounded-md border px-2.5 py-2 text-xs"
				>
					<div className="flex min-w-0 items-center justify-between gap-2">
						<span className="nightworkers-structured-artifact-text min-w-0 whitespace-normal break-words font-medium">
							{result.label}
						</span>
						<span
							className={
								result.status === "passed"
									? "nightworkers-structured-artifact-success shrink-0"
									: result.status === "needs_action"
										? "nightworkers-structured-artifact-warning shrink-0"
										: result.status === "failed"
											? "nightworkers-structured-artifact-warning shrink-0"
											: "nightworkers-structured-artifact-accent shrink-0"
							}
						>
							{result.status === "passed"
								? "OK"
								: result.status === "needs_action"
									? "改善点あり"
									: result.status === "failed"
										? "ERROR"
										: "RUNNING"}
						</span>
					</div>
					<div className="nightworkers-structured-artifact-muted mt-1 whitespace-pre-wrap break-words text-[11px] leading-5">
						{result.summary}
					</div>
				</div>
			))}
		</div>
	);
}

export function readLatestTestModeCheckResults(
	latestRun?: TaskRun | null,
): TestModeCheckResult[] {
	const events = latestRun?.events ?? [];
	const results: TestModeCheckResult[] = [];
	const seen = new Set<string>();
	for (const event of [...events].reverse()) {
		const payload = asRecord(event.payloadJson);
		const runEvent = asRecord(payload.runEvent);
		const runEventData = asRecord(runEvent.data);
		const commandExecutionCheck = readCommandExecutionCheckResult(
			event,
			runEvent,
			runEventData,
		);
		if (commandExecutionCheck) {
			if (seen.has(commandExecutionCheck.key)) continue;
			seen.add(commandExecutionCheck.key);
			results.push(commandExecutionCheck);
			continue;
		}
		const rawResult = firstRecord(
			runEventData.result,
			runEventData.toolResult,
			payload.result,
			asRecord(payload.payload).result,
		);
		const parsedTextResult = parseToolTextResult(rawResult);
		const rawResultRecord = asRecord(rawResult.result);
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
			asRecord(structuredContent.payload),
			rawResult.result,
			rawResult,
			asRecord(payload.payload).payload,
		);
		const toolName = readFirstString(
			runEventData.mcpTool,
			runEventData.toolName,
			parsedTextResult.toolName,
			rawResult.toolName,
			payload.toolName,
			asRecord(payload.payload).toolName,
		);
		const normalizedToolName = toolName ? normalizeToolName(toolName) : null;
		if (
			normalizedToolName !== "run_check" &&
			normalizedToolName !== "completion_check"
		)
			continue;
		const argumentsPayload = asRecord(runEventData.arguments);
		const checkKind =
			normalizedToolName === "run_check"
				? readFirstString(
						readRecordString(resultPayload, "checkKind"),
						readRecordString(argumentsPayload, "checkKind"),
					) || "other"
				: "completion_check";
		if (
			normalizedToolName === "run_check" &&
			checkKind === "other" &&
			Object.keys(resultPayload).length === 0
		) {
			continue;
		}
		const key =
			normalizedToolName === "completion_check"
				? "check:completion_check"
				: `check:${checkKind}`;
		if (seen.has(key)) continue;
		seen.add(key);
		results.push({
			key,
			checkKind,
			label: formatTestModeCheckLabel(checkKind),
			status: readCheckResultStatus(
				parsedTextResult,
				readFirstBoolean(
					parsedTextResult.ok,
					rawResult.ok,
					runEventData.ok,
					payload.ok,
				),
				readFirstString(
					readRecordString(resultPayload, "status"),
					parsedTextResult.status,
					rawResult.status,
					runEventData.status,
					payload.status,
				) || readOptionalEventStatus(event),
			),
			summary: formatTestModeCheckSummary(resultPayload, rawResult),
		});
	}
	return results.reverse();
}

function readCommandExecutionCheckResult(
	event: NonNullable<TaskRun["events"]>[number],
	runEvent: Record<string, unknown>,
	runEventData: Record<string, unknown>,
): TestModeCheckResult | null {
	const toolName = readRecordString(runEventData, "toolName");
	if (toolName !== "command_execution") return null;
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
	const command = readRecordString(runEventData, "command") || "";
	const checkKind = inferCommandExecutionCheckKind(command, commandClass);
	if (checkKind === "other") return null;
	const exitCode = readFirstNumber(runEventData.exitCode);
	const status = readCheckResultStatus(
		{},
		typeof exitCode === "number" ? exitCode === 0 : undefined,
		readFirstString(
			readRecordString(runEventData, "status"),
			readOptionalEventStatus(event),
		),
	);
	return {
		key: `check:${checkKind}`,
		checkKind,
		label: formatTestModeCheckLabel(checkKind),
		status,
		summary: formatCommandExecutionCheckSummary({
			checkKind,
			command,
			exitCode,
			output: readRecordString(runEventData, "aggregatedOutput") || "",
		}),
	};
}

export function readLatestCompletionCheckConditionStatuses(
	latestRun?: TaskRun | null,
): TestModeCompletionConditionStatuses | null {
	const events = latestRun?.events ?? [];
	for (const event of [...events].reverse()) {
		const payload = asRecord(event.payloadJson);
		const runEvent = asRecord(payload.runEvent);
		const runEventData = asRecord(runEvent.data);
		const rawResult = firstRecord(
			runEventData.result,
			runEventData.toolResult,
			payload.result,
			asRecord(payload.payload).result,
		);
		const parsedTextResult = parseToolTextResult(rawResult);
		const rawResultRecord = asRecord(rawResult.result);
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
			asRecord(structuredContent.payload),
			rawResult.result,
			rawResult,
			asRecord(payload.payload).payload,
		);
		const toolName = readFirstString(
			runEventData.mcpTool,
			runEventData.toolName,
			parsedTextResult.toolName,
			rawResult.toolName,
			payload.toolName,
			asRecord(payload.payload).toolName,
		);
		if (!toolName || normalizeToolName(toolName) !== "completion_check")
			continue;
		const completionResult = firstRecord(resultPayload.result, resultPayload);
		const statuses = new Map<string, string>();
		const conditions = Array.isArray(completionResult.conditions)
			? completionResult.conditions
			: [];
		for (const condition of conditions) {
			const record = asRecord(condition);
			const conditionId = readFirstString(record.conditionId, record.id);
			const status = readRecordString(record, "status");
			if (conditionId && status) statuses.set(conditionId, status);
		}
		for (const failed of readConditionList(completionResult.failedRequired)) {
			statuses.set(failed, "failed");
		}
		for (const unknown of readConditionList(completionResult.unknownRequired)) {
			if (statuses.get(unknown) !== "failed") statuses.set(unknown, "unknown");
		}
		return {
			ok:
				readFirstBoolean(
					completionResult.ok,
					parsedTextResult.ok,
					rawResult.ok,
					runEventData.ok,
					payload.ok,
				) ?? null,
			statuses,
		};
	}
	return null;
}

function readConditionList(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => {
			const record = asRecord(entry);
			return readFirstString(record.conditionId, record.id);
		})
		.filter((conditionId): conditionId is string => Boolean(conditionId));
}

export function resolveConditionDisplayStatus(
	condition: VerificationPanelModel["conditions"][number],
	completionCheck: TestModeCompletionConditionStatuses | null,
) {
	const explicitStatus = completionCheck?.statuses.get(condition.id);
	if (explicitStatus) return explicitStatus;
	return condition.status;
}

function readOptionalEventStatus(
	event: NonNullable<TaskRun["events"]>[number],
) {
	const status = (event as { status?: unknown }).status;
	return typeof status === "string" ? status : undefined;
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
	for (const value of values) {
		const record = asRecord(value);
		if (Object.keys(record).length > 0) return record;
	}
	return {};
}

function parseToolTextResult(result: Record<string, unknown>) {
	const content = result.content;
	if (!Array.isArray(content)) return {};
	for (const item of content) {
		const record = asRecord(item);
		if (record.type !== "text" || typeof record.text !== "string") continue;
		try {
			return asRecord(JSON.parse(record.text));
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

function readCheckResultStatus(
	result: Record<string, unknown>,
	ok?: boolean,
	eventStatus?: string | null,
): TestModeCheckResult["status"] {
	if (result.ok === true || ok === true) return "passed";
	if (result.ok === false || ok === false) return "failed";
	if (eventStatus === "completed") return "passed";
	return eventStatus === "running" ||
		eventStatus === "started" ||
		eventStatus === "in_progress"
		? "running"
		: "failed";
}

function formatTestModeCheckLabel(checkKind: string) {
	if (checkKind === "test") return "ユニットテスト実行結果";
	if (checkKind === "verify") return "verify 実行結果";
	if (checkKind === "completion_check") return "証跡テストチェック結果";
	if (checkKind === "typecheck") return "typecheck 実行結果";
	if (checkKind === "lint") return "lint 実行結果";
	if (checkKind === "build") return "build 実行結果";
	return `${checkKind} 実行結果`;
}

function formatTestModeCheckSummary(
	payload: Record<string, unknown>,
	result: Record<string, unknown>,
) {
	const llmSummary = readRecordString(payload, "llmSummary");
	if (llmSummary) return llmSummary;
	const exitCode = payload.exitCode;
	if (typeof exitCode === "number") return `exitCode=${exitCode}`;
	const completionResult = asRecord(payload.result);
	const reason = readRecordString(completionResult, "reason");
	if (reason) return reason;
	const error = asRecord(result.error);
	const errorMessage = readRecordString(error, "message");
	return errorMessage || "結果の要約がありません。";
}

function formatCommandExecutionCheckSummary(input: {
	checkKind: string;
	command: string;
	exitCode?: number;
	output: string;
}) {
	const lines = [
		input.exitCode === 0 ? `OK ${input.checkKind}` : `ERROR ${input.checkKind}`,
		typeof input.exitCode === "number" ? `exitCode=${input.exitCode}` : null,
		input.command ? `command=${input.command}` : null,
		...input.output
			.split("\n")
			.map((line) => line.trimEnd())
			.filter(Boolean)
			.slice(0, 8),
	];
	return lines.filter((line): line is string => Boolean(line)).join("\n");
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

export function TestModeConditionStatusIcon({ status }: { status: string }) {
	if (isCompleteConditionStatus(status)) {
		return (
			<CheckCircle2 className="nightworkers-structured-artifact-success h-3.5 w-3.5 shrink-0" />
		);
	}
	if (status === "failed" || status === "missing") {
		return (
			<AlertTriangle className="nightworkers-structured-artifact-warning h-3.5 w-3.5 shrink-0" />
		);
	}
	if (status === "running") {
		return (
			<LoaderCircle className="nightworkers-structured-artifact-accent h-3.5 w-3.5 shrink-0 animate-spin" />
		);
	}
	return (
		<Circle className="nightworkers-structured-artifact-muted h-3.5 w-3.5 shrink-0" />
	);
}

export function isCompleteConditionStatus(status: string) {
	return (
		status === "covered" ||
		status === "passed" ||
		status === "manual" ||
		status === "not_applicable" ||
		status === "completed" ||
		status === "done"
	);
}

export function readRecordString(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

export function readRecordBoolean(
	record: Record<string, unknown>,
	key: string,
): boolean | undefined {
	const value = record[key];
	return typeof value === "boolean" ? value : undefined;
}
