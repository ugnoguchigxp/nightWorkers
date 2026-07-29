import type { TaskOperatorCommandContext } from "../../../../shared/modules/taskOperator";
import { AppError } from "../../../lib/errors";
import {
	type CodingAgentRunCommandResult,
	resumeCodingAgentRunTodo,
	type StructuredProviderExecutionPolicy,
	startCodingAgentRun,
} from "../../agentsShare";
import {
	backgroundProcessBelongsToTask,
	stopTaskBackgroundProcess,
} from "../../backgroundProcess";
import { generateBlueprintArtifact } from "../../blueprint";
import { executeIdempotentTaskOperatorCommand } from "../../commandDelivery";
import { generateDataModelArtifact } from "../../dataModel";
import {
	commitRunGitCloseout,
	deferTaskRunMerge,
	executeTaskRunMerge,
	overrideTaskRunMergeTarget,
	previewTaskRunMerge,
	pushRunGitCloseout,
	requestTaskRunRework,
} from "../../gitCloseout";
import { generatePlanViewArtifact } from "../../planViews";
import {
	acceptDesignQuestionnaireReview,
	createDesignQuestionnaire,
	generateAdditionalDesignQuestionnaireQuestions,
	generateDesignQuestionnaireFollowUp,
	generateDesignQuestionnaireReview,
	leaveDesignQuestionnaireReviewUnadopted,
	questionnaireSessionBelongsToTask,
	recommendQuestionnaireArtifactRouting,
	saveDesignQuestionnaireAnswers,
} from "../../questionnaire";
import {
	archiveImplementationQueueEntry,
	patchImplementationQueueEntry,
	queueTask,
	recoverImplementationQueueEntry,
	requeueImplementationQueueEntry,
} from "../../queue";
import {
	readRunOperatorOutcome,
	stopTaskRun,
	submitRunReviewCommand,
} from "../../run";
import { generateFeaturePlanArtifact } from "../../specification";
import {
	archiveTaskCommand,
	completeTaskFromRunCommand,
	restoreTaskArchiveCommand,
	sendTaskOperatorMessage,
	updateTaskCommand,
} from "../../task";
import { readTaskOperatorProjection } from "./task-operator.query";

export type ExecuteTaskOperatorCommandInput = {
	taskId: string;
	actionId: string;
	expectedTaskRevision: number;
	arguments: Record<string, unknown>;
	context: TaskOperatorCommandContext;
	runtime?: TaskOperatorCommandRuntime;
};

export type TaskOperatorCommandRuntime = {
	signal?: AbortSignal;
	providerExecutionPolicy?: StructuredProviderExecutionPolicy;
	structuredLlmRole?: string;
	usageTrace?: unknown;
	artifactTrace?: unknown;
	messageTrace?: unknown;
	messageMetadata?: Record<string, unknown>;
	executeQuestionnaireDraft?: (input: {
		taskId: string;
		arguments: Record<string, unknown>;
		idempotencyKey: string;
	}) => Promise<unknown>;
	executePlanRouting?: (input: {
		taskId: string;
		arguments: Record<string, unknown>;
	}) => Promise<unknown>;
};

type ActionInput<ActionId extends string> = ExecuteTaskOperatorCommandInput & {
	actionId: ActionId;
};

export function executeTaskOperatorCommand(
	input: ActionInput<"run.implementation.start" | "run.todo.resume">,
): Promise<CodingAgentRunCommandResult>;
export function executeTaskOperatorCommand(
	input: ActionInput<"questionnaire.submit">,
): ReturnType<typeof saveDesignQuestionnaireAnswers>;
export function executeTaskOperatorCommand(
	input: ActionInput<"task.update">,
): ReturnType<typeof updateTaskCommand>;
export function executeTaskOperatorCommand(
	input: ActionInput<"task.archive">,
): ReturnType<typeof archiveTaskCommand>;
export function executeTaskOperatorCommand(
	input: ActionInput<"task.archive.restore">,
): ReturnType<typeof restoreTaskArchiveCommand>;
export function executeTaskOperatorCommand(
	input: ActionInput<"task.complete">,
): ReturnType<typeof completeTaskFromRunCommand>;
export function executeTaskOperatorCommand(
	input: ActionInput<"run.stop">,
): ReturnType<typeof stopTaskRun>;
export function executeTaskOperatorCommand(
	input: ExecuteTaskOperatorCommandInput,
): Promise<unknown>;
export async function executeTaskOperatorCommand(
	input: ExecuteTaskOperatorCommandInput,
) {
	return executeIdempotentTaskOperatorCommand({
		taskId: input.taskId,
		actionId: input.actionId,
		expectedTaskRevision: input.expectedTaskRevision,
		arguments: input.arguments,
		context: input.context,
		execute: () => executeTaskOperatorCommandOnce(input),
	});
}

async function executeTaskOperatorCommandOnce(
	input: ExecuteTaskOperatorCommandInput,
) {
	const projection = await readTaskOperatorProjection(input.taskId, {
		principal: input.context.principal,
	});
	if (projection.task.revision !== input.expectedTaskRevision)
		throw new AppError(
			409,
			"TASK_REVISION_CONFLICT",
			"Task revision changed; re-read the Task Operator view.",
			{ currentTaskRevision: projection.task.revision },
		);
	if (
		input.actionId === "questionnaire.submit" &&
		["completed", "cancelled", "failed", "timed_out"].includes(
			projection.task.status,
		)
	)
		throw new AppError(
			409,
			"PLAN_MODE_READ_ONLY",
			"Terminal sessions cannot modify Plan Mode artifacts.",
		);
	if (!projection.commandCatalog.availableIds.includes(input.actionId))
		throw new AppError(
			409,
			"TASK_OPERATOR_COMMAND_UNAVAILABLE",
			`Task Operator command ${input.actionId} is not currently available.`,
		);
	const args = input.arguments;
	await assertActionResourceOwnership(input, projection, args);
	switch (input.actionId) {
		case "task.update":
			return updateTaskCommand({
				taskId: input.taskId,
				fields: record(args.fields),
				expectedRevision: input.expectedTaskRevision,
				principal: input.context.principal,
			});
		case "task.archive":
			return archiveTaskCommand({
				taskId: input.taskId,
				expectedRevision: input.expectedTaskRevision,
				principal: input.context.principal,
				discardPendingCloseouts: args.discardPendingCloseouts === true,
			});
		case "task.archive.restore":
			return restoreTaskArchiveCommand({
				taskId: input.taskId,
				expectedRevision: input.expectedTaskRevision,
				principal: input.context.principal,
			});
		case "task.message.send":
			return sendTaskOperatorMessage(
				input.taskId,
				requiredText(args.content),
				input.runtime?.messageMetadata ?? {
					source: "task_operator",
					actor: input.context.principal,
					idempotencyKey: input.context.idempotencyKey,
				},
				input.runtime?.messageTrace as never,
			);
		case "questionnaire.create":
			return createDesignQuestionnaire(
				input.taskId,
				optionalText(args.sourceBlueprintMessageId),
				requiredText(args.prompt),
				providerOptions(input),
			);
		case "questionnaire.draft.update":
		case "questionnaire.draft.save":
			if (!input.runtime?.executeQuestionnaireDraft)
				throw unsupportedRuntime(input.actionId);
			return input.runtime.executeQuestionnaireDraft({
				taskId: input.taskId,
				arguments: args,
				idempotencyKey: input.context.idempotencyKey,
			});
		case "questionnaire.submit":
			return submitQuestionnaireAnswers(input, args);
		case "questionnaire.follow_up.generate":
			return generateDesignQuestionnaireFollowUp(
				input.taskId,
				requiredText(args.questionnaireSessionId),
				providerOptions(input),
			);
		case "questionnaire.additional.generate":
			return generateAdditionalDesignQuestionnaireQuestions(input.taskId, {
				source: requiredText(args.source) as
					| "user_requested"
					| "artifact_triggered"
					| "pre_feature_plan_gate",
				reason: optionalText(args.reason) ?? undefined,
				role: input.runtime?.structuredLlmRole as never,
				executionPolicy: input.runtime?.providerExecutionPolicy,
				llmUsageTrace: input.runtime?.usageTrace as never,
			});
		case "questionnaire.review.generate":
			return generateDesignQuestionnaireReview(
				input.taskId,
				requiredText(args.questionnaireSessionId),
				providerOptions(input),
			);
		case "questionnaire.review.accept":
			return acceptDesignQuestionnaireReview(
				input.taskId,
				requiredText(args.questionnaireSessionId),
				{
					missionPilotAction: {
						idempotencyKey: input.context.idempotencyKey,
						toolCallId: input.context.requestId,
					},
				},
			);
		case "questionnaire.review.leave_unadopted":
			return leaveDesignQuestionnaireReviewUnadopted(
				input.taskId,
				requiredText(args.questionnaireSessionId),
			);
		case "plan.artifact.feature_plan.generate":
			return generateFeaturePlanArtifact(input.taskId, artifactOptions(input));
		case "plan.artifact.blueprint.generate":
			return generateBlueprintArtifact(input.taskId, artifactOptions(input));
		case "plan.artifact.data_model.generate":
			return generateDataModelArtifact(input.taskId, artifactOptions(input));
		case "plan.artifact.view.generate":
			return generatePlanViewArtifact(
				input.taskId,
				requiredText(args.view) as Parameters<
					typeof generatePlanViewArtifact
				>[1],
				artifactOptions(input),
			);
		case "plan.routing.update":
			if (!input.runtime?.executePlanRouting)
				throw unsupportedRuntime(input.actionId);
			return input.runtime.executePlanRouting({
				taskId: input.taskId,
				arguments: args,
			});
		case "task.queue.enqueue":
			return queueTask(input.taskId);
		case "task.queue.update":
			return patchImplementationQueueEntry(requiredText(args.entryId), {
				action:
					typeof args.action === "string"
						? (args.action as "cancel" | "resume")
						: undefined,
				priority: typeof args.priority === "number" ? args.priority : undefined,
				queuePosition:
					typeof args.queuePosition === "number" || args.queuePosition === null
						? args.queuePosition
						: undefined,
			});
		case "task.queue.cancel":
			return patchImplementationQueueEntry(requiredText(args.entryId), {
				action: "cancel",
			});
		case "task.queue.requeue":
			return requeueImplementationQueueEntry(requiredText(args.entryId), {
				note: optionalText(args.note) ?? undefined,
			});
		case "task.queue.recover":
			return recoverImplementationQueueEntry(requiredText(args.entryId), {
				action: requiredText(args.action) as
					| "archive"
					| "cancel"
					| "complete"
					| "retry"
					| "mark_needs_human",
				note: optionalText(args.note) ?? undefined,
			});
		case "task.queue.archive":
			return archiveImplementationQueueEntry(requiredText(args.entryId));
		case "run.implementation.start":
			return startCodingAgentRun({
				taskId: input.taskId,
				instruction: requiredText(args.request),
				artifactRefs: projection.artifactIndex.latestByKind,
				repositoryRef: {
					id: projection.project.id,
					revision: projection.project.revision,
				},
				requestProvenance: provenance(input.context),
			});
		case "run.todo.resume":
			assertActiveRunResource(
				projection.activeRun,
				requiredText(args.runId),
				requiredText(args.todoId),
			);
			return resumeCodingAgentRunTodo({
				runId: requiredText(args.runId),
				todoId: requiredText(args.todoId),
				expectedTodoRevision: requiredInteger(args.expectedTodoRevision),
				userContext: requiredText(args.userContext),
				requestProvenance: provenance(input.context),
			});
		case "run.stop":
			assertActiveRunResource(projection.activeRun, requiredText(args.runId));
			return stopTaskRun(requiredText(args.runId), {
				expectedTaskId: input.taskId,
				expectedTaskRevision: input.expectedTaskRevision,
			});
		case "task.complete":
			if (
				!(await readRunOperatorOutcome({
					taskId: input.taskId,
					runId: requiredText(args.sourceRunId),
				}))
			)
				throw new AppError(
					403,
					"TASK_RESOURCE_OWNERSHIP_MISMATCH",
					"Terminal Run does not belong to the requested Task.",
				);
			return completeTaskFromRunCommand({
				taskId: input.taskId,
				sourceRunId: requiredText(args.sourceRunId),
				expectedRevision: input.expectedTaskRevision,
				principal: input.context.principal,
			});
		case "background_process.stop":
			return stopTaskBackgroundProcess(requiredText(args.processId));
		case "run.review.submit":
			return submitRunReviewCommand({
				runId: requiredText(args.runId),
				action: requiredText(args.action) as "complete" | "cancel",
				note: optionalText(args.note) ?? undefined,
				expectedTaskId: input.taskId,
				expectedTaskRevision: input.expectedTaskRevision,
			});
		case "git.commit":
			return commitRunGitCloseout(requiredText(args.sourceRunId));
		case "git.push":
			return pushRunGitCloseout(requiredText(args.sourceRunId));
		case "git.merge.preview":
			return previewTaskRunMerge({
				runId: requiredText(args.runId),
				expectedVersion: requiredInteger(args.expectedVersion),
			});
		case "git.merge.defer":
			return deferTaskRunMerge({
				runId: requiredText(args.runId),
				expectedVersion: requiredInteger(args.expectedVersion),
			});
		case "git.merge.rework":
			return requestTaskRunRework({
				runId: requiredText(args.runId),
				expectedVersion: requiredInteger(args.expectedVersion),
			});
		case "git.merge.target.update":
			return overrideTaskRunMergeTarget({
				runId: requiredText(args.runId),
				targetBranch: requiredText(args.targetBranch),
				expectedVersion: requiredInteger(args.expectedVersion),
			});
		case "git.merge.execute":
			return executeTaskRunMerge({
				runId: requiredText(args.runId),
				expectedVersion: requiredInteger(args.expectedVersion),
			});
		default:
			throw new AppError(
				422,
				"TASK_OPERATOR_COMMAND_UNSUPPORTED",
				`Task Operator command ${input.actionId} is not implemented.`,
			);
	}
}

async function submitQuestionnaireAnswers(
	input: ExecuteTaskOperatorCommandInput,
	args: Record<string, unknown>,
) {
	const session = await saveDesignQuestionnaireAnswers(
		input.taskId,
		requiredText(args.questionnaireSessionId),
		(args.answers ?? []) as Parameters<
			typeof saveDesignQuestionnaireAnswers
		>[2],
		{ expectedTaskRevision: input.expectedTaskRevision },
	);
	if (input.context.principal.kind === "human") {
		await recommendQuestionnaireArtifactRouting(input.taskId, session);
	}
	return session;
}

function provenance(context: TaskOperatorCommandContext) {
	return {
		requestedBy: {
			kind: context.principal.kind,
			actorId: context.principal.actorId,
		},
		orchestrationRef: {
			kind: "task_operator_command",
			id: context.idempotencyKey,
		},
	};
}
function requiredText(value: unknown) {
	if (typeof value !== "string" || value.length === 0)
		throw new AppError(
			422,
			"TASK_OPERATOR_ARGUMENT_REQUIRED",
			"A non-empty string is required.",
		);
	return value;
}
function requiredInteger(value: unknown) {
	if (!Number.isInteger(value) || (value as number) < 0)
		throw new AppError(
			422,
			"TASK_OPERATOR_ARGUMENT_REQUIRED",
			"A non-negative integer is required.",
		);
	return value as number;
}
function optionalText(value: unknown) {
	return typeof value === "string" && value.length > 0 ? value : null;
}
function record(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function providerOptions(input: ExecuteTaskOperatorCommandInput) {
	return {
		signal: input.runtime?.signal,
		role: input.runtime?.structuredLlmRole as never,
		executionPolicy: input.runtime?.providerExecutionPolicy,
		usageTrace: input.runtime?.usageTrace as never,
		missionPilotActionKey: input.context.idempotencyKey,
	};
}

function artifactOptions(input: ExecuteTaskOperatorCommandInput) {
	const args = input.arguments;
	return {
		prompt: requiredText(args.prompt),
		questionnaireSessionId: optionalText(args.questionnaireSessionId),
		sourceSelection: record(args.sourceSelection) as never,
		role: input.runtime?.structuredLlmRole as never,
		executionPolicy: input.runtime?.providerExecutionPolicy,
		trace: input.runtime?.artifactTrace as never,
		llmUsageTrace: input.runtime?.usageTrace as never,
		signal: input.runtime?.signal,
	};
}

function unsupportedRuntime(actionId: string) {
	return new AppError(
		500,
		"TASK_OPERATOR_RUNTIME_PORT_MISSING",
		`Task Operator runtime port is missing for ${actionId}.`,
	);
}

async function assertActionResourceOwnership(
	input: ExecuteTaskOperatorCommandInput,
	projection: Awaited<ReturnType<typeof readTaskOperatorProjection>>,
	args: Record<string, unknown>,
) {
	const runArgument = new Map<string, string>([
		["run.review.submit", "runId"],
		["task.complete", "sourceRunId"],
		["git.commit", "sourceRunId"],
		["git.push", "sourceRunId"],
		["git.merge.preview", "runId"],
		["git.merge.defer", "runId"],
		["git.merge.rework", "runId"],
		["git.merge.target.update", "runId"],
		["git.merge.execute", "runId"],
	]).get(input.actionId);
	if (runArgument) {
		const runId = requiredText(args[runArgument]);
		if (!(await readRunOperatorOutcome({ taskId: input.taskId, runId })))
			throw ownershipMismatch();
	}
	if (
		input.actionId.startsWith("task.queue.") &&
		input.actionId !== "task.queue.enqueue"
	) {
		if (projection.queue?.id !== requiredText(args.entryId))
			throw ownershipMismatch();
	}
	if (
		input.actionId.startsWith("questionnaire.") &&
		input.actionId !== "questionnaire.create" &&
		input.actionId !== "questionnaire.additional.generate"
	) {
		if (
			!(await questionnaireSessionBelongsToTask(
				input.taskId,
				requiredText(args.questionnaireSessionId),
			))
		)
			throw ownershipMismatch();
	}
	if (
		input.actionId === "background_process.stop" &&
		!(await backgroundProcessBelongsToTask(
			input.taskId,
			requiredText(args.processId),
		))
	)
		throw ownershipMismatch();
}

function ownershipMismatch() {
	return new AppError(
		403,
		"TASK_RESOURCE_OWNERSHIP_MISMATCH",
		"The requested resource does not belong to this Task.",
	);
}

function assertActiveRunResource(
	activeRun: Awaited<
		ReturnType<typeof readTaskOperatorProjection>
	>["activeRun"],
	runId: string,
	todoId?: string,
) {
	if (
		activeRun?.id === runId &&
		(todoId === undefined || activeRun.currentTodoRef?.id === todoId)
	)
		return;
	throw new AppError(
		403,
		"TASK_RESOURCE_OWNERSHIP_MISMATCH",
		"Run or Todo does not belong to the requested Task.",
	);
}
