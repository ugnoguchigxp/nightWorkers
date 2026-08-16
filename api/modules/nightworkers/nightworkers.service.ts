import { logger } from "../../lib/logger";
import { configureQueueDrainRunner } from "../queue/queue-scheduler-port";
import type { ReviewRunRequest } from "../review/results/types";
import { reviewTaskRunCommand } from "../run/application/run-review.command";
import { createTask } from "./nightworkers.basic.service";
import * as repo from "./nightworkers.repository";
import { runImplementationQueue } from "./nightworkers.run-orchestration.service";
import { deletePromptImageAttachments } from "./prompt-image-attachments";
import {
	archiveCompletedTask,
	reopenCompletedTask,
	restoreArchivedTask,
} from "./task-archive.service";

export { initializeTaskUserIntakeHandler } from "./nightworkers.user-intake.handler";

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
		const { clearFixtureProviderTask } = await import(
			"../../services/structured-llm/fixture-provider-task"
		);
		clearFixtureProviderTask(id);
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
	return reviewTaskRunCommand(runId, request, precondition);
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
