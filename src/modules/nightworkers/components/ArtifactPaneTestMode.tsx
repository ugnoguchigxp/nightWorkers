import { GitCompare } from "lucide-react";
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
import {
	isCompleteConditionStatus,
	readLatestCompletionCheckConditionStatuses,
	readLatestTestModeCheckResults,
	readRecordBoolean,
	readRecordString,
	resolveConditionDisplayStatus,
	TestModeActionButton,
	TestModeCheckResults,
	TestModeConditionStatusIcon,
} from "./ArtifactPaneTestModeModel";

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
	const completionCheck = readLatestCompletionCheckConditionStatuses(latestRun);
	const requiredConditions = model.conditions.filter(
		(condition) => condition.required,
	);
	const allRequiredConditionsComplete =
		requiredConditions.length > 0 &&
		requiredConditions.every((condition) =>
			isCompleteConditionStatus(
				resolveConditionDisplayStatus(condition, completionCheck),
			),
		);
	const canEnterReviewMode =
		isTestModeWorkflowComplete(workflowSteps) && allRequiredConditionsComplete;
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
					{model.conditions.map((condition) => {
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
