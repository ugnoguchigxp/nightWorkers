import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { missionPilotRepairRequestSchema } from "../../../../shared/schemas/mission-pilot-agent.schema";
import { missionPilotPlanRoutingToolCallSchema } from "../../../../shared/schemas/plan-mode-routing.schema";
import { db } from "../../../db/client";
import {
	missionPilotAgentSessions,
	missionPilotToolCalls,
} from "../../../db/mission-pilot-agent-schema";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";
import { reviewSessions } from "../../../db/review-mode-schema";
import {
	backgroundProcesses,
	implementationQueueEntries,
	taskRuns,
	tasks,
} from "../../../db/schema";
import { AppError } from "../../../lib/errors";
import {
	commitRunGitCloseout,
	pushRunGitCloseout,
} from "../../nightworkers/nightworkers.git-closeout.service";
import * as nightworkersService from "../../nightworkers/nightworkers.service";
import type { generatePlanViewArtifact } from "../../planViews/planView-generation.service";
import type { PlanArtifactSourceSelection } from "../../specification/plan-artifact-input.types";
import type {
	MissionPilotActionResult,
	MissionPilotTaskActionPort,
} from "./mission-pilot-agent.ports";
import {
	getMissionPilotActionDefinition,
	getMissionPilotActionUnavailableReason,
	validateMissionPilotActionArguments,
} from "./mission-pilot-task-action.registry";

export const missionPilotTaskActionPort: MissionPilotTaskActionPort = {
	async execute(input) {
		const definition = getMissionPilotActionDefinition(input.actionId);
		if (!definition)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"invalid_request",
				"Unknown Task action",
			);
		const unavailableReason = getMissionPilotActionUnavailableReason(
			input.actionId,
		);
		if (unavailableReason)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"domain_precondition",
				unavailableReason,
			);
		const validated = validateMissionPilotActionArguments(
			definition,
			input.arguments,
		);
		if (!validated.success)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"schema_validation",
				validated.message,
			);
		const [session, task, toolCall, agent] = await Promise.all([
			db.query.missionPilotSessions.findFirst({
				where: and(
					eq(missionPilotSessions.id, input.sessionId),
					eq(missionPilotSessions.taskId, input.taskId),
				),
			}),
			db.query.tasks.findFirst({ where: eq(tasks.id, input.taskId) }),
			db
				.select()
				.from(missionPilotToolCalls)
				.where(
					and(
						eq(missionPilotToolCalls.id, input.toolCallId),
						eq(missionPilotToolCalls.sessionId, input.sessionId),
						eq(missionPilotToolCalls.actionId, input.actionId),
						eq(missionPilotToolCalls.idempotencyKey, input.idempotencyKey),
					),
				)
				.then((rows) => rows[0] ?? null),
			db
				.select()
				.from(missionPilotAgentSessions)
				.where(eq(missionPilotAgentSessions.sessionId, input.sessionId))
				.then((rows) => rows[0] ?? null),
		]);
		if (!session || !task)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"domain_precondition",
				"Task or Mission Pilot session not found",
			);
		const authorization = session.authorizationJson;
		if (
			authorization?.version !== 3 ||
			authorization.sessionId !== session.id ||
			authorization.taskId !== task.id ||
			authorization.taskRef.source !== "task" ||
			authorization.taskRef.id !== task.id ||
			!authorization.scopes[definition.authorizationScope]
		)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"permission",
				`authorization scope ${definition.authorizationScope} is not granted`,
			);
		if (
			session.desiredState !== "playing" ||
			agent?.runtimeState !== "running" ||
			agent.leaseOwner !== input.leaseOwner ||
			agent.currentTurnId !== toolCall?.turnId
		)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"domain_precondition",
				"Mission Pilot is not in an active agent turn.",
			);
		if (toolCall?.status !== "running")
			return failed(
				input.actionId,
				input.idempotencyKey,
				"domain_precondition",
				"Task action tool call has not been claimed for execution.",
			);
		if (
			!isDeepStrictEqual(toolCall.argumentsJson, input.arguments) ||
			toolCall.expectedTaskRevision !== input.expectedTaskRevision ||
			validated.data.expectedTaskRevision !== input.expectedTaskRevision
		)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"invalid_request",
				"Task action arguments do not match the persisted tool call.",
			);
		if (input.expectedTaskRevision !== task.updatedAt.getTime())
			return failed(
				input.actionId,
				input.idempotencyKey,
				"revision_conflict",
				"Task revision changed; re-read the Task workspace.",
				{ currentTaskRevision: task.updatedAt.getTime() },
			);
		if (
			!(await actionResourceBelongsToTask(
				input.taskId,
				input.actionId,
				validated.data,
			))
		)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"permission",
				"The requested resource does not belong to this Task.",
			);
		try {
			return {
				ok: true,
				actionId: input.actionId,
				data: await executeAction(input.taskId, input.actionId, validated.data),
			};
		} catch (error) {
			return failed(
				input.actionId,
				input.idempotencyKey,
				"domain_precondition",
				error instanceof Error ? error.message : String(error),
			);
		}
	},
};

async function executeAction(
	taskId: string,
	actionId: string,
	args: Record<string, unknown>,
) {
	switch (actionId) {
		case "task.update":
			return nightworkersService.updateTask(
				taskId,
				(args.fields ?? {}) as Parameters<
					typeof nightworkersService.updateTask
				>[1],
			);
		case "task.message.send":
			return nightworkersService.appendTaskMessage(
				taskId,
				requiredText(args.content),
				{ source: "mission_pilot", intent: "chat" },
			);
		case "task.archive":
			return nightworkersService.archiveTask(taskId);
		case "task.archive.restore":
			return nightworkersService.restoreTaskArchive(taskId);
		case "questionnaire.create":
			return nightworkersService.createDesignQuestionnaire(
				taskId,
				optionalText(args.sourceBlueprintMessageId),
				requiredText(args.prompt),
				{ role: "mission_pilot" },
			);
		case "questionnaire.draft.update":
		case "questionnaire.draft.save":
			return nightworkersService.saveDesignQuestionnaireAnswers(
				taskId,
				requiredText(args.questionnaireSessionId),
				(args.answers ?? []) as Parameters<
					typeof nightworkersService.saveDesignQuestionnaireAnswers
				>[2],
				{ completionPolicy: "finalize_current_questions" },
			);
		case "questionnaire.submit":
			return nightworkersService.saveDesignQuestionnaireAnswers(
				taskId,
				requiredText(args.questionnaireSessionId),
				(args.answers ?? []) as Parameters<
					typeof nightworkersService.saveDesignQuestionnaireAnswers
				>[2],
			);
		case "questionnaire.follow_up.generate":
			return nightworkersService.generateDesignQuestionnaireFollowUp(
				taskId,
				requiredText(args.questionnaireSessionId),
			);
		case "questionnaire.additional.generate":
			return (
				await import("../../questionnaire/questionnaire-additional.service")
			).generateAdditionalDesignQuestionnaireQuestions(taskId, {
				source: requiredText(args.source) as
					| "user_requested"
					| "artifact_triggered"
					| "pre_feature_plan_gate",
				reason: optionalText(args.reason) ?? undefined,
				role: "mission_pilot",
			});
		case "questionnaire.review.generate":
			return nightworkersService.generateDesignQuestionnaireReview(
				taskId,
				requiredText(args.questionnaireSessionId),
			);
		case "questionnaire.review.accept":
			return nightworkersService.acceptDesignQuestionnaireReview(
				taskId,
				requiredText(args.questionnaireSessionId),
			);
		case "questionnaire.review.leave_unadopted":
			return nightworkersService.leaveDesignQuestionnaireReviewUnadopted(
				taskId,
				requiredText(args.questionnaireSessionId),
			);
		case "plan.artifact.feature_plan.generate":
			return (
				await import("../../specification/specification-generation.service")
			).generateFeaturePlanArtifact(taskId, {
				prompt: requiredText(args.prompt),
				questionnaireSessionId: optionalText(args.questionnaireSessionId),
				sourceSelection: recordOrUndefined(args.sourceSelection),
				role: "mission_pilot",
			});
		case "plan.artifact.blueprint.generate":
			return (await import("../../blueprint")).generateBlueprintArtifact(
				taskId,
				{
					prompt: requiredText(args.prompt),
					questionnaireSessionId: optionalText(args.questionnaireSessionId),
					sourceSelection: recordOrUndefined(args.sourceSelection),
					role: "mission_pilot",
				},
			);
		case "plan.artifact.data_model.generate":
			return (
				await import("../../dataModel/dataModel-generation.service")
			).generateDataModelArtifact(taskId, {
				prompt: requiredText(args.prompt),
				questionnaireSessionId: optionalText(args.questionnaireSessionId),
				sourceSelection: recordOrUndefined(args.sourceSelection),
				role: "mission_pilot",
			});
		case "plan.artifact.view.generate": {
			const { generatePlanViewArtifact } = await import(
				"../../planViews/planView-generation.service"
			);
			return generatePlanViewArtifact(
				taskId,
				requiredText(args.view) as Parameters<
					typeof generatePlanViewArtifact
				>[1],
				{
					prompt: requiredText(args.prompt),
					questionnaireSessionId: optionalText(args.questionnaireSessionId),
					sourceSelection: recordOrUndefined(args.sourceSelection),
					role: "mission_pilot",
				},
			);
		}
		case "plan.routing.update": {
			const toolCall = missionPilotPlanRoutingToolCallSchema.parse({
				tool: "edit_plan_artifact_routing",
				expectedRevision: args.expectedRevision,
				idempotencyKey: args.idempotencyKey,
				changes: args.changes,
			});
			return (
				await import("../../planMode/plan-mode-routing.service")
			).executeMissionPilotPlanRoutingTool(taskId, toolCall);
		}
		case "task.queue.enqueue":
			return nightworkersService.queueTask(taskId);
		case "task.queue.update":
			return (
				await import("../../queue/queue-entry-commands.service")
			).patchImplementationQueueEntry(requiredText(args.entryId), {
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
			return (
				await import("../../queue/queue-entry-commands.service")
			).patchImplementationQueueEntry(requiredText(args.entryId), {
				action: "cancel",
			});
		case "task.queue.requeue":
			return (
				await import("../../queue/queue-entry-commands.service")
			).requeueImplementationQueueEntry(requiredText(args.entryId), {
				note: optionalText(args.note) ?? undefined,
			});
		case "task.queue.recover":
			return (
				await import("../../queue/queue-entry-commands.service")
			).recoverImplementationQueueEntry(requiredText(args.entryId), {
				action: requiredText(args.action) as
					| "archive"
					| "cancel"
					| "complete"
					| "retry"
					| "mark_needs_human",
				note: optionalText(args.note) ?? undefined,
			});
		case "task.queue.archive":
			return (
				await import("../../queue/queue-entry-commands.service")
			).archiveImplementationQueueEntry(requiredText(args.entryId));
		case "run.implementation.start": {
			if (args.repairRequest) {
				const request = missionPilotRepairRequestSchema.parse(
					args.repairRequest,
				);
				const session = await db.query.missionPilotSessions.findFirst({
					where: eq(missionPilotSessions.taskId, taskId),
				});
				if (session)
					await (
						await import("./mission-pilot-repair.repository")
					).createMissionPilotRepairRequest({
						sessionId: session.id,
						sourceRunId: request.failure.sourceRunId,
						request,
						sourceRevision: session.contextRevision,
						sourceDigest: session.contextDigest,
					});
			}
			return nightworkersService.appendWorkbenchMessage(taskId, {
				prompt: requiredText(args.request),
				source: "mission_pilot",
				intent: "run_task",
			});
		}
		case "run.test.start":
			return nightworkersService.startVerificationRunFromArtifact({
				projectId: requiredText(args.projectId),
				taskId,
				specArtifactId: requiredText(args.specArtifactId),
				mode: "test",
				action:
					typeof args.action === "string"
						? (args.action as
								| "discover_tests"
								| "plan_and_implement_tests"
								| "run_unit_tests")
						: "run_unit_tests",
				rerun: args.rerun === true,
			});
		case "run.stop":
			return nightworkersService.stopTaskRun(requiredText(args.runId));
		case "background_process.stop":
			return (
				await import(
					"../../nightworkers/nightworkers.background-process.service"
				)
			).stopTaskBackgroundProcess(requiredText(args.processId));
		case "review.session.start":
			return (
				await import("../../review/review-mode.service")
			).startReviewSessionForRun(requiredText(args.sourceRunId));
		case "review.run.start":
			return (await import("../../review/review-mode.service")).startReviewRun(
				requiredText(args.reviewSessionId),
				undefined,
			);
		case "run.review.submit":
			return nightworkersService.reviewTaskRun(requiredText(args.runId), {
				action: requiredText(args.action) as "complete" | "cancel",
				note: typeof args.note === "string" ? args.note : undefined,
			});
		case "task.complete":
			return nightworkersService.reviewTaskRun(requiredText(args.sourceRunId), {
				action: "complete",
			});
		case "git.commit":
			return commitRunGitCloseout(requiredText(args.sourceRunId));
		case "git.push":
			return pushRunGitCloseout(requiredText(args.sourceRunId));
		case "git.merge.preview":
			return (
				await import("../../nightworkers/nightworkers.git-merge.service")
			).previewTaskRunMerge({
				runId: requiredText(args.runId),
				expectedVersion: requiredInteger(args.expectedVersion),
			});
		case "git.merge.defer":
			return (
				await import("../../nightworkers/nightworkers.git-merge.service")
			).deferTaskRunMerge({
				runId: requiredText(args.runId),
				expectedVersion: requiredInteger(args.expectedVersion),
			});
		case "git.merge.rework":
			return (
				await import("../../nightworkers/nightworkers.git-merge.service")
			).requestTaskRunRework({
				runId: requiredText(args.runId),
				expectedVersion: requiredInteger(args.expectedVersion),
			});
		case "git.merge.target.update":
			return (
				await import("../../nightworkers/nightworkers.git-merge.service")
			).overrideTaskRunMergeTarget({
				runId: requiredText(args.runId),
				targetBranch: requiredText(args.targetBranch),
				expectedVersion: requiredInteger(args.expectedVersion),
			});
		case "git.merge.execute":
			return (
				await import("../../nightworkers/nightworkers.git-merge.service")
			).executeTaskRunMerge({
				runId: requiredText(args.runId),
				expectedVersion: requiredInteger(args.expectedVersion),
			});
		default:
			throw new AppError(
				422,
				"MISSION_PILOT_ACTION_UNSUPPORTED",
				`Action ${actionId} is not available in this application command registry yet.`,
			);
	}
}

const runResourceArgumentByAction = new Map<string, string>([
	["run.stop", "runId"],
	["review.session.start", "sourceRunId"],
	["run.review.submit", "runId"],
	["task.complete", "sourceRunId"],
	["git.commit", "sourceRunId"],
	["git.push", "sourceRunId"],
	["git.merge.preview", "runId"],
	["git.merge.defer", "runId"],
	["git.merge.rework", "runId"],
	["git.merge.target.update", "runId"],
	["git.merge.execute", "runId"],
]);
const queueResourceActions = new Set([
	"task.queue.update",
	"task.queue.cancel",
	"task.queue.requeue",
	"task.queue.recover",
	"task.queue.archive",
]);

async function actionResourceBelongsToTask(
	taskId: string,
	actionId: string,
	args: Record<string, unknown>,
) {
	if (actionId === "run.implementation.start") {
		const repairRequest =
			args.repairRequest &&
			typeof args.repairRequest === "object" &&
			!Array.isArray(args.repairRequest)
				? (args.repairRequest as Record<string, unknown>)
				: null;
		const failure =
			repairRequest?.failure &&
			typeof repairRequest.failure === "object" &&
			!Array.isArray(repairRequest.failure)
				? (repairRequest.failure as Record<string, unknown>)
				: null;
		const sourceRunId = failure?.sourceRunId;
		if (typeof sourceRunId !== "string") return true;
		const [run] = await db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(and(eq(taskRuns.id, sourceRunId), eq(taskRuns.taskId, taskId)));
		return Boolean(run);
	}
	const runArgument = runResourceArgumentByAction.get(actionId);
	if (runArgument) {
		const runId = args[runArgument];
		if (typeof runId !== "string") return false;
		const [run] = await db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(and(eq(taskRuns.id, runId), eq(taskRuns.taskId, taskId)));
		return Boolean(run);
	}
	if (queueResourceActions.has(actionId)) {
		const entryId = args.entryId;
		if (typeof entryId !== "string") return false;
		const [entry] = await db
			.select({ id: implementationQueueEntries.id })
			.from(implementationQueueEntries)
			.where(
				and(
					eq(implementationQueueEntries.id, entryId),
					eq(implementationQueueEntries.taskId, taskId),
				),
			);
		return Boolean(entry);
	}
	if (actionId === "background_process.stop") {
		const processId = args.processId;
		if (typeof processId !== "string") return false;
		const [process] = await db
			.select({ id: backgroundProcesses.id })
			.from(backgroundProcesses)
			.where(
				and(
					eq(backgroundProcesses.id, processId),
					eq(backgroundProcesses.taskId, taskId),
				),
			);
		return Boolean(process);
	}
	if (actionId === "review.run.start") {
		const reviewSessionId = args.reviewSessionId;
		if (typeof reviewSessionId !== "string") return false;
		const [reviewSession] = await db
			.select({ id: reviewSessions.id })
			.from(reviewSessions)
			.where(
				and(
					eq(reviewSessions.id, reviewSessionId),
					eq(reviewSessions.taskId, taskId),
				),
			);
		return Boolean(reviewSession);
	}
	return true;
}

function requiredText(value: unknown) {
	if (typeof value !== "string" || value.length === 0)
		throw new AppError(
			422,
			"MISSION_PILOT_ARGUMENT_REQUIRED",
			"A non-empty string is required.",
		);
	return value;
}
function requiredInteger(value: unknown) {
	if (!Number.isInteger(value) || (value as number) < 0)
		throw new AppError(
			422,
			"MISSION_PILOT_ARGUMENT_REQUIRED",
			"A non-negative integer is required.",
		);
	return value as number;
}
function optionalText(value: unknown) {
	return typeof value === "string" && value.length > 0 ? value : null;
}
function recordOrUndefined(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as PlanArtifactSourceSelection)
		: undefined;
}
function failed(
	actionId: string,
	idempotencyKey: string,
	kind: Parameters<typeof failureKind>[0],
	message: string,
	details?: Record<string, unknown>,
): MissionPilotActionResult {
	return {
		ok: false,
		actionId,
		failure: {
			kind,
			retryable: false,
			providerCode: null,
			httpStatus: null,
			message,
			retryAfterMs: null,
			attempt: 1,
			actionId,
			idempotencyKey,
			currentTaskRevision:
				typeof details?.currentTaskRevision === "number"
					? details.currentTaskRevision
					: null,
			details: details ?? null,
		},
	};
}
function failureKind(
	kind:
		| "invalid_request"
		| "schema_validation"
		| "domain_precondition"
		| "permission"
		| "revision_conflict"
		| "outcome_unknown",
) {
	return kind;
}
