import crypto from "node:crypto";
import { z } from "zod";
import {
	type MissionPilotPlanReview,
	type MissionPilotReviewedArtifact,
	missionPilotPlanReviewSchema,
	validateMissionPilotPlanReviewFacts,
} from "../../../shared/modules/missionPilot";
import { planModeRegenerationTargetSchema } from "../../../shared/schemas/plan-mode-artifact.schema";
import { repairStructuredOutputOnce } from "../../services/structured-generation/structured-output-repair.service";
import {
	callStructuredLlmResult,
	createStructuredOutputContract,
	type StructuredLlmResult,
	validateStructuredLlmFacts,
} from "../../services/structured-llm";
import { normalizeStructuredOutputJsonSchema } from "../../services/structured-llm/json-schema";
import { appendActivityEvent } from "../nightworkers/nightworkers.activity.repository";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { missionPilotThoughtTrace } from "../nightworkers/nightworkers.trace-provenance";
import { projectPlanArtifactInput } from "../specification/plan-artifact-input-projection";
import {
	buildPlanArtifactPromptBudgetMetadata,
	PLAN_ARTIFACT_GENERATION_TIMEOUT_MS,
	renderPlanArtifactInput,
} from "../specification/plan-artifact-input-renderer";
import { createPlanArtifactSourceSelection } from "../specification/plan-artifact-source-selection";
import { missionPilotArtifactProviderExecutionPolicy } from "./adapters/mission-pilot-provider.adapter";
import { resolvePlanArtifactCanonicalInput } from "./artifacts/plan-artifact-input-context.service";
import * as missionPilotRepo from "./mission-pilot.repository";
import { latestContext } from "./mission-pilot-plan-support";
import { assertMissionPilotPreQueueMutable } from "./mission-pilot-pre-queue-recovery.service";
import { getPlanModeRouting } from "./planning/plan-mode-routing.service";
import { buildMissionPilotPlanReviewSystemPrompt } from "./prompts/mission-pilot-plan-review";

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
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
	const [session, context, currentRouting, task] = await Promise.all([
		missionPilotRepo.getSessionByTaskId(taskId),
		latestContext(sessionId),
		getPlanModeRouting(taskId),
		nightworkersRepo.getTask(taskId),
	]);
	if (!session || !context || !task)
		throw new Error("Review context is missing");
	const reviewArtifacts = collectReviewArtifactsFromContext(
		context.contextJson,
		currentRouting,
	);
	const featurePlan = reviewArtifacts.find(
		(artifact) => artifact.artifactKind === "feature_plan",
	);
	if (!featurePlan)
		throw new Error("Feature Plan is missing from Plan Context");
	const referenceAliases = buildReviewReferenceAliases(
		session.id,
		reviewArtifacts,
	);
	const reviewArtifactPayloads = reviewArtifacts.map((artifact) => ({
		artifactKind: artifact.artifactKind,
		referenceId: referenceAliases.bySource.get(artifact.sourceMessageId),
	}));
	const questionnaireSessionId =
		typeof toRecord(toRecord(context.contextJson).plan).questionnaire ===
		"object"
			? String(
					toRecord(toRecord(toRecord(context.contextJson).plan).questionnaire)
						.sessionId || "",
				)
			: null;
	const canonical = await resolvePlanArtifactCanonicalInput({
		taskId,
		target: "plan_review",
		questionnaireSessionId: questionnaireSessionId || null,
		sourceSelection: createPlanArtifactSourceSelection({
			policy: "explicit_request",
			featurePlanMessageId: reviewArtifacts.find(
				(artifact) => artifact.artifactKind === "feature_plan",
			)?.sourceMessageId,
			blueprintMessageId: reviewArtifacts.find(
				(artifact) => artifact.artifactKind === "blueprint",
			)?.sourceMessageId,
			dataModelMessageId: reviewArtifacts.find(
				(artifact) => artifact.artifactKind === "data_model",
			)?.sourceMessageId,
			dedicatedViewMessageIds: reviewArtifacts
				.filter(
					(artifact) =>
						!["feature_plan", "blueprint", "data_model"].includes(
							artifact.artifactKind,
						),
				)
				.map((artifact) => artifact.sourceMessageId),
		}),
		regenerationRequest: null,
		expectedState: {
			missionPilotSessionId: session.id,
			contextRevision: session.contextRevision,
			contextDigest: session.contextDigest,
			routingRevision: session.planRoutingRevision,
		},
	});
	const projection = projectPlanArtifactInput(canonical);
	const renderedInput = renderPlanArtifactInput(projection);
	const contract = createStructuredOutputContract({
		name: "mission_pilot_plan_review",
		runtimeSchema: missionPilotPlanReviewSchema,
		providerJsonSchema: buildMissionPilotPlanReviewResponseJsonSchema(),
	});
	const reviewSystemPrompt = buildMissionPilotPlanReviewSystemPrompt(contract);
	const reviewUserPrompt = [
		renderedInput.prompt,
		"",
		"## Review Attempt",
		`Attempt: ${attempt}`,
		"",
		"## Current Routing",
		JSON.stringify(
			{
				entries: currentRouting.entries.map((entry) => ({
					view: entry.view,
					decision: entry.decision,
					capabilityEnabled: entry.capabilityEnabled,
				})),
			},
			null,
			2,
		),
		"",
		"## Review Artifact References",
		JSON.stringify(reviewArtifactPayloads, null, 2),
		"sourceMessageId / sourceId には上記の referenceId を使用してください。実際のmessage IDは表示していません。",
		"この一覧にないArtifactを要求せず、routingToolCallはnullを返してください。",
	].join("\n");
	const llmOptions = {
		taskId,
		role: "mission_pilot" as const,
		executionPolicy: missionPilotArtifactProviderExecutionPolicy,
		usageTrace: missionPilotThoughtTrace({ sessionId }),
		contract,
		promptBudgetMetadata: buildPlanArtifactPromptBudgetMetadata({
			projection,
			systemPrompt: reviewSystemPrompt,
			userPrompt: reviewUserPrompt,
			role: "mission_pilot",
		}),
		timeoutMs: PLAN_ARTIFACT_GENERATION_TIMEOUT_MS,
	};
	const initialResponse = await callStructuredLlmResult(
		reviewSystemPrompt,
		reviewUserPrompt,
		llmOptions,
	);
	const normalizeReview = (review: MissionPilotPlanReview) =>
		normalizeReviewReferences(review, referenceAliases);
	const validateFacts = (review: MissionPilotPlanReview) =>
		validateMissionPilotPlanReviewFacts(review, {
			reviewedArtifacts: reviewArtifacts,
			currentRouting,
		});
	const normalizedInitialResponse: StructuredLlmResult<MissionPilotPlanReview> =
		initialResponse.ok
			? { ...initialResponse, value: normalizeReview(initialResponse.value) }
			: initialResponse;
	const validatedResponse = validateStructuredLlmFacts(
		normalizedInitialResponse,
		(review) => validateFacts(normalizeReview(review)),
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
		validateFacts: (review) => validateFacts(normalizeReview(review)),
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
		review: normalizeReview(repaired.value),
		featurePlanMessageId: featurePlan.sourceMessageId,
		contextRevision: session.contextRevision,
		contextDigest: session.contextDigest,
		routingRevision: session.planRoutingRevision,
	};
}

function collectReviewArtifactsFromContext(
	contextJson: unknown,
	currentRouting: {
		revision: number;
		entries: Array<{
			view: string;
			decision: string;
			capabilityEnabled: boolean;
		}>;
	},
): MissionPilotReviewedArtifact[] {
	const plan = toRecord(toRecord(contextJson).plan);
	const entries = Array.isArray(plan.artifacts)
		? plan.artifacts.filter((entry): entry is Record<string, unknown> =>
				Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
			)
		: [];
	const included = new Set(
		currentRouting.entries
			.filter(
				(entry) => entry.decision === "include" && entry.capabilityEnabled,
			)
			.map((entry) => entry.view),
	);
	included.add("feature_plan");
	const byKind = new Map<string, MissionPilotReviewedArtifact>();
	for (const entry of entries) {
		const sourceMessageId = entry.sourceMessageId;
		if (typeof sourceMessageId !== "string" || !sourceMessageId) continue;
		const metadata = toRecord(entry.metadata);
		const generation = toRecord(metadata.generation);
		const projection = toRecord(generation.inputProjection);
		const routingRevision =
			numberOrNull(projection.routingRevision) ??
			numberOrNull(entry.routingRevision);
		if (routingRevision !== currentRouting.revision) continue;
		const stepKey = String(entry.stepKey || "");
		const candidateKind =
			metadata.intent === "feature_plan"
				? "feature_plan"
				: typeof metadata.view === "string"
					? metadata.view
					: typeof projection.target === "string"
						? projection.target
						: stepKey.startsWith("correction:")
							? stepKey.slice("correction:".length)
							: stepKey.startsWith("view:")
								? stepKey.slice("view:".length)
								: stepKey;
		const parsedKind =
			planModeRegenerationTargetSchema.safeParse(candidateKind);
		if (!parsedKind.success || !included.has(parsedKind.data)) continue;
		byKind.set(parsedKind.data, {
			artifactKind: parsedKind.data,
			sourceMessageId,
		});
	}
	return [...byKind.values()];
}

function numberOrNull(value: unknown) {
	return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function buildReviewReferenceAliases(
	sessionId: string,
	artifacts: MissionPilotReviewedArtifact[],
) {
	const byReference = new Map<string, string>();
	const bySource = new Map<string, string>();
	for (const artifact of artifacts) {
		const digest = crypto
			.createHash("sha256")
			.update(
				`${sessionId}:${artifact.artifactKind}:${artifact.sourceMessageId}`,
			)
			.digest("hex");
		const referenceId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(16, 19)}-${digest.slice(19, 31)}`;
		byReference.set(referenceId, artifact.sourceMessageId);
		bySource.set(artifact.sourceMessageId, referenceId);
	}
	return { byReference, bySource };
}

function normalizeReviewReferences(
	review: MissionPilotPlanReview,
	references: ReturnType<typeof buildReviewReferenceAliases>,
): MissionPilotPlanReview {
	const resolve = (value: string) => references.byReference.get(value) ?? value;
	return {
		...review,
		artifactScores: review.artifactScores.map((score) => ({
			...score,
			sourceMessageId: resolve(score.sourceMessageId),
		})),
		findings: review.findings.map((finding) => ({
			...finding,
			sourceId: resolve(finding.sourceId),
		})),
		revisionTargets: review.revisionTargets.map((target) => ({
			...target,
			sourceMessageId: resolve(target.sourceMessageId),
		})),
		routingToolCall: null,
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
