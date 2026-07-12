import crypto from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { buildPlanModeExecutionSteps } from "../../../shared/plan-mode-execution";
import {
	type MissionPilotPlanReview,
	missionPilotPlanReviewSchema,
	normalizeMissionPilotPlanReview,
} from "../../../shared/schemas/mission-pilot-plan-review.schema";
import { planModeRegenerationTargetSchema } from "../../../shared/schemas/plan-mode-artifact.schema";
import type { PlanModeArtifactCorrectionTarget } from "../../../shared/schemas/plan-mode-artifact-correction.schema";
import { db } from "../../db/client";
import { missionPilotSessions } from "../../db/mission-pilot-schema";
import { readGeneralSettings } from "../../services/settings/general-settings";
import { callStructuredJsonLLM } from "../../services/structured-llm";
import { normalizeStructuredOutputJsonSchema } from "../../services/structured-llm/json-schema";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { getLatestVerificationDocumentForTask } from "../nightworkers/nightworkers.verification.repository";
import { getDesignQuestionnaireSession } from "../questionnaire/questionnaire.service";
import { getPlanModeWorkspace } from "../specification/plan-mode-workspace.service";
import * as missionPilotRepo from "./mission-pilot.repository";
import { executeMissionPilotArtifactCorrection } from "./mission-pilot-artifact-correction.service";
import * as planRepo from "./mission-pilot-plan.repository";
import {
	activeTasks,
	answerPreFeaturePlanQuestionnaire,
	artifactKinds,
	assertTaskContextCurrent,
	ensureQuestionnaireContext,
	errorMessage,
	existingArtifactForStep,
	type GeneratedArtifact,
	generateStepArtifact,
	latestContext,
	MAX_QUEUE_STABILIZATION_ATTEMPTS,
	MAX_REVIEW_ATTEMPTS,
	MissionPilotPlanReviewStaleError,
	MissionPilotQuestionnaireInterventionError,
	PIPELINE_LEASE_MS,
	persistArtifactContext,
	publishCurrentPlanProgress,
	renewPipelineLease,
	synchronizeTaskContext,
	updatePhase,
} from "./mission-pilot-plan-support";
import { releaseMissionPilotQueueHandoff } from "./mission-pilot-post-queue-coordinator.service";
import {
	assertMissionPilotPreQueueMutable,
	markMissionPilotPreQueueAttention,
} from "./mission-pilot-pre-queue-recovery.service";
import {
	admitMissionPilotQueueHandoff,
	MissionPilotPreQueueError,
} from "./mission-pilot-queue-handoff.service";

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
			"revisionTargetsは、指摘が書かれている場所ではなく矛盾を導入した生成済みArtifactをtargetにしてください。",
			"QuestionnaireとBlueprintが矛盾する場合はBlueprintをtargetにし、sourceMessageIdへ対象Artifact messageのUUIDを指定してください。",
			"Blueprintの特定画面またはSectionを特定できる場合はfocusをscreenまたはsectionにし、構造化Artifact内のIDを指定してください。",
			"上流Artifactを直す場合は、その結果へ追随させるFeature Planも別revisionTargetとして含めてください。",
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
			role: "mission_pilot",
			schemaName: "mission_pilot_plan_review",
			schema: buildMissionPilotPlanReviewResponseJsonSchema(),
		},
	);
	return {
		review: normalizeMissionPilotPlanReview(JSON.parse(raw)),
		featurePlanMessageId: featurePlanMessage.id,
		contextRevision: session.contextRevision,
		contextDigest: session.contextDigest,
	};
}

export function buildMissionPilotPlanReviewResponseJsonSchema() {
	return normalizeStructuredOutputJsonSchema(
		z.toJSONSchema(missionPilotPlanReviewSchema),
	);
}

async function executeArtifactCorrections(input: {
	taskId: string;
	sessionId: string;
	questionnaireSessionId: string;
	reviewId: string;
	targets: PlanModeArtifactCorrectionTarget[];
	contextRevision: number;
	contextDigest: string;
	leaseOwner: string;
}) {
	await assertMissionPilotPreQueueMutable(input.taskId);
	const workspace = await getPlanModeWorkspace(input.taskId);
	const targets = [...input.targets];
	const targetKeys = new Set(
		targets.map((target) => `${target.target}:${target.sourceMessageId}`),
	);
	const appendDependency = (
		target: PlanModeArtifactCorrectionTarget["target"],
		sourceMessageId: string,
		instruction: string,
	) => {
		const key = `${target}:${sourceMessageId}`;
		if (targetKeys.has(key)) return;
		targetKeys.add(key);
		targets.push({
			target,
			sourceMessageId,
			focus: { kind: "artifact" },
			instruction,
			preserveUnfocusedContent: true,
		});
	};
	for (const target of input.targets) {
		for (const artifact of workspace.dedicatedViewArtifacts) {
			if (
				artifact.kind === "blueprint" ||
				artifact.kind === "feature_plan" ||
				artifact.sourceMessageId === target.sourceMessageId
			)
				continue;
			const dependsOnTarget =
				(target.target === "blueprint" &&
					artifact.sourceBlueprintMessageId === target.sourceMessageId) ||
				(target.target === "data_model" &&
					artifact.sourceDataModelMessageId === target.sourceMessageId);
			if (!dependsOnTarget) continue;
			const parsedTarget = planModeRegenerationTargetSchema.safeParse(
				artifact.kind,
			);
			if (!parsedTarget.success) continue;
			appendDependency(
				parsedTarget.data,
				artifact.sourceMessageId,
				"上流Plan Artifactの修正結果を正として再生成し、古いsourceに基づく内容を残さないでください。",
			);
		}
	}
	if (
		targets.some((target) => target.target !== "feature_plan") &&
		!targets.some((target) => target.target === "feature_plan")
	) {
		const featurePlan = workspace.featurePlanArtifacts.at(-1);
		if (featurePlan) {
			appendDependency(
				"feature_plan",
				featurePlan.sourceMessageId,
				"上流Plan Artifactの修正結果を正としてFeature Planを再生成し、古いsourceに基づく記述を残さないでください。",
			);
		}
	}
	const rank: Record<PlanModeArtifactCorrectionTarget["target"], number> = {
		blueprint: 10,
		data_model: 20,
		user_flow: 30,
		api_io_contract: 30,
		activity_flow: 30,
		sequence_flow: 30,
		zod_schema_design: 30,
		feature_plan: 40,
	};
	targets.sort((left, right) => rank[left.target] - rank[right.target]);
	const runs = await planRepo.createArtifactCorrectionRuns({
		sessionId: input.sessionId,
		taskId: input.taskId,
		planReviewId: input.reviewId,
		contextRevision: input.contextRevision,
		contextDigest: input.contextDigest,
		targets,
	});
	for (const run of runs) {
		if (run.status === "applied" || run.status === "superseded") continue;
		await updatePhase(input.taskId, input.leaseOwner, "correcting_artifact");
		await renewPipelineLease(input.sessionId, input.leaseOwner);
		await executeMissionPilotArtifactCorrection({
			taskId: input.taskId,
			sessionId: input.sessionId,
			questionnaireSessionId: input.questionnaireSessionId,
			run,
		});
		await publishCurrentPlanProgress(input.taskId);
	}
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
		await updatePhase(taskId, leaseOwner, "awaiting_artifact_correction");
		await renewPipelineLease(sessionId, leaseOwner);
		await executeArtifactCorrections({
			taskId,
			sessionId,
			questionnaireSessionId,
			reviewId: latest.id,
			targets: result.review.revisionTargets,
			contextRevision: result.contextRevision,
			contextDigest: result.contextDigest,
			leaseOwner,
		});
		await updatePhase(taskId, leaseOwner, "reviewing_plan");
	}
	throw new Error("Plan review did not pass within three attempts");
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
	const correctionRuns = await planRepo.listArtifactCorrectionRuns(sessionId);
	if (
		correctionRuns.some((run) =>
			[
				"pending",
				"dispatching",
				"running",
				"result_received",
				"validating",
			].includes(run.status),
		)
	)
		throw new Error("Plan Artifact correction is still active");
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
		if (error instanceof MissionPilotQuestionnaireInterventionError) return;
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
					"awaiting_artifact_correction",
					"correcting_artifact",
					"validating_artifact",
					"revising_dependencies",
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
				await planRepo.recoverArtifactCorrectionRuns(pilot.id);
			}
		}
		await runMissionPilotPlanPipeline(session.taskId).catch(() => undefined);
	}
	return sessions.length;
}
