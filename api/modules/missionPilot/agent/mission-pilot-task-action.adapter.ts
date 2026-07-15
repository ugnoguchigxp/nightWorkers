import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DesignQuestionnaireAnswer } from "../../../../shared/schemas/design-questionnaire.schema";
import type { PlanModeRegenerationTarget } from "../../../../shared/schemas/plan-mode-artifact.schema";
import type { PlanModeRoutingEntry } from "../../../../shared/schemas/plan-mode-routing.schema";
import { db } from "../../../db/client";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";
import { reviewSessions } from "../../../db/review-mode-schema";
import {
	backgroundProcesses,
	implementationQueueEntries,
	taskRuns,
	tasks,
} from "../../../db/schema";
import { AppError } from "../../../lib/errors";
import { generateBlueprintArtifact } from "../../blueprint";
import { generateDataModelArtifact } from "../../dataModel/dataModel-generation.service";
import { stopTaskBackgroundProcess } from "../../nightworkers/nightworkers.background-process.service";
import {
	commitRunGitCloseout,
	pushRunGitCloseout,
} from "../../nightworkers/nightworkers.git-closeout.service";
import {
	deferTaskRunMerge,
	executeTaskRunMerge,
	overrideTaskRunMergeTarget,
	previewTaskRunMerge,
	requestTaskRunRework,
} from "../../nightworkers/nightworkers.git-merge.service";
import { getPlanModeTaskMessage } from "../../nightworkers/nightworkers.plan-mode-core.port";
import * as nightworkersService from "../../nightworkers/nightworkers.service";
import { updatePlanModeRoutingForUser } from "../../planMode/plan-mode-routing.service";
import { generatePlanViewArtifact } from "../../planViews/planView-generation.service";
import {
	acceptDesignQuestionnaireReview,
	createDesignQuestionnaire,
	generateDesignQuestionnaireFollowUp,
	generateDesignQuestionnaireReview,
	leaveDesignQuestionnaireReviewUnadopted,
	listDesignQuestionnaires,
	saveDesignQuestionnaireAnswers,
} from "../../questionnaire/questionnaire.service";
import { generateAdditionalDesignQuestionnaireQuestions } from "../../questionnaire/questionnaire-additional.service";
import {
	archiveImplementationQueueEntry,
	patchImplementationQueueEntry,
	recoverImplementationQueueEntry,
	requeueImplementationQueueEntry,
} from "../../queue/queue-management.service";
import {
	startReviewRun,
	startReviewSessionForRun,
} from "../../review/review-mode.service";
import { createPlanArtifactSourceSelection } from "../../specification/plan-artifact-source-selection";
import { generateFeaturePlanArtifact } from "../../specification/specification-generation.service";
import {
	missionPilotActionFailed,
	toMissionPilotActionFailure,
} from "./mission-pilot-action-failure";
import type { MissionPilotTaskActionPort } from "./mission-pilot-agent.ports";
import {
	getMissionPilotActionDefinition,
	validateMissionPilotActionArguments,
} from "./mission-pilot-task-action.registry";

type Args = Record<string, unknown>;

export const missionPilotTaskActionPort: MissionPilotTaskActionPort = {
	async execute(input) {
		const definition = getMissionPilotActionDefinition(input.actionId);
		if (!definition) {
			return missionPilotActionFailed(
				input,
				"invalid_request",
				"Unknown Task action",
				false,
			);
		}
		const validated = validateMissionPilotActionArguments(
			definition,
			input.arguments,
		);
		if (!validated.success) {
			return missionPilotActionFailed(
				input,
				"schema_validation",
				validated.message,
				false,
			);
		}
		const [session, task] = await Promise.all([
			db.query.missionPilotSessions.findFirst({
				where: and(
					eq(missionPilotSessions.id, input.sessionId),
					eq(missionPilotSessions.taskId, input.taskId),
				),
			}),
			db.query.tasks.findFirst({ where: eq(tasks.id, input.taskId) }),
		]);
		if (!session || !task) {
			return missionPilotActionFailed(
				input,
				"domain_precondition",
				"Task or Mission Pilot session not found",
				false,
			);
		}
		if (!session.authorizationJson?.scopes[definition.authorizationScope]) {
			return missionPilotActionFailed(
				input,
				"permission",
				`authorization scope ${definition.authorizationScope} is not granted`,
				false,
			);
		}
		try {
			const data = await executeAction(
				input.taskId,
				input.actionId,
				validated.data,
				{
					idempotencyKey: input.idempotencyKey,
					taskUpdatedAt: task.updatedAt,
				},
			);
			return { ok: true, actionId: input.actionId, data };
		} catch (error) {
			return {
				ok: false,
				actionId: input.actionId,
				failure: toMissionPilotActionFailure(
					error,
					input.actionId,
					input.idempotencyKey,
				),
			};
		}
	},
};

async function executeAction(
	taskId: string,
	actionId: string,
	args: Args,
	context: { idempotencyKey: string; taskUpdatedAt: Date },
) {
	switch (actionId) {
		case "task.update": {
			assertExpectedTaskRevision(args, context.taskUpdatedAt);
			return nightworkersService.updateTask(taskId, record(args.fields));
		}
		case "task.message.send":
			return nightworkersService.appendWorkbenchMessage(taskId, {
				prompt: text(args.content),
				intent: optionalText(args.intent) as Parameters<
					typeof nightworkersService.appendWorkbenchMessage
				>[1]["intent"],
				artifactContext: (args.artifactContext ?? undefined) as Parameters<
					typeof nightworkersService.appendWorkbenchMessage
				>[1]["artifactContext"],
				providerEndpointId: optionalText(args.providerEndpointId),
				model: optionalText(args.model),
				thinkingDepth: optionalText(args.thinkingDepth) as Parameters<
					typeof nightworkersService.appendWorkbenchMessage
				>[1]["thinkingDepth"],
			});
		case "task.delete":
			return nightworkersService.deleteTask(taskId);
		case "task.archive":
			return nightworkersService.archiveTask(taskId);
		case "task.archive.restore":
			return nightworkersService.restoreTaskArchive(taskId);
		case "questionnaire.create":
			return createDesignQuestionnaire(
				taskId,
				text(args.sourceBlueprintMessageId),
			);
		case "questionnaire.draft.update":
			return saveDesignQuestionnaireAnswers(
				taskId,
				text(args.questionnaireSessionId),
				args.answers as DesignQuestionnaireAnswer[],
				{ completionPolicy: "finalize_current_questions" },
			);
		case "questionnaire.submit":
			return saveDesignQuestionnaireAnswers(
				taskId,
				text(args.questionnaireSessionId),
				args.answers as DesignQuestionnaireAnswer[],
			);
		case "questionnaire.follow_up.generate":
			return generateDesignQuestionnaireFollowUp(
				taskId,
				text(args.questionnaireSessionId),
			);
		case "questionnaire.additional.generate":
			return generateAdditionalDesignQuestionnaireQuestions(taskId, {
				source: text(args.source) as "user_requested",
				reason: optionalText(args.reason),
				maxQuestions: optionalInteger(args.maxQuestions),
			});
		case "questionnaire.review.generate":
			return generateDesignQuestionnaireReview(
				taskId,
				text(args.questionnaireSessionId),
			);
		case "questionnaire.review.accept":
			return acceptDesignQuestionnaireReview(
				taskId,
				text(args.questionnaireSessionId),
			);
		case "questionnaire.review.leave_unadopted":
			return leaveDesignQuestionnaireReviewUnadopted(
				taskId,
				text(args.questionnaireSessionId),
			);
		case "plan.routing.update":
			return updatePlanModeRoutingForUser(taskId, {
				expectedRevision: integerValue(args.expectedRevision),
				idempotencyKey:
					context.idempotencyKey.split(":").at(-1) ?? crypto.randomUUID(),
				changes: (args.entries as PlanModeRoutingEntry[]).flatMap((entry) =>
					entry.view === "questionnaire" || entry.view === "feature_plan"
						? []
						: [
								{
									view: entry.view,
									decision: entry.decision,
									reason: entry.reason,
								},
							],
				),
			});
		case "plan.artifact.generate":
			return generatePlanArtifact(taskId, args, false);
		case "plan.artifact.regenerate":
			return generatePlanArtifact(taskId, args, true);
		case "task.queue.enqueue":
			return nightworkersService.queueTask(taskId);
		case "task.queue.update":
			await assertQueueEntryBelongsToTask(text(args.entryId), taskId);
			return patchImplementationQueueEntry(text(args.entryId), {
				priority: optionalNumber(args.priority),
				queuePosition: optionalInteger(args.queuePosition),
			});
		case "task.queue.cancel":
			await assertQueueEntryBelongsToTask(text(args.entryId), taskId);
			return patchImplementationQueueEntry(text(args.entryId), {
				action: "cancel",
			});
		case "task.queue.requeue":
			await assertQueueEntryBelongsToTask(text(args.entryId), taskId);
			return requeueImplementationQueueEntry(text(args.entryId), {
				note: optionalText(args.note),
			});
		case "task.queue.recover":
			await assertQueueEntryBelongsToTask(text(args.entryId), taskId);
			return recoverImplementationQueueEntry(text(args.entryId), {
				action: optionalText(args.action) as NonNullable<
					Parameters<typeof recoverImplementationQueueEntry>[1]
				>["action"],
				note: optionalText(args.note),
			});
		case "task.queue.archive":
			await assertQueueEntryBelongsToTask(text(args.entryId), taskId);
			return archiveImplementationQueueEntry(text(args.entryId));
		case "run.implementation.start":
			return nightworkersService.appendWorkbenchMessage(taskId, {
				prompt: text(args.request),
				intent: "run_task",
				providerEndpointId: optionalText(args.providerEndpointId),
				model: optionalText(args.model),
				thinkingDepth: optionalText(args.thinkingDepth) as Parameters<
					typeof nightworkersService.appendWorkbenchMessage
				>[1]["thinkingDepth"],
			});
		case "run.test.start":
			return nightworkersService.startTestModeRunFromArtifact({
				projectId: text(args.projectId),
				taskId,
				specArtifactId: text(args.specArtifactId),
				verificationDocumentId: optionalText(args.verificationDocumentId),
				mode: "test",
				action: optionalText(args.action) as Parameters<
					typeof nightworkersService.startTestModeRunFromArtifact
				>[0]["action"],
				rerun: optionalBoolean(args.rerun),
			});
		case "run.stop":
			await assertRunBelongsToTask(text(args.runId), taskId);
			return nightworkersService.stopTaskRun(text(args.runId));
		case "background_process.stop":
			await assertBackgroundProcessBelongsToTask(text(args.processId), taskId);
			return stopTaskBackgroundProcess(text(args.processId));
		case "review.session.start":
			await assertRunBelongsToTask(text(args.sourceRunId), taskId);
			return startReviewSessionForRun(text(args.sourceRunId));
		case "review.run.start":
			await assertReviewSessionBelongsToTask(
				text(args.reviewSessionId),
				taskId,
			);
			return startReviewRun(
				text(args.reviewSessionId),
				recordOrUndefined(args.options),
			);
		case "run.review.submit":
			await assertRunBelongsToTask(text(args.runId), taskId);
			return nightworkersService.reviewTaskRun(text(args.runId), {
				action: text(args.action) as "complete" | "cancel",
				note: optionalText(args.note),
			});
		case "git.commit":
			await assertRunBelongsToTask(text(args.sourceRunId), taskId);
			return commitRunGitCloseout(text(args.sourceRunId));
		case "git.push":
			await assertRunBelongsToTask(text(args.sourceRunId), taskId);
			return pushRunGitCloseout(text(args.sourceRunId));
		case "git.merge.preview":
			return runMergeAction(taskId, args, previewTaskRunMerge);
		case "git.merge.defer":
			return runMergeAction(taskId, args, deferTaskRunMerge);
		case "git.merge.rework":
			return runMergeAction(taskId, args, requestTaskRunRework);
		case "git.merge.execute":
			return runMergeAction(taskId, args, executeTaskRunMerge);
		case "git.merge.target.update":
			await assertRunBelongsToTask(text(args.runId), taskId);
			return overrideTaskRunMergeTarget({
				runId: text(args.runId),
				targetBranch: text(args.targetBranch),
				expectedVersion: integerValue(args.expectedVersion),
			});
		default:
			throw new AppError(400, "UNKNOWN_ACTION", `Unknown action: ${actionId}`);
	}
}

async function generatePlanArtifact(
	taskId: string,
	args: Args,
	regenerate: boolean,
) {
	const questionnaireSessions = await listDesignQuestionnaires(taskId);
	const currentQuestionnaireRevision =
		questionnaireSessions.at(-1)?.questionSets.length ?? 0;
	if (
		integerValue(args.questionnaireRevision) !== currentQuestionnaireRevision
	) {
		throw new AppError(
			409,
			"QUESTIONNAIRE_REVISION_CONFLICT",
			"Questionnaire Decisions changed; re-read them before generating the Artifact",
		);
	}
	let target = optionalText(args.artifactKind) as
		| PlanModeRegenerationTarget
		| undefined;
	let targetMessageId: string | null = null;
	if (regenerate) {
		targetMessageId = text(args.targetArtifactId);
		const message = await getPlanModeTaskMessage(targetMessageId);
		if (!message || message.taskId !== taskId)
			throw new AppError(404, "ARTIFACT_NOT_FOUND", "Plan Artifact not found");
		target = targetFromMetadata(record(message.metadataJson));
	}
	if (!target)
		throw new AppError(
			422,
			"ARTIFACT_KIND_REQUIRED",
			"A supported artifact kind is required",
		);
	const sourceIds = record(args.sourceIds ?? args.sourceRevisions);
	const sourceSelection = createPlanArtifactSourceSelection({
		policy: "explicit_request",
		previousTargetMessageId: targetMessageId,
		featurePlanMessageId: optionalText(sourceIds.featurePlanMessageId),
		blueprintMessageId: optionalText(sourceIds.blueprintMessageId),
		dataModelMessageId: optionalText(sourceIds.dataModelMessageId),
		dedicatedViewMessageIds: Array.isArray(sourceIds.dedicatedViewMessageIds)
			? sourceIds.dedicatedViewMessageIds.filter(
					(value): value is string => typeof value === "string",
				)
			: [],
	});
	const prompt = regenerate
		? [
				`確認した具体的な欠陥: ${text(args.defect)}`,
				`維持する既存部分: ${Array.isArray(args.preserve) ? args.preserve.join("、") : "指摘外の全内容"}`,
				"確定済みQuestionnaire Decisionsを変更・縮小・別案へ置換せず、対象の欠陥だけを修正してください。",
			].join("\n")
		: optionalText(args.prompt);
	const input = {
		prompt,
		questionnaireSessionId: optionalText(args.questionnaireSessionId),
		sourceSelection,
		role: "mission_pilot" as const,
	};
	if (target === "feature_plan")
		return generateFeaturePlanArtifact(taskId, input);
	if (target === "blueprint") return generateBlueprintArtifact(taskId, input);
	if (target === "data_model") return generateDataModelArtifact(taskId, input);
	return generatePlanViewArtifact(taskId, target, input);
}

function targetFromMetadata(metadata: Record<string, unknown>) {
	if (metadata.intent === "feature_plan") return "feature_plan" as const;
	if (
		metadata.intent === "app_blueprint" ||
		metadata.intent === "mock_blueprint"
	)
		return "blueprint" as const;
	if (metadata.view === "data_model") return "data_model" as const;
	if (
		metadata.artifactKind === "plan_mode_dedicated_view" ||
		metadata.artifactKind === "plan_mode_api_contract" ||
		metadata.artifactKind === "plan_mode_zod_schema"
	) {
		return metadata.view as PlanModeRegenerationTarget;
	}
	return undefined;
}

async function runMergeAction(
	taskId: string,
	args: Args,
	handler: (input: {
		runId: string;
		expectedVersion: number;
	}) => Promise<unknown>,
) {
	const runId = text(args.runId);
	await assertRunBelongsToTask(runId, taskId);
	return handler({
		runId,
		expectedVersion: integerValue(args.expectedVersion),
	});
}

async function assertRunBelongsToTask(runId: string, taskId: string) {
	const [run] = await db
		.select({ taskId: taskRuns.taskId })
		.from(taskRuns)
		.where(and(eq(taskRuns.id, runId), eq(taskRuns.taskId, taskId)));
	if (!run) throw new AppError(404, "RUN_NOT_FOUND", "Run not found for Task");
}

async function assertQueueEntryBelongsToTask(entryId: string, taskId: string) {
	const [entry] = await db
		.select({ taskId: implementationQueueEntries.taskId })
		.from(implementationQueueEntries)
		.where(
			and(
				eq(implementationQueueEntries.id, entryId),
				eq(implementationQueueEntries.taskId, taskId),
			),
		);
	if (!entry)
		throw new AppError(
			404,
			"QUEUE_ENTRY_NOT_FOUND",
			"Queue Entry not found for Task",
		);
}

async function assertBackgroundProcessBelongsToTask(
	processId: string,
	taskId: string,
) {
	const [process] = await db
		.select({ taskId: backgroundProcesses.taskId })
		.from(backgroundProcesses)
		.where(
			and(
				eq(backgroundProcesses.id, processId),
				eq(backgroundProcesses.taskId, taskId),
			),
		);
	if (!process)
		throw new AppError(
			404,
			"BACKGROUND_PROCESS_NOT_FOUND",
			"Background process not found for Task",
		);
}

async function assertReviewSessionBelongsToTask(
	reviewSessionId: string,
	taskId: string,
) {
	const [session] = await db
		.select({ taskId: reviewSessions.taskId })
		.from(reviewSessions)
		.where(
			and(
				eq(reviewSessions.id, reviewSessionId),
				eq(reviewSessions.taskId, taskId),
			),
		);
	if (!session)
		throw new AppError(
			404,
			"REVIEW_SESSION_NOT_FOUND",
			"Review session not found for Task",
		);
}

function assertExpectedTaskRevision(args: Args, updatedAt: Date) {
	const expected = integerValue(args.expectedRevision);
	if (expected !== updatedAt.getTime()) {
		throw new AppError(
			409,
			"TASK_REVISION_CONFLICT",
			"Task revision changed; re-read the Task workspace",
		);
	}
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function recordOrUndefined(value: unknown) {
	const result = record(value);
	return Object.keys(result).length ? result : undefined;
}
function text(value: unknown) {
	if (typeof value !== "string" || !value)
		throw new AppError(
			422,
			"STRING_REQUIRED",
			"A non-empty string is required",
		);
	return value;
}
function optionalText(value: unknown) {
	return typeof value === "string" && value ? value : undefined;
}
function integerValue(value: unknown) {
	if (typeof value !== "number" || !Number.isInteger(value))
		throw new AppError(422, "INTEGER_REQUIRED", "An integer is required");
	return value;
}
function optionalInteger(value: unknown) {
	return typeof value === "number" && Number.isInteger(value)
		? value
		: undefined;
}
function optionalNumber(value: unknown) {
	return typeof value === "number" ? value : undefined;
}
function optionalBoolean(value: unknown) {
	return typeof value === "boolean" ? value : undefined;
}
