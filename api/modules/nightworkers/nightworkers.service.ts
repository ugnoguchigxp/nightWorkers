import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { decideRunOutcome } from "../../services/run-control/run-outcome-gate";
import type { RuntimeLaneResult } from "../codingAgent";
import { configureQueueDrainRunner } from "../queue/queue-scheduler-port";
import { buildReviewResult } from "../review/results/build-review-result";
import { collectDefaultReviewEvidence } from "../review/results/evidence-collector";
import type { ReviewRunRequest } from "../review/results/types";
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

export async function archiveTask(
	id: string,
	expectedTaskRevision?: number,
	options: { discardPendingCloseouts?: boolean } = {},
) {
	return (
		await archiveCompletedTask({
			taskId: id,
			reason: "manual",
			expectedTaskRevision,
			discardPendingCloseouts: options.discardPendingCloseouts,
		})
	).task;
}

export async function restoreTaskArchive(
	id: string,
	expectedTaskRevision?: number,
) {
	return restoreArchivedTask(id, "user", expectedTaskRevision);
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

export async function reviewTaskRun(
	runId: string,
	request: ReviewRunRequest,
	precondition?: {
		expectedTaskId: string;
		expectedTaskRevision: number;
	},
) {
	const run = await repo.getTaskRun(runId);
	if (!run) throw new Error("Run not found");
	if (precondition) {
		if (run.taskId !== precondition.expectedTaskId)
			throw new AppError(
				403,
				"TASK_RESOURCE_OWNERSHIP_MISMATCH",
				"Run does not belong to the requested Task.",
			);
		const task = await repo.getTask(run.taskId);
		if (task?.revision !== precondition.expectedTaskRevision)
			throw new AppError(
				409,
				"TASK_REVISION_CONFLICT",
				"Task revision changed; re-read the Task Operator view.",
				{ currentTaskRevision: task?.revision ?? null },
			);
	}
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
