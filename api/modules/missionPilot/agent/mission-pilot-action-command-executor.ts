import { eq } from "drizzle-orm";
import { missionPilotRepairRequestSchema } from "../../../../shared/schemas/mission-pilot-agent.schema";
import { missionPilotPlanRoutingToolCallSchema } from "../../../../shared/schemas/plan-mode-routing.schema";
import { db } from "../../../db/client";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";
import { AppError } from "../../../lib/errors";
import {
	commitRunGitCloseout,
	pushRunGitCloseout,
} from "../../nightworkers/nightworkers.git-closeout.service";
import * as nightworkersService from "../../nightworkers/nightworkers.service";
import type { PlanArtifactSourceSelection } from "../../specification/plan-artifact-input.types";

export type MissionPilotActionCommandContext = {
	sessionId: string;
	toolCallId: string;
	idempotencyKey: string;
	expectedTaskRevision: number;
	sourceRunId: string | null;
};

export async function executeMissionPilotAction(
	taskId: string,
	actionId: string,
	args: Record<string, unknown>,
	context: MissionPilotActionCommandContext,
) {
	const missionPilotAgent = {
		kind: "agent" as const,
		sessionId: context.sessionId,
		toolCallId: context.toolCallId,
		idempotencyKey: context.idempotencyKey,
		completionOwner: "mission_pilot" as const,
		sourceRunId: context.sourceRunId,
	};
	switch (actionId) {
		case "task.update":
			return nightworkersService.updateTask(
				taskId,
				(args.fields ?? {}) as Parameters<
					typeof nightworkersService.updateTask
				>[1],
				{ expectedRevision: context.expectedTaskRevision },
			);
		case "task.message.send":
			return nightworkersService.appendAssistantTaskMessage(
				taskId,
				requiredText(args.content),
				{
					source: "mission_pilot",
					intent: "chat",
					missionPilotAction: {
						idempotencyKey: context.idempotencyKey,
						toolCallId: context.toolCallId,
					},
				},
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
				{
					role: "mission_pilot",
					missionPilotActionKey: context.idempotencyKey,
				},
			);
		case "questionnaire.draft.update":
		case "questionnaire.draft.save":
			return (
				await import("./mission-pilot-agent-questionnaire.service")
			).saveAgentQuestionnaireDraft({
				taskId,
				questionnaireSessionId: requiredText(args.questionnaireSessionId),
				answers: (args.answers ?? []) as Parameters<
					typeof nightworkersService.saveDesignQuestionnaireAnswers
				>[2],
				answerEvidence: (args.answerEvidence ?? []) as Array<{
					questionId: string;
					reason: string;
				}>,
				idempotencyKey: context.idempotencyKey,
			});
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
			return nightworkersService.queueTask(taskId, { missionPilotAgent });
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
			const { startTaskRun } = await import(
				"../../nightworkers/run-orchestration/start-task-run-entry"
			);
			return startTaskRun(taskId, {
				executionMode: "implementation",
				executionModeSource: "explicit",
				latestUserMessageOverride: requiredText(args.request),
				missionPilotPhase: "implementation",
				missionPilotAgent,
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
				missionPilotAgent,
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
				{ missionPilotAgent },
			);
		case "run.review.submit":
			if (requiredText(args.action) === "complete")
				throw new AppError(
					409,
					"MISSION_PILOT_EXPLICIT_COMPLETE_REQUIRED",
					"Use task.complete after reading the terminal Run outcome.",
				);
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
