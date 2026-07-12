import {
	AlertTriangle,
	CheckCircle2,
	Circle,
	FlaskConical,
	GitCompare,
	LoaderCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toDeepRecord } from "../../../../shared/json-record";
import { TEST_MODE_WORKFLOW_ACTION } from "../../../../shared/test-mode-workflow";
import { TodoRailList, type TodoRailListStatus } from "../../todo/TodoRailList";
import { markdownCodeBlock } from "../artifactExport";
import {
	isTestModeWorkflowComplete,
	isTestModeWorkflowInProgress,
	readTestModeWorkflowActionStatus,
	type TestModeWorkflowStepView,
} from "../testModeWorkflowView";
import type { TaskMessage, TaskRun } from "../types";
import { asArtifactRecord as asRecord } from "./ArtifactPane.controller";

export type TestModeAction =
	| "discover_tests"
	| "plan_and_implement_tests"
	| "run_unit_tests";

export type VerificationPanelModel = {
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

export function buildTestModeExportMarkdown(input: {
	title: string;
	model: VerificationPanelModel | null;
	workflowSteps: TestModeWorkflowStepView[];
	latestRun?: TaskRun | null;
}) {
	const sections = [`# ${input.title}`];
	const completionCheck = readLatestCompletionCheckConditionStatuses(
		input.latestRun,
	);
	if (input.model?.conditions.length) {
		sections.push(
			"## Completion Conditions",
			...input.model.conditions.map((condition) => {
				const status = resolveConditionDisplayStatus(
					condition,
					completionCheck,
				);
				const checked = isCompleteConditionStatus(status) ? "x" : " ";
				return `- [${checked}] \`${condition.id}\` ${condition.text} (${status})`;
			}),
		);
	}
	if (input.workflowSteps.length) {
		sections.push(
			"## Workflow",
			...input.workflowSteps.map(
				(step, index) => `${index + 1}. ${step.id}: ${step.status}`,
			),
		);
	}
	if (input.latestRun?.testResults) {
		const testResults =
			typeof input.latestRun.testResults === "string"
				? input.latestRun.testResults
				: markdownCodeBlock(
						JSON.stringify(input.latestRun.testResults, null, 2),
						"json",
					);
		sections.push("## Test Results", testResults);
	}
	if (input.latestRun?.finalReport?.trim()) {
		sections.push("## Final Report", input.latestRun.finalReport.trim());
	}
	return `${sections.join("\n\n")}\n`;
}

export function buildVerificationPanelModel(input: {
	message: TaskMessage | null;
	taskMessages: TaskMessage[];
	artifactId: string | null;
}): VerificationPanelModel | null {
	if (!input.message) return null;
	const metadata = toDeepRecord(input.message.metadataJson);
	const intent = readRecordString(metadata, "intent");
	if (intent !== "feature_plan" && intent !== "implementation_plan")
		return null;
	const verificationDocumentId =
		readRecordString(metadata, "verificationDocumentId") ?? null;
	const sidecarMessageId =
		readRecordString(metadata, "verificationSidecarMessageId") ?? null;
	const sidecarMessage = sidecarMessageId
		? input.taskMessages.find((message) => message.id === sidecarMessageId) ||
			null
		: null;
	const sidecarMetadata = toDeepRecord(sidecarMessage?.metadataJson);
	const document = toDeepRecord(sidecarMetadata.verificationDocument);
	const sidecarConditions = Array.isArray(document.conditions)
		? document.conditions
				.map((condition) => toDeepRecord(condition))
				.map((condition) => ({
					id: String(condition.id || ""),
					text: String(condition.text || ""),
					status: String(condition.status || "pending"),
					required: readRecordBoolean(condition, "required") !== false,
				}))
				.filter((condition) => condition.id && condition.text)
		: [];
	const conditions =
		sidecarConditions.length > 0
			? sidecarConditions
			: extractCompletionConditionsFromMarkdown(input.message.content);
	return {
		specArtifactId:
			input.artifactId ||
			`${intent === "implementation_plan" ? "implementation-plan" : "feature-plan"}-${input.message.id}`,
		verificationDocumentId,
		missingReason: verificationDocumentId
			? undefined
			: "verification_json_missing",
		conditions,
	};
}

export function buildLatestVerificationPanelModel(input: {
	taskMessages: TaskMessage[];
}): VerificationPanelModel | null {
	let latestPlan: TaskMessage | null = null;
	for (let index = input.taskMessages.length - 1; index >= 0; index -= 1) {
		const message = input.taskMessages[index];
		if (!message) continue;
		const metadata = toDeepRecord(message.metadataJson);
		const intent = readRecordString(metadata, "intent");
		if (
			message.messageType === "markdown_document" &&
			(intent === "implementation_plan" || intent === "feature_plan")
		) {
			latestPlan = message;
			break;
		}
	}
	return buildVerificationPanelModel({
		message: latestPlan,
		taskMessages: input.taskMessages,
		artifactId: latestPlan
			? `${readRecordString(toDeepRecord(latestPlan.metadataJson), "intent") === "implementation_plan" ? "implementation-plan" : "feature-plan"}-${latestPlan.id}`
			: null,
	});
}

function extractCompletionConditionsFromMarkdown(
	content: string,
): VerificationPanelModel["conditions"] {
	const lines = content.split(/\r?\n/);
	let inCompletionSection = false;
	let conditionIndex = 1;
	const usedIds = new Set<string>();
	const conditions: VerificationPanelModel["conditions"] = [];
	for (const line of lines) {
		const heading = line.match(/^(#{2,6})\s+(.+?)\s*$/);
		if (heading) {
			inCompletionSection =
				/完了条件|completion conditions?|acceptance criteria/i.test(
					heading[2] || "",
				);
			continue;
		}
		if (!inCompletionSection) continue;
		const bullet = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/);
		if (!bullet) continue;
		const rawText = stripMarkdownCheckbox(bullet[1] || "").trim();
		if (!rawText) continue;
		const existingId = rawText.match(/^\[?(AC-\d{3})\]?\s*[:：-]?\s*(.+)$/);
		const id =
			existingId?.[1] && !usedIds.has(existingId[1])
				? existingId[1]
				: nextConditionId(usedIds, conditionIndex);
		usedIds.add(id);
		conditionIndex += 1;
		conditions.push({
			id,
			text: (existingId?.[2] || rawText).trim(),
			status: "pending",
			required: true,
		});
	}
	return conditions;
}

function stripMarkdownCheckbox(value: string) {
	return value.replace(/^\[[xX\s]\]\s*/, "");
}

function nextConditionId(usedIds: Set<string>, startIndex: number) {
	let index = Math.max(1, startIndex);
	let id = `AC-${String(index).padStart(3, "0")}`;
	while (usedIds.has(id)) {
		index += 1;
		id = `AC-${String(index).padStart(3, "0")}`;
	}
	return id;
}

export function TestModeArtifactViewer({
	model,
	projectId,
	taskId,
	latestRun,
	workflowSteps,
	status,
	canStartRun,
	onStart,
	onOpenReviewArtifact,
}: {
	model: VerificationPanelModel | null;
	projectId: string | null;
	taskId: string | null;
	latestRun?: TaskRun | null;
	workflowSteps: TestModeWorkflowStepView[];
	status: string | null;
	canStartRun: boolean;
	onStart: (action: TestModeAction, rerun: boolean) => Promise<void>;
	onOpenReviewArtifact?: () => Promise<void>;
}) {
	const { t } = useTranslation();
	return (
		<div
			className="nightworkers-structured-artifact h-full overflow-auto p-5"
			data-artifact-export-expand
		>
			<div className="mx-auto grid max-w-5xl gap-4">
				{model ? (
					<VerificationChecklistPanel
						model={model}
						projectId={projectId}
						taskId={taskId}
						latestRun={latestRun}
						workflowSteps={workflowSteps}
						status={status}
						canStartRun={canStartRun}
						onOpenReviewArtifact={onOpenReviewArtifact}
						onStart={onStart}
					/>
				) : (
					<div className="nightworkers-structured-artifact-card nightworkers-structured-artifact-muted rounded-md border p-4 text-xs">
						{t("testMode.emptyConditions")}
					</div>
				)}
			</div>
		</div>
	);
}

export function VerificationChecklistPanel({
	model,
	projectId,
	taskId,
	latestRun,
	workflowSteps,
	status,
	canStartRun,
	onStart,
	onOpenReviewArtifact,
}: {
	model: VerificationPanelModel;
	projectId: string | null;
	taskId: string | null;
	latestRun?: TaskRun | null;
	workflowSteps: TestModeWorkflowStepView[];
	status: string | null;
	canStartRun: boolean;
	onStart: (action: TestModeAction, rerun: boolean) => Promise<void>;
	onOpenReviewArtifact?: () => Promise<void>;
}) {
	const { t } = useTranslation();
	const canShowStartButton = Boolean(model.specArtifactId);
	const workflowActionStatus = readTestModeWorkflowActionStatus(status);
	const canEnterReviewMode = isTestModeWorkflowComplete(workflowSteps);
	const workflowInProgress =
		workflowActionStatus === "starting" ||
		isTestModeWorkflowInProgress(workflowSteps);
	const startDisabled =
		!canStartRun ||
		!projectId ||
		!taskId ||
		!model.specArtifactId ||
		workflowInProgress;
	const checkResults = readLatestTestModeCheckResults(latestRun).filter(
		(result) => result.checkKind !== "completion_check",
	);
	const completionCheck = readLatestCompletionCheckConditionStatuses(latestRun);
	return (
		<div className="nightworkers-structured-artifact nightworkers-structured-artifact-section border-b px-4 py-3">
			<div>
				{workflowActionStatus === "failed" ? (
					<div className="nightworkers-structured-artifact-warning text-[11px]">
						{t("testMode.status.planFailed")}
					</div>
				) : null}
				<TestModeWorkflowProgress steps={workflowSteps} />
				{canShowStartButton ? (
					<div className="mt-2 flex flex-wrap gap-1.5">
						<TestModeActionButton
							action={TEST_MODE_WORKFLOW_ACTION}
							label={t("testMode.action.startWorkflow")}
							status={workflowActionStatus}
							disabled={startDisabled}
							onStart={onStart}
						/>
					</div>
				) : null}
				{canEnterReviewMode ? (
					<TestModeReviewTransition
						taskId={taskId}
						onOpenReviewArtifact={onOpenReviewArtifact}
					/>
				) : null}
				<TestModeCheckResults results={checkResults} />
			</div>
			{model.conditions.length > 0 ? (
				<div className="mt-3 grid gap-1.5">
					{model.conditions.slice(0, 5).map((condition) => {
						const displayStatus = resolveConditionDisplayStatus(
							condition,
							completionCheck,
						);
						return (
							<div
								key={condition.id}
								className="nightworkers-structured-artifact-row grid grid-cols-[4.5rem_1.25rem_7rem_minmax(0,1fr)] items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs"
							>
								<span className="nightworkers-structured-artifact-muted font-mono leading-5">
									{condition.id}
								</span>
								<span className="flex h-5 items-center">
									<TestModeConditionStatusIcon status={displayStatus} />
								</span>
								<span className="nightworkers-structured-artifact-muted whitespace-nowrap leading-5">
									{t(`testMode.conditionStatus.${displayStatus}`, {
										defaultValue: displayStatus,
									})}
								</span>
								<span className="nightworkers-structured-artifact-text min-w-0 whitespace-normal break-words leading-5">
									{condition.text}
								</span>
							</div>
						);
					})}
				</div>
			) : null}
		</div>
	);
}

function TestModeReviewTransition({
	taskId,
	onOpenReviewArtifact,
}: {
	taskId: string | null;
	onOpenReviewArtifact?: () => Promise<void>;
}) {
	const { t } = useTranslation();
	if (!taskId) return null;
	const href = `/sessions/${encodeURIComponent(taskId)}?artifact=review_status`;
	return (
		<div className="mt-2">
			<a
				href={href}
				className="nightworkers-structured-artifact-action inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition"
				onClick={(event) => {
					if (!onOpenReviewArtifact) return;
					event.preventDefault();
					void onOpenReviewArtifact();
				}}
			>
				<GitCompare className="h-3.5 w-3.5" />
				{t("testMode.action.enterReviewMode")}
			</a>
		</div>
	);
}

function TestModeWorkflowProgress({
	steps,
}: {
	steps: TestModeWorkflowStepView[];
}) {
	const { t } = useTranslation();
	return (
		<TodoRailList
			variant="embedded"
			className="mt-3"
			items={steps.map((step, index) => ({
				id: step.id,
				seq: index + 1,
				title: t(`testMode.workflow.step.${step.id}`),
				status: toTodoRailListStatus(step.status),
				statusLabel: t(`testMode.workflow.status.${step.status}`),
				activeLabel:
					step.status === "running"
						? t(`testMode.workflow.status.${step.status}`)
						: null,
				instruction: step.todoTitle,
			}))}
		/>
	);
}

function toTodoRailListStatus(
	status: TestModeWorkflowStepView["status"],
): TodoRailListStatus {
	return status;
}

type TestModeCheckResult = {
	key: string;
	checkKind: string;
	label: string;
	status: "passed" | "failed" | "running" | "needs_action";
	summary: string;
};

type TestModeCompletionConditionStatuses = {
	ok: boolean | null;
	statuses: Map<string, string>;
};

function TestModeCheckResults({ results }: { results: TestModeCheckResult[] }) {
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

function readLatestTestModeCheckResults(
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

function readLatestCompletionCheckConditionStatuses(
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

function resolveConditionDisplayStatus(
	condition: VerificationPanelModel["conditions"][number],
	completionCheck: TestModeCompletionConditionStatuses | null,
) {
	const explicitStatus = completionCheck?.statuses.get(condition.id);
	if (explicitStatus) return explicitStatus;
	if (completionCheck?.ok === true && condition.required) return "covered";
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

function TestModeConditionStatusIcon({ status }: { status: string }) {
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

function isCompleteConditionStatus(status: string) {
	return (
		status === "covered" ||
		status === "passed" ||
		status === "verified_by_gate" ||
		status === "manual" ||
		status === "not_applicable" ||
		status === "completed" ||
		status === "done"
	);
}

function TestModeActionButton({
	action,
	label,
	status,
	disabled,
	onStart,
}: {
	action: TestModeAction;
	label: string;
	status: string | null;
	disabled: boolean;
	onStart: (action: TestModeAction, rerun: boolean) => Promise<void>;
}) {
	const { t } = useTranslation();
	const isDisabled = disabled || status === "starting";
	return (
		<button
			type="button"
			className="nightworkers-structured-artifact-action inline-flex h-8 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-medium disabled:cursor-not-allowed"
			disabled={isDisabled}
			onClick={() => void onStart(action, false)}
			title={label}
		>
			<FlaskConical className="h-3.5 w-3.5" />
			{status === "starting" ? t("testMode.status.starting") : label}
		</button>
	);
}

function readRecordString(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function readRecordBoolean(
	record: Record<string, unknown>,
	key: string,
): boolean | undefined {
	const value = record[key];
	return typeof value === "boolean" ? value : undefined;
}
