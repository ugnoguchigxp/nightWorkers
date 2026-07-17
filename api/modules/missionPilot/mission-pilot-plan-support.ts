import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { PlanModeArtifactKind } from "../../../shared/schemas/plan-mode-artifact.schema";
import { db } from "../../db/client";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import { logEvent } from "../../lib/logger";
import { generateBlueprintArtifact } from "../blueprint";
import { generateDataModelArtifact } from "../dataModel/dataModel-generation.service";
import { appendActivityEvent } from "../nightworkers/nightworkers.activity.repository";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { missionPilotThoughtTrace } from "../nightworkers/nightworkers.trace-provenance";
import { generatePlanViewArtifact } from "../planViews/planView-generation.service";
import {
	getDesignQuestionnaireSession,
	saveDesignQuestionnaireAnswers,
} from "../questionnaire/questionnaire.service";
import { generateAdditionalDesignQuestionnaireQuestions } from "../questionnaire/questionnaire-additional.service";
import type { PlanArtifactGenerationTarget } from "../specification/plan-artifact-input.types";
import type { getPlanModeWorkspace } from "../specification/plan-mode-workspace.service";
import { generateFeaturePlanArtifact } from "../specification/specification-generation.service";
import { missionPilotArtifactProviderExecutionPolicy } from "./adapters/mission-pilot-provider.adapter";
import * as missionPilotRepo from "./mission-pilot.repository";
import * as planRepo from "./mission-pilot-plan.repository";
import { resolveMissionPilotPlanArtifactSources } from "./mission-pilot-plan-artifact-source-resolver";
import { getMissionPilotPlanProgress } from "./mission-pilot-plan-progress.service";
import { assertMissionPilotPreQueueMutable } from "./mission-pilot-pre-queue-recovery.service";
import { buildMissionPilotQuestionnaireDraft } from "./mission-pilot-questionnaire-draft";
import {
	publishMissionPilotPlanProgressUpdated,
	publishMissionPilotUpdated,
} from "./mission-pilot-realtime";
import { missionPilotArtifactTrace } from "./mission-pilot-trace-provenance";

export const activeTasks = new Set<string>();
export const MAX_REVIEW_ATTEMPTS = 3;
export const MAX_QUEUE_STABILIZATION_ATTEMPTS = 3;
export const PIPELINE_LEASE_MS = 15 * 60 * 1000;
export class MissionPilotPlanReviewStaleError extends Error {}

export async function publishCurrentPlanProgress(taskId: string) {
	try {
		const progress = await getMissionPilotPlanProgress(taskId);
		if (progress) publishMissionPilotPlanProgressUpdated(taskId, progress);
	} catch (error) {
		logEvent({
			channel: "mission-pilot",
			level: "warn",
			message: "Plan progress projection publish failed",
			meta: { taskId, error: errorMessage(error) },
		});
	}
}
export type GeneratedArtifact = Awaited<
	ReturnType<typeof generateFeaturePlanArtifact>
>;
export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
export function artifactKinds(
	workspace: Awaited<ReturnType<typeof getPlanModeWorkspace>>,
) {
	return new Set<PlanModeArtifactKind>([
		...workspace.featurePlanArtifacts.map((artifact) => artifact.kind),
		...workspace.blueprintArtifacts.map((artifact) => artifact.kind),
		...workspace.dataModelArtifacts.map((artifact) => artifact.kind),
		...workspace.dedicatedViewArtifacts.map((artifact) => artifact.kind),
	]);
}
export function existingArtifactForStep(
	workspace: Awaited<ReturnType<typeof getPlanModeWorkspace>>,
	stepKey: string,
) {
	if (stepKey === "blueprint") return workspace.blueprintArtifacts.at(-1);
	if (stepKey === "data_model") return workspace.dataModelArtifacts.at(-1);
	if (stepKey === "feature_plan") return workspace.featurePlanArtifacts.at(-1);
	if (stepKey.startsWith("view:")) {
		const view = stepKey.slice("view:".length);
		return [...workspace.dedicatedViewArtifacts]
			.reverse()
			.find((artifact) => artifact.kind === view);
	}
	return null;
}
export function selectMissionPilotPipelineQuestionnaire(
	questionnaires: Array<{ id: string; status: string }>,
	steps: Array<{ stepKey: string; evidenceJson: Record<string, unknown> }>,
) {
	const completed = [...questionnaires]
		.reverse()
		.find((item) => ["review_ready", "accepted"].includes(item.status));
	if (completed) return completed;
	const featurePlanStep = steps.find((step) => step.stepKey === "feature_plan");
	const preFeatureStatus =
		featurePlanStep?.evidenceJson.preFeaturePlanQuestionnaireStatus;
	if (!["running", "waiting_intervention"].includes(String(preFeatureStatus))) {
		return undefined;
	}
	return [...questionnaires]
		.reverse()
		.find((item) => item.status === "answering");
}
export async function updatePhase(
	taskId: string,
	leaseOwner: string,
	phase: string,
	input: {
		desiredState?: "playing" | "stopped";
		error?: string | null;
		errorTextIsModelResponse?: boolean;
	} = {},
) {
	const session = await missionPilotRepo.getSessionByTaskId(taskId);
	if (!session) throw new Error("Mission Pilot Session is missing");
	const [updated] = await db
		.update(missionPilotSessions)
		.set({
			phase,
			...(input.desiredState ? { desiredState: input.desiredState } : {}),
			lastErrorCode: input.error ? "MISSION_PILOT_PLAN_PIPELINE_FAILED" : null,
			lastErrorMessage: input.error ?? null,
			version: session.version + 1,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSessions.id, session.id),
				eq(missionPilotSessions.version, session.version),
				eq(missionPilotSessions.leaseOwner, leaseOwner),
			),
		)
		.returning();
	if (updated) {
		if (input.error) {
			await appendActivityEvent({
				taskId,
				kind: "system.error",
				source: "mission_pilot",
				status: "failed",
				text: input.errorTextIsModelResponse
					? input.error
					: `Mission PilotのPlanパイプラインが停止しました。理由: ${input.error}`,
				payloadJson: {
					source: "mission_pilot",
					missionPilotSessionId: updated.id,
					errorCode: "MISSION_PILOT_PLAN_PIPELINE_FAILED",
					error: input.error,
					errorTextIsModelResponse: input.errorTextIsModelResponse ?? false,
					phase,
					contextRevision: updated.contextRevision,
					contextDigest: updated.contextDigest,
				},
				dedupeKey: `mission-pilot:plan-pipeline:failed:${updated.id}:${updated.version}`,
				trace: missionPilotThoughtTrace({ sessionId: updated.id }),
			}).catch((error) => {
				logEvent({
					channel: "mission-pilot",
					level: "warn",
					message: "Plan pipeline failure activity persistence failed",
					meta: { taskId, sessionId: updated.id, error: errorMessage(error) },
				});
			});
		}
		publishMissionPilotUpdated(
			taskId,
			missionPilotRepo.toControlSummary(updated),
		);
		await publishCurrentPlanProgress(taskId);
	}
	if (!updated) throw new Error("Mission Pilot pipeline lease was lost");
	return updated;
}
export async function renewPipelineLease(
	sessionId: string,
	leaseOwner: string,
) {
	const renewed = await planRepo.renewPipelineLease({
		sessionId,
		owner: leaseOwner,
		expiresAt: new Date(Date.now() + PIPELINE_LEASE_MS),
	});
	if (!renewed) throw new Error("Mission Pilot pipeline lease was lost");
}
export async function generateStepArtifact(
	taskId: string,
	questionnaireSessionId: string,
	step: Awaited<ReturnType<typeof planRepo.listPlanSteps>>[number],
): Promise<GeneratedArtifact> {
	await assertMissionPilotPreQueueMutable(taskId);
	const evidence = step.evidenceJson;
	const kind = String(evidence.kind || "");
	const view = String(evidence.view || "");
	const target = kind === "dedicated_view" ? view : kind;
	const resolved = await resolveMissionPilotPlanArtifactSources({
		sessionId: step.sessionId,
		stepId: step.id,
		target: target as PlanArtifactGenerationTarget,
	});
	const trace = missionPilotArtifactTrace({ sessionId: step.sessionId });
	const llmUsageTrace = missionPilotThoughtTrace({ sessionId: step.sessionId });
	if (kind === "blueprint") {
		return generateBlueprintArtifact(taskId, {
			questionnaireSessionId,
			sourceSelection: resolved.selection,
			expectedState: resolved.expectedState,
			role: "mission_pilot",
			executionPolicy: missionPilotArtifactProviderExecutionPolicy,
			trace,
			llmUsageTrace,
		});
	}
	if (kind === "data_model") {
		return generateDataModelArtifact(taskId, {
			questionnaireSessionId,
			sourceSelection: resolved.selection,
			expectedState: resolved.expectedState,
			role: "mission_pilot",
			executionPolicy: missionPilotArtifactProviderExecutionPolicy,
			trace,
			llmUsageTrace,
		});
	}
	if (kind === "dedicated_view") {
		return generatePlanViewArtifact(
			taskId,
			view as Parameters<typeof generatePlanViewArtifact>[1],
			{
				questionnaireSessionId,
				sourceSelection: resolved.selection,
				expectedState: resolved.expectedState,
				role: "mission_pilot",
				executionPolicy: missionPilotArtifactProviderExecutionPolicy,
				trace,
				llmUsageTrace,
			},
		);
	}
	if (kind === "feature_plan") {
		return generateFeaturePlanArtifact(taskId, {
			questionnaireSessionId,
			sourceSelection: resolved.selection,
			expectedState: resolved.expectedState,
			role: "mission_pilot",
			executionPolicy: missionPilotArtifactProviderExecutionPolicy,
			trace,
			llmUsageTrace,
		});
	}
	throw new Error(`Unsupported Mission Pilot plan step: ${step.stepKey}`);
}

export async function persistArtifactContext(
	sessionId: string,
	stepKey: string,
	result: GeneratedArtifact,
) {
	const metadata: Record<string, unknown> =
		result.message.metadataJson &&
		typeof result.message.metadataJson === "object" &&
		!Array.isArray(result.message.metadataJson)
			? (result.message.metadataJson as Record<string, unknown>)
			: {};
	const content = result.message.content || "";
	const digest = crypto.createHash("sha256").update(content).digest("hex");
	const generation =
		metadata.generation &&
		typeof metadata.generation === "object" &&
		!Array.isArray(metadata.generation)
			? (metadata.generation as Record<string, unknown>)
			: {};
	const inputProjection =
		generation.inputProjection &&
		typeof generation.inputProjection === "object" &&
		!Array.isArray(generation.inputProjection)
			? (generation.inputProjection as Record<string, unknown>)
			: {};
	return planRepo.appendPlanContext(sessionId, "artifact", {
		stepKey,
		sourceMessageId: result.message.id,
		content,
		metadata,
		digest,
		routingRevision:
			typeof inputProjection.routingRevision === "number"
				? inputProjection.routingRevision
				: null,
		createdAt: new Date().toISOString(),
	});
}

export function hasPreFeaturePlanQuestionSet(
	questionnaire: Awaited<ReturnType<typeof getDesignQuestionnaireSession>>,
) {
	return questionnaire.questionSets.some((set) =>
		set.questionnaire?.questionSets.some(
			(group) => group.metadata?.source === "pre_feature_plan_gate",
		),
	);
}

export async function answerPreFeaturePlanQuestionnaire(
	taskId: string,
	sessionId: string,
	questionnaireSessionId: string,
	featurePlanStep: Awaited<ReturnType<typeof planRepo.listPlanSteps>>[number],
	leaseOwner: string,
) {
	await assertMissionPilotPreQueueMutable(taskId);
	let questionnaire = await getDesignQuestionnaireSession(
		taskId,
		questionnaireSessionId,
	);
	if (
		featurePlanStep.evidenceJson.preFeaturePlanQuestionnaireStatus ===
		"completed"
	) {
		return questionnaire;
	}
	const markedRunning = await planRepo.updatePlanStepEvidence(
		featurePlanStep.id,
		{
			preFeaturePlanQuestionnaireStatus: "running",
			preFeaturePlanQuestionnaireStartedAt: new Date().toISOString(),
		},
	);
	if (!markedRunning) {
		throw new Error("Pre-Feature Plan Questionnaire state conflicted");
	}
	await renewPipelineLease(sessionId, leaseOwner);
	let addedCount = 0;
	let skippedDuplicateCount = 0;
	if (!hasPreFeaturePlanQuestionSet(questionnaire)) {
		const generated = await generateAdditionalDesignQuestionnaireQuestions(
			taskId,
			{
				source: "pre_feature_plan_gate",
				reason:
					"Feature Plan生成直前に、生成済みArtifactから実装を阻害する未確定事項だけを確認する。",
				maxQuestions: 5,
				role: "mission_pilot",
				executionPolicy: missionPilotArtifactProviderExecutionPolicy,
				llmUsageTrace: missionPilotThoughtTrace({ sessionId }),
			},
		);
		addedCount = generated.result.addedCount;
		skippedDuplicateCount = generated.result.skippedDuplicateCount;
		if (generated.session) questionnaire = generated.session;
		const recordedGeneration = await planRepo.updatePlanStepEvidence(
			featurePlanStep.id,
			{
				preFeaturePlanQuestionnaireStatus: "running",
				preFeaturePlanQuestionnaireAddedCount: addedCount,
				preFeaturePlanQuestionnaireSkippedDuplicateCount: skippedDuplicateCount,
			},
		);
		if (!recordedGeneration) {
			throw new Error(
				"Pre-Feature Plan Questionnaire generation evidence conflicted",
			);
		}
	}
	if (questionnaire.status === "answering") {
		const existingAnswerIds = new Set(
			questionnaire.answers.map((answer) => answer.questionId),
		);
		const generated = buildMissionPilotQuestionnaireDraft(questionnaire);
		questionnaire = await saveDesignQuestionnaireAnswers(
			taskId,
			questionnaireSessionId,
			generated.answers.filter(
				(answer) => !existingAnswerIds.has(answer.questionId),
			),
			{
				completionPolicy: "finalize_current_questions",
				role: "mission_pilot",
				executionPolicy: missionPilotArtifactProviderExecutionPolicy,
				usageTrace: missionPilotThoughtTrace({ sessionId }),
			},
		);
	}
	if (!["review_ready", "accepted"].includes(questionnaire.status)) {
		throw new Error("Pre-Feature Plan Questionnaire remained incomplete");
	}
	await ensureQuestionnaireContext(sessionId, questionnaire);
	const recordedAddedCount = Number(
		featurePlanStep.evidenceJson.preFeaturePlanQuestionnaireAddedCount ?? 0,
	);
	const recordedSkippedCount = Number(
		featurePlanStep.evidenceJson
			.preFeaturePlanQuestionnaireSkippedDuplicateCount ?? 0,
	);
	const completed = await planRepo.updatePlanStepEvidence(featurePlanStep.id, {
		preFeaturePlanQuestionnaireStatus: "completed",
		preFeaturePlanQuestionnaireCompletedAt: new Date().toISOString(),
		preFeaturePlanQuestionnaireAddedCount: Math.max(
			addedCount,
			recordedAddedCount,
		),
		preFeaturePlanQuestionnaireSkippedDuplicateCount: Math.max(
			skippedDuplicateCount,
			recordedSkippedCount,
		),
	});
	if (!completed) {
		throw new Error("Pre-Feature Plan Questionnaire completion conflicted");
	}
	return questionnaire;
}

export async function finalizeResumedPreFeaturePlanQuestionnaire(input: {
	taskId: string;
	sessionId: string;
	questionnaireSessionId: string;
	questionnaire: Awaited<ReturnType<typeof getDesignQuestionnaireSession>>;
	leaseOwner: string;
}) {
	if (input.questionnaire.status !== "answering") return input.questionnaire;
	const featurePlanStep = (await planRepo.listPlanSteps(input.sessionId)).find(
		(step) => step.stepKey === "feature_plan",
	);
	const preFeatureStatus =
		featurePlanStep?.evidenceJson.preFeaturePlanQuestionnaireStatus;
	if (
		!featurePlanStep ||
		!["running", "waiting_intervention"].includes(String(preFeatureStatus))
	) {
		return input.questionnaire;
	}
	return answerPreFeaturePlanQuestionnaire(
		input.taskId,
		input.sessionId,
		input.questionnaireSessionId,
		featurePlanStep,
		input.leaseOwner,
	);
}

export async function ensureQuestionnaireContext(
	sessionId: string,
	questionnaire: Awaited<ReturnType<typeof getDesignQuestionnaireSession>>,
) {
	const canonicalQuestionSets = questionnaire.questionSets.map((set) => ({
		id: set.id,
		sequence: set.sequence,
		questionnaire: set.questionnaire,
		validationStatus: set.validationStatus,
		createdAt: set.createdAt,
	}));
	const questionnaireDigest = crypto
		.createHash("sha256")
		.update(
			JSON.stringify({
				status: questionnaire.status,
				answers: questionnaire.answers ?? [],
				questionSets: canonicalQuestionSets,
			}),
		)
		.digest("hex");
	const context = await latestContext(sessionId);
	const plan =
		context?.contextJson.plan &&
		typeof context.contextJson.plan === "object" &&
		!Array.isArray(context.contextJson.plan)
			? (context.contextJson.plan as Record<string, unknown>)
			: null;
	const saved =
		plan?.questionnaire &&
		typeof plan.questionnaire === "object" &&
		!Array.isArray(plan.questionnaire)
			? (plan.questionnaire as Record<string, unknown>)
			: null;
	if (
		saved?.sessionId === questionnaire.id &&
		saved.questionnaireDigest === questionnaireDigest
	)
		return;
	const updated = await planRepo.appendPlanContext(sessionId, "questionnaire", {
		sessionId: questionnaire.id,
		status: questionnaire.status,
		answers: questionnaire.answers ?? [],
		questionSets: canonicalQuestionSets,
		questionnaireDigest,
	});
	if (!updated) throw new Error("Questionnaire Context persistence failed");
}

export async function latestContext(sessionId: string) {
	return db.query.missionPilotContextSnapshots.findFirst({
		where: eq(missionPilotContextSnapshots.sessionId, sessionId),
		orderBy: (row, { desc }) => [desc(row.revision)],
	});
}

export function taskContextValue(
	task: NonNullable<Awaited<ReturnType<typeof nightworkersRepo.getTask>>>,
) {
	return {
		title: task.title,
		initialPrompt: task.objective ?? "",
		description: task.description,
		acceptanceCriteria: task.acceptanceCriteria,
		worktreePath: task.worktreePath,
		repositoryId: task.repositoryId,
	};
}

export async function synchronizeTaskContext(
	taskId: string,
	sessionId: string,
) {
	const [task, context] = await Promise.all([
		nightworkersRepo.getTask(taskId),
		latestContext(sessionId),
	]);
	if (!task || !context) throw new Error("Task Context is missing");
	const next = taskContextValue(task);
	if (JSON.stringify(context.contextJson.task) === JSON.stringify(next)) return;
	const updated = await planRepo.appendPlanContext(sessionId, "task", next);
	if (!updated) throw new Error("Task Context synchronization failed");
}

export async function assertTaskContextCurrent(
	taskId: string,
	sessionId: string,
) {
	const [task, context] = await Promise.all([
		nightworkersRepo.getTask(taskId),
		latestContext(sessionId),
	]);
	if (!task || !context) throw new Error("Task Context is missing");
	if (
		JSON.stringify(context.contextJson.task) !==
		JSON.stringify(taskContextValue(task))
	)
		throw new MissionPilotPlanReviewStaleError(
			"Task changed after the passing plan review",
		);
}
