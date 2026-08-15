import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalStringifySecurityIntelligenceValue } from "../../../shared/security-intelligence-assessment-contract";
import { AppError } from "../../lib/errors";

const executionBase = {
	version: z.literal(1),
	evidenceSubjectSnapshotId: z.string().min(1).max(256),
	identityMappingVersion: z.literal(1),
	providerProjectRef: z.string().min(1).max(256),
	providerWorkspaceTargetGrantRef: z.string().min(1).max(256),
	providerWorkspaceTargetGrantDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	providerWorkspaceStateDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
} as const;

const executionContextSchema = z.discriminatedUnion("stage", [
	z
		.object({
			...executionBase,
			stage: z.literal("grant_created"),
		})
		.strict(),
	z
		.object({
			...executionBase,
			stage: z.literal("previewed"),
			previewRef: z.string().min(1).max(256),
			targetDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
			sourceRevision: z.string().min(1).max(256),
		})
		.strict(),
	z
		.object({
			...executionBase,
			stage: z.literal("started"),
			previewRef: z.string().min(1).max(256),
			targetDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
			sourceRevision: z.string().min(1).max(256),
			scanRunRef: z.string().min(1).max(256),
			scanBindingId: z.string().min(1).max(256),
		})
		.strict(),
]);

export type PostAssessmentExecutionContext = z.infer<
	typeof executionContextSchema
>;

export function postSecurityAssessmentConfiguration(
	env: NodeJS.ProcessEnv = process.env,
) {
	return {
		enabled:
			env.NIGHTWORKERS_SECURITY_INTELLIGENCE_POST_ASSESSMENT_ENABLED ===
				"true" ||
			env.NIGHTWORKERS_SECURITY_INTELLIGENCE_POST_ASSESSMENT_ENABLED === "1",
	};
}

export function derivePostAssessmentRequestDigest(value: unknown) {
	return `sha256:${createHash("sha256")
		.update(canonicalStringifySecurityIntelligenceValue(value))
		.digest("hex")}`;
}

export function derivePostAssessmentIdempotencyUuid(value: string) {
	const hex = value
		.replace(/^sha256:/, "")
		.slice(0, 32)
		.split("");
	hex[12] = "4";
	hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
	const raw = hex.join("");
	return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

export function createPostAssessmentExecutionContext(value: unknown) {
	return executionContextSchema.parse(value);
}

export function assertPostAssessmentCheckpointIdentity(input: {
	context: PostAssessmentExecutionContext | undefined;
	evidenceSubjectSnapshotId: string;
	providerProjectRef: string;
}) {
	if (
		input.context &&
		input.context.evidenceSubjectSnapshotId !== input.evidenceSubjectSnapshotId
	) {
		throw new AppError(
			409,
			"SECURITY_POST_ASSESSMENT_EVIDENCE_SUBJECT_CONFLICT",
			"保存済みcheckpointとEvidence Subject Snapshotが一致しません。",
		);
	}
	if (
		input.context &&
		input.context.providerProjectRef !== input.providerProjectRef
	) {
		throw new AppError(
			409,
			"SECURITY_POST_ASSESSMENT_CHECKPOINT_PROJECT_CONFLICT",
			"保存済みcheckpointとpre assessmentのprovider Projectが一致しません。",
		);
	}
}

export function assertPostAssessmentGrantProject(
	providerProjectRef: string,
	expectedProviderProjectRef: string,
) {
	if (providerProjectRef !== expectedProviderProjectRef) {
		throw new AppError(
			409,
			"SECURITY_POST_ASSESSMENT_GRANT_PROJECT_CONFLICT",
			"workspace grantとpre assessmentのprovider Projectが一致しません。",
		);
	}
}

export function parsePostAssessmentExecutionContext(value: unknown) {
	if (value === null || value === undefined) return undefined;
	const parsed = executionContextSchema.safeParse(value);
	if (!parsed.success) {
		throw new AppError(
			409,
			"SECURITY_POST_ASSESSMENT_CHECKPOINT_INVALID",
			"保存済みpost assessment checkpointが不正です。",
		);
	}
	return parsed.data;
}

export function shouldPropagatePostAssessmentFailure(error: unknown) {
	return (
		error instanceof AppError &&
		(error.statusCode === 409 || error.statusCode === 422) &&
		error.details?.retryable !== true
	);
}

export function classifyPostAssessmentFailure(
	error: unknown,
	stage: PostAssessmentExecutionContext["stage"] | undefined,
) {
	const appError = error instanceof AppError ? error : null;
	const reasonCode = appError?.code ?? "SECURITY_POST_ASSESSMENT_UNAVAILABLE";
	const resetPreStartCheckpoint =
		[
			"SECURITY_INTELLIGENCE_PROVIDER_PREVIEW_EXPIRED",
			"SECURITY_INTELLIGENCE_PROVIDER_PROJECT_NOT_FOUND",
		].includes(reasonCode) && stage !== "started";
	return {
		reasonCode,
		resetPreStartCheckpoint,
		retryable: appError?.details?.retryable === true || resetPreStartCheckpoint,
		propagate:
			!resetPreStartCheckpoint && shouldPropagatePostAssessmentFailure(error),
	};
}
