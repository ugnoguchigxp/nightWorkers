import { z } from "zod";
import {
	type MissionPilotPlanReview,
	missionPilotPlanReviewSchema,
	validateMissionPilotPlanReviewFacts,
} from "../../../shared/schemas/mission-pilot-plan-review.schema";
import { buildMissionPilotPlanReviewSystemPrompt } from "../../services/structured-generation/prompts/mission-pilot-plan-review";
import { repairStructuredOutputOnce } from "../../services/structured-generation/structured-output-repair.service";
import {
	callStructuredLlmResult,
	createStructuredOutputContract,
	validateStructuredLlmFacts,
} from "../../services/structured-llm";
import { normalizeStructuredOutputJsonSchema } from "../../services/structured-llm/json-schema";
import { appendActivityEvent } from "../nightworkers/nightworkers.activity.repository";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { missionPilotThoughtTrace } from "../nightworkers/nightworkers.trace-provenance";
import { resolvePlanModeProjectStackContext } from "../specification/plan-mode-project-stack-context";
import { getPlanModeWorkspace } from "../specification/plan-mode-workspace.service";
import * as missionPilotRepo from "./mission-pilot.repository";
import {
	collectCurrentReviewArtifacts,
	latestContext,
} from "./mission-pilot-plan-support";
import { assertMissionPilotPreQueueMutable } from "./mission-pilot-pre-queue-recovery.service";

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function compactCanonicalReviewContext(value: unknown) {
	const context = toRecord(value);
	const plan = toRecord(context.plan);
	const { artifacts: _artifacts, reviews: _reviews, ...currentPlan } = plan;
	return { ...context, plan: currentPlan };
}

export async function reviewCurrentPlan(
	taskId: string,
	sessionId: string,
	attempt: number,
): Promise<{
	review: MissionPilotPlanReview;
	featurePlanMessageId: string;
	contextRevision: number;
	contextDigest: string;
	routingRevision: number;
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
	const projectStackContext = await resolvePlanModeProjectStackContext(
		task.repositoryId,
	);
	const featurePlan = workspace.featurePlanArtifacts.at(-1);
	if (!featurePlan) throw new Error("Feature Plan is missing");
	const featurePlanMessage = messages.find(
		(message) => message.id === featurePlan.sourceMessageId,
	);
	if (!featurePlanMessage) throw new Error("Feature Plan message is missing");
	const reviewArtifacts = collectCurrentReviewArtifacts(workspace);
	const reviewArtifactPayloads = reviewArtifacts.map((artifact) => {
		const message = messages.find(
			(candidate) => candidate.id === artifact.sourceMessageId,
		);
		if (!message) {
			throw new Error(
				`Review Artifact message is missing: ${artifact.artifactKind}`,
			);
		}
		return { ...artifact, content: message.content };
	});
	const currentRouting = workspace.routing ?? {
		revision: session.planRoutingRevision,
		entries: workspace.viewDecisions,
	};
	const contract = createStructuredOutputContract({
		name: "mission_pilot_plan_review",
		runtimeSchema: missionPilotPlanReviewSchema,
		providerJsonSchema: buildMissionPilotPlanReviewResponseJsonSchema(),
	});
	const llmOptions = {
		taskId,
		role: "mission_pilot" as const,
		usageTrace: missionPilotThoughtTrace({ sessionId }),
		contract,
	};
	const initialResponse = await callStructuredLlmResult(
		buildMissionPilotPlanReviewSystemPrompt(contract),
		JSON.stringify({
			reviewAttempt: attempt,
			task: {
				title: task.title,
				objective: task.objective,
				acceptanceCriteria: task.acceptanceCriteria,
			},
			contextRevision: session.contextRevision,
			contextDigest: session.contextDigest,
			projectStackContext,
			canonicalContext: compactCanonicalReviewContext(context.contextJson),
			currentRouting,
			reviewArtifacts: reviewArtifactPayloads,
		}),
		llmOptions,
	);
	const validateFacts = (review: MissionPilotPlanReview) =>
		validateMissionPilotPlanReviewFacts(review, {
			reviewedArtifacts: reviewArtifacts,
			currentRouting,
		});
	const validatedResponse = validateStructuredLlmFacts(
		initialResponse,
		validateFacts,
	);
	await recordPlanReviewAttempt({
		taskId,
		sessionId,
		reviewAttempt: attempt,
		result: validatedResponse,
	});
	const repaired = await repairStructuredOutputOnce({
		initialResult: validatedResponse,
		options: llmOptions,
		validateFacts,
		beforeRepair: () =>
			assertPlanReviewStateCurrent(taskId, {
				contextRevision: session.contextRevision,
				contextDigest: session.contextDigest,
				routingRevision: session.planRoutingRevision,
			}),
		onRepairResult: (result) =>
			recordPlanReviewAttempt({
				taskId,
				sessionId,
				reviewAttempt: attempt,
				result,
			}),
	});
	await assertPlanReviewStateCurrent(taskId, {
		contextRevision: session.contextRevision,
		contextDigest: session.contextDigest,
		routingRevision: session.planRoutingRevision,
	});
	return {
		review: repaired.value,
		featurePlanMessageId: featurePlanMessage.id,
		contextRevision: session.contextRevision,
		contextDigest: session.contextDigest,
		routingRevision: session.planRoutingRevision,
	};
}

async function assertPlanReviewStateCurrent(
	taskId: string,
	expected: {
		contextRevision: number;
		contextDigest: string;
		routingRevision: number;
	},
) {
	const currentSession = await missionPilotRepo.getSessionByTaskId(taskId);
	if (
		currentSession?.desiredState === "playing" &&
		currentSession.contextRevision === expected.contextRevision &&
		currentSession.contextDigest === expected.contextDigest &&
		currentSession.planRoutingRevision === expected.routingRevision
	) {
		return;
	}
	throw new Error(
		"Mission Pilot state changed while the plan review response was being validated.",
	);
}

async function recordPlanReviewAttempt(input: {
	taskId: string;
	sessionId: string;
	reviewAttempt: number;
	result: Awaited<
		ReturnType<typeof callStructuredLlmResult<MissionPilotPlanReview>>
	>;
}) {
	await appendActivityEvent({
		taskId: input.taskId,
		kind: "assistant.raw_output",
		source: "mission_pilot",
		status: input.result.ok ? "completed" : "failed",
		text: input.result.attempt.rawText,
		payloadJson: {
			source: "mission_pilot",
			intent: "structured_llm_raw_output",
			missionPilotSessionId: input.sessionId,
			schemaName: "mission_pilot_plan_review",
			reviewAttempt: input.reviewAttempt,
			structuredOutputAttempt: input.result.attempt.attempt,
			validationStatus: input.result.ok ? "validated" : "failed",
			issues: input.result.issues,
			repairKind: input.result.attempt.repairKind,
		},
		dedupeKey: `mission-pilot:plan-review-output:${input.sessionId}:${input.reviewAttempt}:${input.result.attempt.attempt}`,
		trace: missionPilotThoughtTrace({
			sessionId: input.sessionId,
			attempt: input.reviewAttempt,
		}),
	});
}

export function buildMissionPilotPlanReviewResponseJsonSchema() {
	return normalizeStructuredOutputJsonSchema(
		z.toJSONSchema(missionPilotPlanReviewSchema),
	);
}
