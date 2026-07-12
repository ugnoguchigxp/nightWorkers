import crypto from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { buildPlanModeExecutionSteps } from "../../../shared/plan-mode-execution";
import {
	type MissionPilotPlanReview,
	missionPilotPlanReviewSchema,
	normalizeMissionPilotPlanReview,
} from "../../../shared/schemas/mission-pilot-plan-review.schema";
import type { PlanModeArtifactKind } from "../../../shared/schemas/plan-mode-artifact.schema";
import { dedicatedDesignViewSchema } from "../../../shared/schemas/plan-mode-artifact.schema";
import { db } from "../../db/client";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import { logEvent } from "../../lib/logger";
import { readGeneralSettings } from "../../services/settings/general-settings";
import { callStructuredJsonLLM } from "../../services/structured-llm";
import { generateBlueprintArtifact } from "../blueprint/blueprint-generation.service";
import { generateDataModelArtifact } from "../dataModel/dataModel-generation.service";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { getLatestVerificationDocumentForTask } from "../nightworkers/nightworkers.verification.repository";
import { generatePlanViewArtifact } from "../planViews/planView-generation.service";
import {
	getDesignQuestionnaireSession,
	saveDesignQuestionnaireAnswers,
} from "../questionnaire/questionnaire.service";
import { generateAdditionalDesignQuestionnaireQuestions } from "../questionnaire/questionnaire-additional.service";
import { getPlanModeWorkspace } from "../specification/plan-mode-workspace.service";
import { generateFeaturePlanArtifact } from "../specification/specification-generation.service";
import * as missionPilotRepo from "./mission-pilot.repository";
import * as planRepo from "./mission-pilot-plan.repository";
import { getMissionPilotPlanProgress } from "./mission-pilot-plan-progress.service";
import { releaseMissionPilotQueueHandoff } from "./mission-pilot-post-queue-coordinator.service";
import {
	assertMissionPilotPreQueueMutable,
	markMissionPilotPreQueueAttention,
} from "./mission-pilot-pre-queue-recovery.service";
import { buildMissionPilotQuestionnaireDraft } from "./mission-pilot-questionnaire-draft";
import {
	admitMissionPilotQueueHandoff,
	MissionPilotPreQueueError,
} from "./mission-pilot-queue-handoff.service";
import {
	publishMissionPilotPlanProgressUpdated,
	publishMissionPilotUpdated,
} from "./mission-pilot-realtime";

const activeTasks = new Set<string>();
const MAX_REVIEW_ATTEMPTS = 3;
const MAX_QUEUE_STABILIZATION_ATTEMPTS = 3;
const PIPELINE_LEASE_MS = 15 * 60 * 1000;

class MissionPilotPlanReviewStaleError extends Error {}

async function publishCurrentPlanProgress(taskId: string) {
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

type GeneratedArtifact = Awaited<
	ReturnType<typeof generateFeaturePlanArtifact>
>;

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function artifactKinds(
	workspace: Awaited<ReturnType<typeof getPlanModeWorkspace>>,
) {
	return new Set<PlanModeArtifactKind>([
		...workspace.featurePlanArtifacts.map((artifact) => artifact.kind),
		...workspace.blueprintArtifacts.map((artifact) => artifact.kind),
		...workspace.dataModelArtifacts.map((artifact) => artifact.kind),
		...workspace.dedicatedViewArtifacts.map((artifact) => artifact.kind),
	]);
}

function existingArtifactForStep(
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

async function updatePhase(
	taskId: string,
	leaseOwner: string,
	phase: string,
	input: { desiredState?: "playing" | "stopped"; error?: string | null } = {},
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
		publishMissionPilotUpdated(
			taskId,
			missionPilotRepo.toControlSummary(updated),
		);
		await publishCurrentPlanProgress(taskId);
	}
	if (!updated) throw new Error("Mission Pilot pipeline lease was lost");
	return updated;
}

async function renewPipelineLease(sessionId: string, leaseOwner: string) {
	const renewed = await planRepo.renewPipelineLease({
		sessionId,
		owner: leaseOwner,
		expiresAt: new Date(Date.now() + PIPELINE_LEASE_MS),
	});
	if (!renewed) throw new Error("Mission Pilot pipeline lease was lost");
}

async function generateStepArtifact(
	taskId: string,
	questionnaireSessionId: string,
	step: Awaited<ReturnType<typeof planRepo.listPlanSteps>>[number],
): Promise<GeneratedArtifact> {
	await assertMissionPilotPreQueueMutable(taskId);
	const evidence = step.evidenceJson;
	const kind = String(evidence.kind || "");
	const view = String(evidence.view || "");
	if (kind === "blueprint") {
		return generateBlueprintArtifact(taskId, { questionnaireSessionId });
	}
	if (kind === "data_model") {
		return generateDataModelArtifact(taskId, { questionnaireSessionId });
	}
	if (kind === "dedicated_view") {
		return generatePlanViewArtifact(
			taskId,
			view as Parameters<typeof generatePlanViewArtifact>[1],
			{ questionnaireSessionId },
		);
	}
	if (kind === "feature_plan") {
		return generateFeaturePlanArtifact(taskId, { questionnaireSessionId });
	}
	throw new Error(`Unsupported Mission Pilot plan step: ${step.stepKey}`);
}

async function persistArtifactContext(
	sessionId: string,
	stepKey: string,
	result: GeneratedArtifact,
) {
	const metadata =
		result.message.metadataJson &&
		typeof result.message.metadataJson === "object" &&
		!Array.isArray(result.message.metadataJson)
			? result.message.metadataJson
			: {};
	const content = result.message.content || "";
	const digest = crypto.createHash("sha256").update(content).digest("hex");
	return planRepo.appendPlanContext(sessionId, "artifact", {
		stepKey,
		sourceMessageId: result.message.id,
		content,
		metadata,
		digest,
		createdAt: new Date().toISOString(),
	});
}

function hasPreFeaturePlanQuestionSet(
	questionnaire: Awaited<ReturnType<typeof getDesignQuestionnaireSession>>,
) {
	return questionnaire.questionSets.some((set) =>
		set.questionnaire?.questionSets.some(
			(group) => group.metadata?.source === "pre_feature_plan_gate",
		),
	);
}

async function answerPreFeaturePlanQuestionnaire(
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
			},
		);
		addedCount = generated.result.addedCount;
		skippedDuplicateCount = generated.result.skippedDuplicateCount;
		if (generated.session) questionnaire = generated.session;
	}
	if (questionnaire.status === "answering") {
		const draft = buildMissionPilotQuestionnaireDraft(questionnaire);
		questionnaire = await saveDesignQuestionnaireAnswers(
			taskId,
			questionnaire.id,
			draft.answers,
			{ completionPolicy: "finalize_current_questions" },
		);
	}
	if (!["review_ready", "accepted"].includes(questionnaire.status)) {
		throw new Error("Pre-Feature Plan Questionnaire remained incomplete");
	}
	await ensureQuestionnaireContext(sessionId, questionnaire);
	const completed = await planRepo.updatePlanStepEvidence(featurePlanStep.id, {
		preFeaturePlanQuestionnaireStatus: "completed",
		preFeaturePlanQuestionnaireCompletedAt: new Date().toISOString(),
		preFeaturePlanQuestionnaireAddedCount: addedCount,
		preFeaturePlanQuestionnaireSkippedDuplicateCount: skippedDuplicateCount,
	});
	if (!completed) {
		throw new Error("Pre-Feature Plan Questionnaire completion conflicted");
	}
	return questionnaire;
}

async function executeArtifactSteps(
	taskId: string,
	sessionId: string,
	questionnaireSessionId: string,
	leaseOwner: string,
) {
	await assertMissionPilotPreQueueMutable(taskId);
	await updatePhase(taskId, leaseOwner, "generating_artifacts");
	const workspace = await getPlanModeWorkspace(taskId);
	const questionnaire = await getDesignQuestionnaireSession(
		taskId,
		questionnaireSessionId,
	);
	if (!["review_ready", "accepted"].includes(questionnaire.status)) {
		throw new Error(
			"Completed Questionnaire is required for Artifact generation",
		);
	}
	await ensureQuestionnaireContext(sessionId, questionnaire);
	const steps = buildPlanModeExecutionSteps({
		capabilities: readGeneralSettings().planMode.capabilities,
		viewDecisions: workspace.viewDecisions,
		questionnaireExists: true,
		questionnaireComplete: ["review_ready", "accepted"].includes(
			questionnaire.status,
		),
		existingArtifactKinds: artifactKinds(workspace),
	});
	const rows = await planRepo.synchronizePlanSteps(sessionId, steps);
	await publishCurrentPlanProgress(taskId);
	for (const row of rows) {
		if (row.status === "completed" && row.stepKey !== "questionnaire") {
			const artifact = existingArtifactForStep(workspace, row.stepKey);
			if (!artifact) {
				throw new Error(`Completed Plan step has no Artifact: ${row.stepKey}`);
			}
			if (row.artifactMessageId === artifact.sourceMessageId) continue;
			const messages = await nightworkersRepo.listTaskMessages(taskId);
			const message = messages.find(
				(candidate) => candidate.id === artifact.sourceMessageId,
			);
			if (!message) {
				throw new Error(`Plan Artifact message is missing: ${row.stepKey}`);
			}
			const updatedSession = await persistArtifactContext(
				sessionId,
				row.stepKey,
				{ message, workspace } as GeneratedArtifact,
			);
			if (!updatedSession) throw new Error("Mission Pilot Context is missing");
			const adopted = await planRepo.adoptPlanStepArtifact(row.id, {
				artifactMessageId: message.id,
				evidence: {
					...row.evidenceJson,
					sourceMessageId: message.id,
					contextRevision: updatedSession.contextRevision,
					contextDigest: updatedSession.contextDigest,
					adoptedExistingArtifact: true,
				},
			});
			if (!adopted)
				throw new Error(`Plan step adoption conflicted: ${row.stepKey}`);
			await publishCurrentPlanProgress(taskId);
			continue;
		}
		if (row.status === "completed" || row.status === "skipped") continue;
		if (row.stepKey === "questionnaire") continue;
		if (row.stepKey === "feature_plan") {
			await answerPreFeaturePlanQuestionnaire(
				taskId,
				sessionId,
				questionnaireSessionId,
				row,
				leaseOwner,
			);
		}
		if (row.status === "failed" && row.attempt >= 2) {
			throw new Error(`Plan step retry limit exceeded: ${row.stepKey}`);
		}
		const claimed = await planRepo.claimPlanStep(row.id);
		if (!claimed) continue;
		try {
			await publishCurrentPlanProgress(taskId);
			await renewPipelineLease(sessionId, leaseOwner);
			const result = await generateStepArtifact(
				taskId,
				questionnaireSessionId,
				claimed,
			);
			const currentSession = await missionPilotRepo.getSessionByTaskId(taskId);
			if (!currentSession || currentSession.desiredState !== "playing") {
				throw new Error("Mission Pilot stopped during Artifact generation");
			}
			const updatedSession = await persistArtifactContext(
				sessionId,
				claimed.stepKey,
				result,
			);
			if (!updatedSession) throw new Error("Mission Pilot Context changed");
			await planRepo.completePlanStep(claimed.id, {
				artifactMessageId: result.message.id,
				evidence: {
					...claimed.evidenceJson,
					sourceMessageId: result.message.id,
					contextRevision: updatedSession.contextRevision,
					contextDigest: updatedSession.contextDigest,
				},
			});
			await publishCurrentPlanProgress(taskId);
		} catch (error) {
			await planRepo.failPlanStep(claimed.id, errorMessage(error));
			await publishCurrentPlanProgress(taskId);
			throw error;
		}
	}
	const finalSteps = await planRepo.listPlanSteps(sessionId);
	const blocker = finalSteps.find(
		(step) =>
			!["completed", "skipped"].includes(step.status) &&
			step.stepKey !== "questionnaire",
	);
	if (blocker)
		throw new Error(`Plan step did not complete: ${blocker.stepKey}`);
}

async function ensureQuestionnaireContext(
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

async function latestContext(sessionId: string) {
	return db.query.missionPilotContextSnapshots.findFirst({
		where: eq(missionPilotContextSnapshots.sessionId, sessionId),
		orderBy: (row, { desc }) => [desc(row.revision)],
	});
}

async function reviewCurrentPlan(
	taskId: string,
	sessionId: string,
	attempt: number,
): Promise<{
	review: MissionPilotPlanReview;
	featurePlanMessageId: string;
	contextRevision: number;
	contextDigest: string;
}> {
	await assertMissionPilotPreQueueMutable(taskId);
	const [session, context, workspace, messages, task] = await Promise.all([
		missionPilotRepo.getSessionByTaskId(taskId),
		latestContext(sessionId),
		getPlanModeWorkspace(taskId),
		nightworkersRepo.listTaskMessages(taskId),
		nightworkersRepo.getTask(taskId),
	]);
	if (!session || !context || !task)
		throw new Error("Review context is missing");
	const featurePlan = workspace.featurePlanArtifacts.at(-1);
	if (!featurePlan) throw new Error("Feature Plan is missing");
	const featurePlanMessage = messages.find(
		(message) => message.id === featurePlan.sourceMessageId,
	);
	if (!featurePlanMessage) throw new Error("Feature Plan message is missing");
	const raw = await callStructuredJsonLLM(
		[
			"あなたはMission Pilotの実装計画レビュアーです。",
			"Goal、確定Questionnaire、生成Artifact、Feature Plan、受け入れ条件、検証の整合性を審査してください。",
			"確定QuestionnaireとTask acceptance criteriaは不変の入力であり、実装詳細をすべて列挙する文書ではありません。回答と矛盾しない型、値、取得元、コマンド、検証詳細はFeature Planが具体化します。",
			"QuestionnaireまたはTask acceptance criteriaの変更を要求せず、不足する派生仕様はfeature_planのrevisionTargetとして返してください。",
			"revisionTargetsのartifactKindは生成済みで改訂可能なPlan Artifactに限定してください。",
			"追加質問なしで実装可能で、blocking findingがない場合だけpassにしてください。",
			"warningだけの場合はcoverageをpassとしてverdict=passを返してください。warningを理由にreviseを返さないでください。",
			"修正可能ならreviseとし、revisionTargetsへ具体的な再生成指示を入れてください。",
		].join("\n"),
		JSON.stringify({
			reviewAttempt: attempt,
			task: {
				title: task.title,
				objective: task.objective,
				acceptanceCriteria: task.acceptanceCriteria,
			},
			contextRevision: session.contextRevision,
			contextDigest: session.contextDigest,
			canonicalContext: context.contextJson,
			featurePlan: featurePlanMessage.content,
		}),
		{
			taskId,
			role: "review",
			schemaName: "mission_pilot_plan_review",
			schema: z.toJSONSchema(missionPilotPlanReviewSchema),
		},
	);
	return {
		review: normalizeMissionPilotPlanReview(JSON.parse(raw)),
		featurePlanMessageId: featurePlanMessage.id,
		contextRevision: session.contextRevision,
		contextDigest: session.contextDigest,
	};
}

async function reviseArtifacts(
	taskId: string,
	sessionId: string,
	questionnaireSessionId: string,
	review: MissionPilotPlanReview,
) {
	await assertMissionPilotPreQueueMutable(taskId);
	const revisionInstructions = new Map<string, string[]>();
	for (const target of review.revisionTargets) {
		const artifactKind =
			target.artifactKind === "questionnaire" ||
			target.artifactKind === "acceptance_criteria"
				? "feature_plan"
				: target.artifactKind;
		const current = revisionInstructions.get(artifactKind) ?? [];
		current.push(target.instruction);
		revisionInstructions.set(artifactKind, current);
	}
	for (const [artifactKind, targetInstructions] of revisionInstructions) {
		if (artifactKind === "feature_plan") continue;
		const prompt = [
			"Mission Pilotのセルフレビュー指摘を反映して再生成してください。",
			...targetInstructions,
		].join("\n");
		let result: GeneratedArtifact;
		if (artifactKind === "blueprint") {
			result = await generateBlueprintArtifact(taskId, {
				questionnaireSessionId,
				prompt,
			});
		} else if (artifactKind === "data_model") {
			result = await generateDataModelArtifact(taskId, {
				questionnaireSessionId,
				prompt,
			});
		} else {
			const view = dedicatedDesignViewSchema.safeParse(artifactKind);
			if (!view.success || view.data === "questionnaire") continue;
			result = await generatePlanViewArtifact(taskId, view.data, {
				questionnaireSessionId,
				prompt,
			});
		}
		await persistArtifactContext(
			sessionId,
			`${artifactKind}:revision:${Date.now()}`,
			result,
		);
	}
	const instructions = review.revisionTargets
		.map((target) => {
			if (target.artifactKind === "questionnaire") {
				return `feature_plan: 確定Questionnaireは変更せず、次の不足を回答と矛盾しない明示的な実装判断としてFeature Plan内で具体化する。Questionnaireを更新済みとは記載しない。${target.instruction}`;
			}
			if (target.artifactKind === "acceptance_criteria") {
				return `feature_plan: Task acceptance criteriaは変更せず、次の内容を派生する検証可能な完了条件としてFeature Planへ追加する。Task側を更新済みとは記載しない。${target.instruction}`;
			}
			return `${target.artifactKind}: ${target.instruction}`;
		})
		.join("\n");
	const result = await generateFeaturePlanArtifact(taskId, {
		questionnaireSessionId,
		prompt: [
			"Mission Pilotのセルフレビュー指摘を反映して改訂してください。",
			"確定QuestionnaireとTask acceptance criteriaは変更せず、それらと矛盾しない派生仕様、実装手順、検証手順をFeature Plan内で確定してください。",
			"QuestionnaireやTaskを更新したという未確認の記述、実装時に確認するという先送り、条件付きの検証gateを残さないでください。",
			instructions,
		].join("\n"),
	});
	const updated = await persistArtifactContext(
		sessionId,
		`feature_plan:revision:${Date.now()}`,
		result,
	);
	if (!updated) throw new Error("Revised Context persistence failed");
}

async function executeReview(
	taskId: string,
	sessionId: string,
	questionnaireSessionId: string,
	leaseOwner: string,
) {
	await updatePhase(taskId, leaseOwner, "reviewing_plan");
	await synchronizeTaskContext(taskId, sessionId);
	let latest = await planRepo.getLatestPlanReview(sessionId);
	const currentSession = await missionPilotRepo.getSessionByTaskId(taskId);
	if (
		latest?.verdict === "pass" &&
		currentSession &&
		latest.contextRevision === currentSession.contextRevision &&
		latest.contextDigest === currentSession.contextDigest
	)
		return latest;
	const firstAttempt = (latest?.attempt ?? 0) + 1;
	for (
		let attempt = firstAttempt;
		attempt < firstAttempt + MAX_REVIEW_ATTEMPTS;
		attempt++
	) {
		await renewPipelineLease(sessionId, leaseOwner);
		const result = await reviewCurrentPlan(taskId, sessionId, attempt);
		latest = await planRepo.createPlanReview({
			sessionId,
			contextRevision: result.contextRevision,
			contextDigest: result.contextDigest,
			featurePlanMessageId: result.featurePlanMessageId,
			attempt,
			review: result.review,
		});
		if (result.review.verdict === "pass") return latest;
		if (result.review.verdict === "reject") {
			throw new Error(`Plan review rejected: ${result.review.summary}`);
		}
		if (attempt >= firstAttempt + MAX_REVIEW_ATTEMPTS - 1) break;
		await updatePhase(taskId, leaseOwner, "revising_plan");
		await renewPipelineLease(sessionId, leaseOwner);
		await reviseArtifacts(
			taskId,
			sessionId,
			questionnaireSessionId,
			result.review,
		);
		await updatePhase(taskId, leaseOwner, "reviewing_plan");
	}
	throw new Error("Plan review did not pass within three attempts");
}

function taskContextValue(
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

async function synchronizeTaskContext(taskId: string, sessionId: string) {
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

async function assertTaskContextCurrent(taskId: string, sessionId: string) {
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

async function admitToQueue(
	taskId: string,
	sessionId: string,
	leaseOwner: string,
) {
	await synchronizeTaskContext(taskId, sessionId);
	const [session, review, steps] = await Promise.all([
		missionPilotRepo.getSessionByTaskId(taskId),
		planRepo.getLatestPlanReview(sessionId),
		planRepo.listPlanSteps(sessionId),
	]);
	if (!session || session.desiredState !== "playing")
		throw new Error("Mission Pilot is not playing");
	await assertTaskContextCurrent(taskId, sessionId);
	if (!missionPilotRepo.hasValidAuthorization(session))
		throw new Error("Mission Pilot queue authorization is invalid");
	if (
		!review ||
		review.verdict !== "pass" ||
		review.contextRevision !== session.contextRevision ||
		review.contextDigest !== session.contextDigest
	)
		throw new MissionPilotPlanReviewStaleError(
			"Latest Context does not have a passing plan review",
		);
	if (steps.some((step) => !["completed", "skipped"].includes(step.status)))
		throw new Error("Plan execution steps are incomplete");
	const [workspace, verificationDocument] = await Promise.all([
		getPlanModeWorkspace(taskId),
		getLatestVerificationDocumentForTask(taskId),
	]);
	const questionnaire = [...workspace.questionnaireSessions]
		.reverse()
		.find((item) => ["review_ready", "accepted"].includes(item.status));
	if (!questionnaire) throw new Error("Completed Questionnaire is missing");
	const featurePlan = workspace.featurePlanArtifacts.at(-1);
	if (!featurePlan) throw new Error("Feature Plan is missing");
	if (
		!verificationDocument ||
		verificationDocument.status !== "active" ||
		verificationDocument.specMessageId !== featurePlan.sourceMessageId
	)
		throw new Error("Latest Feature Plan verification document is missing");
	await updatePhase(taskId, leaseOwner, "queueing");
	await renewPipelineLease(sessionId, leaseOwner);
	await admitMissionPilotQueueHandoff({
		taskId,
		sessionId,
		planReviewId: review.id,
		featurePlanMessageId: featurePlan.sourceMessageId,
		verificationDocumentId: verificationDocument.id,
		leaseOwner,
	});
	await releaseMissionPilotQueueHandoff(taskId);
}

export async function runMissionPilotPlanPipeline(taskId: string) {
	if (activeTasks.has(taskId)) return;
	activeTasks.add(taskId);
	const leaseOwner = `${process.pid}:${crypto.randomUUID()}`;
	let leasedSessionId: string | null = null;
	try {
		const preflight = await missionPilotRepo.getSessionByTaskId(taskId);
		if (
			!preflight ||
			preflight.desiredState !== "playing" ||
			preflight.nextWakeAt ||
			preflight.phase === "queued"
		)
			return;
		const workspace = await getPlanModeWorkspace(taskId);
		const questionnaire = [...workspace.questionnaireSessions]
			.reverse()
			.find((item) => ["review_ready", "accepted"].includes(item.status));
		if (!questionnaire) return;
		const session = await planRepo.claimPipelineLease({
			taskId,
			owner: leaseOwner,
			expiresAt: new Date(Date.now() + PIPELINE_LEASE_MS),
		});
		if (!session) return;
		leasedSessionId = session.id;
		await executeArtifactSteps(
			taskId,
			session.id,
			questionnaire.id,
			leaseOwner,
		);
		await executeReview(taskId, session.id, questionnaire.id, leaseOwner);
		for (
			let attempt = 1;
			attempt <= MAX_QUEUE_STABILIZATION_ATTEMPTS;
			attempt++
		) {
			try {
				await admitToQueue(taskId, session.id, leaseOwner);
				break;
			} catch (error) {
				if (
					!(error instanceof MissionPilotPlanReviewStaleError) ||
					attempt >= MAX_QUEUE_STABILIZATION_ATTEMPTS
				)
					throw error;
				await executeReview(taskId, session.id, questionnaire.id, leaseOwner);
			}
		}
	} catch (error) {
		const current = await missionPilotRepo.getSessionByTaskId(taskId);
		if (current?.desiredState === "stopped" && current.phase !== "attention") {
			return;
		}
		if (leasedSessionId && error instanceof MissionPilotPreQueueError) {
			await markMissionPilotPreQueueAttention(taskId, error, leaseOwner).catch(
				() => undefined,
			);
		} else if (leasedSessionId) {
			await updatePhase(taskId, leaseOwner, "attention", {
				desiredState: "stopped",
				error: errorMessage(error),
			}).catch(() => undefined);
		}
		throw error;
	} finally {
		if (leasedSessionId) {
			await planRepo.releasePipelineLease(leasedSessionId, leaseOwner);
		}
		activeTasks.delete(taskId);
	}
}

export async function resumeMissionPilotPlanPipelines(
	input: { recoverInterrupted?: boolean } = {},
) {
	let recoveredLeaseSessionIds = new Set<string>();
	if (input.recoverInterrupted) {
		recoveredLeaseSessionIds = new Set(await planRepo.recoverPipelineLeases());
	}
	const sessions = await db
		.select({ taskId: missionPilotSessions.taskId })
		.from(missionPilotSessions)
		.where(
			and(
				eq(missionPilotSessions.desiredState, "playing"),
				isNull(missionPilotSessions.nextWakeAt),
				inArray(missionPilotSessions.phase, [
					"initial_intake",
					"generating_artifacts",
					"reviewing_plan",
					"revising_plan",
					"queueing",
				]),
			),
		);
	for (const session of sessions) {
		if (input.recoverInterrupted) {
			const pilot = await missionPilotRepo.getSessionByTaskId(session.taskId);
			if (
				pilot &&
				(!pilot.leaseOwner || recoveredLeaseSessionIds.has(pilot.id))
			) {
				await planRepo.recoverRunningPlanSteps(pilot.id);
			}
		}
		await runMissionPilotPlanPipeline(session.taskId).catch(() => undefined);
	}
	return sessions.length;
}
