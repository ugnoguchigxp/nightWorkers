import { toDeepRecord } from "../../../shared/json-record";
import { NotFoundError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { decideRunOutcome } from "../../services/run-control/run-outcome-gate";
import type { RuntimeLaneResult } from "../codingAgent";
import { configureQueueDrainRunner } from "../queue/queue-scheduler-port";
import { buildReviewResult } from "../review/results/build-review-result";
import { collectDefaultReviewEvidence } from "../review/results/evidence-collector";
import type { ReviewRunRequest } from "../review/results/types";
import { buildSpecificationVerificationSidecar } from "../specification/specification-verification-sidecar";
import { createTask } from "./nightworkers.basic.service";
import { assertRunnableWorkbenchTask } from "./nightworkers.planning-helpers.service";
import * as repo from "./nightworkers.repository";
import {
	archiveImplementationQueueEntryForRun,
	completeImplementationQueueEntryForRun,
	runImplementationQueue,
	runSessionQueueForRepository,
	shouldContinueSessionQueue,
	startTaskRun,
} from "./nightworkers.run-orchestration.service";
import { getVerificationDocument } from "./nightworkers.verification.repository";
import { createVerificationDocumentFromSpec } from "./nightworkers.verification.service";
import { deletePromptImageAttachments } from "./prompt-image-attachments";
import {
	archiveCompletedTask,
	reopenCompletedTask,
	restoreArchivedTask,
} from "./task-archive.service";

configureQueueDrainRunner(runImplementationQueue);

export {
	generateBlueprintArtifact as generateSpecificationStatusBlueprint,
	getBlueprintArtifactAdoption,
	getBlueprintDesignSettings,
	getBlueprintDesignTokenAdoption,
	saveBlueprintArtifactAdoption,
	saveBlueprintDesignSettings,
	saveBlueprintDesignTokenAdoption,
} from "../blueprint";
export { generateDataModelArtifact as generateSpecificationStatusDataModel } from "../dataModel/dataModel.service";
export {
	acceptDesignQuestionnaireReview,
	createDesignQuestionnaire,
	generateDesignQuestionnaireFollowUp,
	generateDesignQuestionnaireReview,
	getDesignQuestionnaireSession,
	leaveDesignQuestionnaireReviewUnadopted,
	listDesignQuestionnaires,
	saveDesignQuestionnaireAnswers,
} from "../questionnaire/questionnaire.service";
export {
	generateFeaturePlanArtifact as generateSpecificationStatusDesignDocument,
	getPlanModeWorkspace,
} from "../specification/specification.service";
export {
	getTaskBackgroundProcess,
	listTaskBackgroundProcesses,
	startTaskBackgroundProcess,
	stopTaskBackgroundProcess,
} from "./nightworkers.background-process.service";
export type { BlueprintPlanningReadiness } from "./nightworkers.basic.service";
export {
	createRepository,
	createTask,
	deleteRepository,
	getRepository,
	getTask,
	getTaskLlmUsageSummary,
	listRepositories,
	listTaskActivityEvents,
	listTaskMessages,
	listTasks,
	resolveBlueprintPlanningReadiness,
	updateRepository,
	updateTask,
} from "./nightworkers.basic.service";
export {
	assertRunnableWorkbenchTask,
	buildBlueprintPlanningReadiness,
	isAppBlueprintMessage,
	isBlueprintMessage,
	isBlueprintRouting,
} from "./nightworkers.planning-helpers.service";
export type { WorkbenchChatIntent } from "./nightworkers.workbench.service";
export {
	appendAssistantTaskMessage,
	appendTaskMessage,
	appendWorkbenchMessage,
	createPlanningArtifactMessageIfNeeded,
} from "./nightworkers.workbench.service";
export async function startWorkbenchTaskRun(taskId: string) {
	const task = await repo.getTask(taskId);
	const messages = await repo.listTaskMessages(taskId);
	assertRunnableWorkbenchTask(task, messages);
	return startTaskRun(taskId, {
		executionMode: "implementation",
		executionModeSource: "workbench_run",
	});
}

export async function startVerificationRunFromArtifact(input: {
	projectId: string;
	taskId: string;
	specArtifactId: string;
	verificationDocumentId?: string | null;
	mode: "test";
	action?: "discover_tests" | "plan_and_implement_tests" | "run_unit_tests";
	rerun?: boolean;
	missionPilot?: {
		sessionId: string;
		cycle: number;
		contextRevision: number;
		contextDigest: string;
	};
	missionPilotAgent?: import("../../../shared/modules/missionPilot").MissionPilotAgentRunProvenance;
}) {
	const task = await repo.getTask(input.taskId);
	if (!task) throw new NotFoundError("Task not found");
	if (task.repositoryId !== input.projectId) {
		throw new NotFoundError("Project not found for task");
	}
	const verificationDocument = input.verificationDocumentId
		? await getVerificationDocument(input.verificationDocumentId)
		: await ensureTestModeVerificationDocument({
				taskId: input.taskId,
				projectId: input.projectId,
				specArtifactId: input.specArtifactId,
			});
	if (!verificationDocument || verificationDocument.taskId !== input.taskId) {
		throw new NotFoundError("Verification document not found");
	}
	if (!input.rerun) {
		const activeRuns = await repo.listActiveTaskRunsForTask(input.taskId);
		const activeTestRun = activeRuns.find((run) => {
			const snapshot =
				run.contextSnapshot &&
				typeof run.contextSnapshot === "object" &&
				!Array.isArray(run.contextSnapshot)
					? (run.contextSnapshot as Record<string, unknown>)
					: {};
			return snapshot.executionMode === "test";
		});
		if (activeTestRun) return activeTestRun;
	}
	return startTaskRun(input.taskId, {
		executionMode: "implementation",
		executionModeSource: "explicit",
		missionPilotPhase:
			input.missionPilot || input.missionPilotAgent ? "test" : undefined,
		missionPilotAgent: input.missionPilotAgent,
		runtimeOptionsPatch: {
			verificationDocumentId: verificationDocument.id,
			...(input.missionPilot ? { missionPilot: input.missionPilot } : {}),
			artifactContext: {
				specArtifactId: input.specArtifactId,
				verificationDocumentId: verificationDocument.id,
			},
		},
	});
}

export async function ensureTestModeVerificationDocument(input: {
	taskId: string;
	projectId: string;
	specArtifactId: string;
}) {
	const messages = await repo.listTaskMessages(input.taskId);
	const specMessage = resolveTestModeSpecMessage({
		messages,
		specArtifactId: input.specArtifactId,
	});
	if (!specMessage) return null;
	const metadata = toDeepRecord(specMessage.metadataJson);
	const existingVerificationDocumentId = readRecordString(
		metadata,
		"verificationDocumentId",
	);
	if (existingVerificationDocumentId) {
		return getVerificationDocument(existingVerificationDocumentId);
	}
	const intent = readRecordString(metadata, "intent");
	const specPath =
		intent === "implementation_plan"
			? "spec/implementation-plan.md"
			: "spec/feature-plan.md";
	const generatedAt = new Date().toISOString();
	const sidecar = buildSpecificationVerificationSidecar({
		taskId: input.taskId,
		specId: specMessage.id,
		specPath,
		content: specMessage.content,
		sourceMessageIds: messages.map((message) => message.id),
		workspace: {
			taskId: input.taskId,
			repositoryId: input.projectId,
			generatedAt,
			featurePlanArtifacts:
				intent === "feature_plan"
					? [
							{
								id: `feature-plan-${specMessage.id}`,
								kind: "feature_plan",
								title: "Feature Plan",
								sourceMessageId: specMessage.id,
								createdAt: String(specMessage.createdAt),
							},
						]
					: [],
			blueprintArtifacts: [],
			dataModelArtifacts: [],
			dedicatedViewArtifacts: [],
			questionnaireSessions: [],
			decisionReviews: [],
			viewDecisions: [],
			routing: {
				revision: 0,
				entries: [],
				editable: false,
				lockedReason: "Specification verification workspace",
				updatedBy: null,
				updatedAt: null,
			},
			implementationReferences:
				intent === "implementation_plan"
					? [
							{
								id: `implementation-plan-${specMessage.id}`,
								kind: "implementation_reference",
								title: "Implementation Plan",
								sourceMessageId: specMessage.id,
								taskId: input.taskId,
							},
						]
					: [],
		},
		generatedAt,
	});
	const verificationMessage = await repo.createTaskMessage({
		taskId: input.taskId,
		runId: specMessage.runId,
		role: "assistant",
		content: JSON.stringify(sidecar.document, null, 2),
		messageType: "verification_json",
		payloadJson: {
			intent:
				intent === "implementation_plan"
					? "implementation_plan_verification"
					: "feature_plan_verification",
			artifactKind: "verification_json",
			title:
				intent === "implementation_plan"
					? "Implementation Plan Verification"
					: "Feature Plan Verification",
			verificationDocument: sidecar.document,
			...(intent === "implementation_plan"
				? { sourceImplementationPlanMessageId: specMessage.id }
				: { sourceFeaturePlanMessageId: specMessage.id }),
		},
	});
	const verificationArtifactId = `verification-json-${verificationMessage.id}`;
	const verificationDocument = await createVerificationDocumentFromSpec({
		taskId: input.taskId,
		runId: specMessage.runId,
		specMessageId: specMessage.id,
		specArtifactId: input.specArtifactId,
		verificationArtifactId,
		sourceSpecPath: sidecar.document.specPath,
		document: sidecar.document,
	});
	await repo.updateTaskMessageMetadata(specMessage.id, {
		...metadata,
		verificationDocumentId: verificationDocument.id,
		verificationArtifactId,
		verificationSidecarMessageId: verificationMessage.id,
		markdownDocumentData: {
			...toDeepRecord(metadata.markdownDocumentData),
			verificationDocumentId: verificationDocument.id,
		},
	});
	await repo.updateTaskMessageMetadata(verificationMessage.id, {
		...toDeepRecord(verificationMessage.metadataJson),
		verificationDocumentId: verificationDocument.id,
		verificationArtifactId,
	});
	return verificationDocument;
}

function resolveTestModeSpecMessage(input: {
	messages: Awaited<ReturnType<typeof repo.listTaskMessages>>;
	specArtifactId: string;
}) {
	const explicitMessageId = input.specArtifactId.match(
		/^(?:implementation-plan|feature-plan)-(.+)$/,
	)?.[1];
	if (explicitMessageId) {
		const message = input.messages.find(
			(item) =>
				item.id === explicitMessageId &&
				item.messageType === "markdown_document" &&
				isTestModeSpecIntent(toDeepRecord(item.metadataJson)),
		);
		if (message) return message;
	}
	for (let index = input.messages.length - 1; index >= 0; index -= 1) {
		const message = input.messages[index];
		if (
			message?.messageType === "markdown_document" &&
			isTestModeSpecIntent(toDeepRecord(message.metadataJson))
		) {
			return message;
		}
	}
	return null;
}

function isTestModeSpecIntent(metadata: Record<string, unknown>) {
	const intent = readRecordString(metadata, "intent");
	return intent === "implementation_plan" || intent === "feature_plan";
}

function readRecordString(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

export async function createWorkbenchSession(data: {
	repositoryId: string;
	title?: string;
	description?: string | null;
	objective?: string | null;
	acceptanceCriteria?: string | null;
	timeoutSeconds?: number;
	priority?: number;
	createdBy?: string | null;
}) {
	return createTask({
		repositoryId: data.repositoryId,
		title: data.title?.trim() || "New Session",
		description: data.description || "",
		objective: data.objective || "",
		acceptanceCriteria: data.acceptanceCriteria || "",
		timeoutSeconds: data.timeoutSeconds,
		priority: data.priority,
		createdBy: data.createdBy,
	});
}

export async function archiveTask(id: string) {
	return (await archiveCompletedTask({ taskId: id, reason: "manual" })).task;
}

export async function restoreTaskArchive(id: string) {
	return restoreArchivedTask(id);
}

export async function reopenTask(id: string) {
	return reopenCompletedTask(id);
}

export async function deleteTask(id: string) {
	const deleted = await repo.deleteTask(id);
	if (deleted) {
		await deletePromptImageAttachments(id).catch((error) => {
			logger.warn(
				{ taskId: id, error },
				"Failed to clean up prompt image attachments after task deletion",
			);
		});
	}
	return deleted;
}

export {
	archiveImplementationQueueEntry,
	createImplementationQueueEntry,
	getTodoWorkflowSettings,
	listImplementationQueueDashboard,
	patchImplementationQueueEntry,
	queueTask,
	requeueImplementationQueueEntry,
	updateImplementationQueueSettings,
	updateTodoWorkflowSettings,
} from "./nightworkers.queue-management.service";

// --- Execution Orchestration (Runner Integration) ---
export {
	archiveImplementationQueueEntryForRun,
	completeImplementationQueueEntryForRun,
	resumeTaskRunTodo,
	runImplementationQueue,
	runSessionQueueForRepository,
	shouldContinueSessionQueue,
	startTaskRun,
	stopTaskRun,
} from "./nightworkers.run-orchestration.service";

export {
	getActiveTaskRun,
	getTaskRun,
	getTaskRunsForTask,
	listTaskRunActivityEvents,
	listTaskRunEvents,
	listTaskRunEventsForReplay,
	recoverStaleActiveRuns,
} from "./nightworkers.run-query.service";

export async function reviewTaskRun(runId: string, request: ReviewRunRequest) {
	const run = await repo.getTaskRun(runId);
	if (!run) throw new Error("Run not found");
	const events = await repo.listTaskEventsForRun(runId);
	const defaultEvidenceRefs = collectDefaultReviewEvidence(run, events);

	const outcome = decideRunOutcome({
		runtime: {
			finalReport: run.finalReport || "",
			terminalState: toRuntimeTerminalState(run.status),
			summary: run.summary || `Review action: ${request.action}`,
			stoppedBy: "decision",
			riskLevel: "medium",
		},
		humanAction: request.action,
	});
	const finalTaskStatus = outcome.status;
	const reviewResult = buildReviewResult({
		run: {
			id: run.id,
			taskId: run.taskId,
			status: run.status,
			summary: run.summary,
		},
		request,
		outcome,
		evidenceRefs: request.evidenceRefs?.length
			? request.evidenceRefs
			: defaultEvidenceRefs,
	});

	await repo.createRunEvent(
		{
			version: 1,
			runId,
			taskId: run.taskId,
			timestamp: new Date().toISOString(),
			type: "human.review_submitted",
			severity: "info",
			actor: "human",
			message: `Human review completed. Action: ${request.action}. Note: ${request.note || "None"}`,
			data: { action: request.action, reviewResultId: reviewResult.id },
		},
		{ payloadJson: { reviewResult } },
	);

	await repo.updateTaskRun(runId, {
		status: outcome.status,
		summary: request.note || outcome.summary,
	});

	await repo.updateTaskStatus(run.taskId, finalTaskStatus);
	await completeImplementationQueueEntryForRun(runId, finalTaskStatus);
	if (finalTaskStatus === "completed") {
		await archiveImplementationQueueEntryForRun(runId);
	}
	if (shouldContinueSessionQueue(finalTaskStatus)) {
		const reviewedTask = run.repositoryId
			? null
			: await repo.getTask(run.taskId);
		const repositoryId = run.repositoryId || reviewedTask?.repositoryId;
		if (repositoryId) void runSessionQueueForRepository(repositoryId);
	}

	await repo.createRunEvent(
		{
			version: 1,
			runId,
			taskId: run.taskId,
			timestamp: new Date().toISOString(),
			type: "run.outcome_decided",
			severity: "info",
			actor: "human",
			message: `Run outcome decided: ${outcome.status} (${outcome.reason})`,
			data: { ...outcome, reviewResultId: reviewResult.id },
		},
		{
			legacyPayload: outcome,
			payloadJson: { reviewResultId: reviewResult.id },
		},
	);

	return { ok: true, status: finalTaskStatus, outcome, reviewResult };
}

function toRuntimeTerminalState(
	value: string,
): Exclude<RuntimeLaneResult["terminalState"], "cancelled"> {
	const allowed: Array<
		Exclude<RuntimeLaneResult["terminalState"], "cancelled">
	> = [
		"completed",
		"needs_review",
		"needs_human",
		"failed",
		"timed_out",
		"blocked",
	];
	return allowed.includes(
		value as Exclude<RuntimeLaneResult["terminalState"], "cancelled">,
	)
		? (value as Exclude<RuntimeLaneResult["terminalState"], "cancelled">)
		: "needs_review";
}

export {
	browseLocalFolders,
	createLocalFolder,
	createReviewerEvaluation,
	createReviewerReplayEvaluation,
	exportTaskRunJsonl,
	getReviewRubrics,
	listProjectFiles,
	readProjectFile,
	readRepositoryDiff,
} from "../review/review-files.service";
export {
	createReviewPromptSuggestions,
	setReviewFindingDisposition,
	updateReviewPromptSuggestion,
	useReviewPromptSuggestion,
} from "../review/review-finding-actions.service";
export {
	autoStartReviewSessionForRun,
	getLatestReviewSessionDetailForTask,
	getOrCreateReviewRecommendation,
	getReviewSessionDetail,
	startReviewRun,
	startReviewSessionForRun,
} from "../review/review-mode.service";
export {
	commitRunGitCloseout,
	getRunGitCloseout,
	pushRunGitCloseout,
} from "./nightworkers.git-closeout.service";
export {
	deferTaskRunMerge,
	executeTaskRunMerge,
	overrideTaskRunMergeTarget,
	previewTaskRunMerge,
	requestTaskRunRework,
} from "./nightworkers.git-merge.service";
