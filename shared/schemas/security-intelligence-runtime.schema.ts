import { z } from "zod";
import {
	type NightworkersSecurityIntelligenceBundle,
	nightworkersSecurityIntelligenceBundleSchema,
} from "./nightworkers-security-intelligence.schema";
import {
	boundedRefArraySchema,
	digestValue,
	ensureCanonicalBytes,
	rawSha256Schema,
	safeRefSchema,
	safeTextSchema,
	sha256Schema,
	timestampSchema,
} from "./security-intelligence-runtime-primitives";
import {
	securityScanSelectionSchema,
	securityScanTargetSchema,
} from "./security-scan.schema";

export * from "./security-intelligence-workspace-grant.schema";

export const providerScanBindingV2Schema = z
	.object({
		version: z.literal(2),
		bindingRef: z.string().regex(/^sisbr:v2:[a-f0-9]{64}$/),
		repositoryId: safeRefSchema,
		provider: z.literal("vulnworkbench"),
		identityMappingVersion: z.literal(1),
		providerProjectRef: safeRefSchema,
		scanRunRef: safeRefSchema,
		selection: securityScanSelectionSchema,
		requestedTarget: securityScanTargetSchema,
		resolvedTarget: z.discriminatedUnion("kind", [
			z
				.object({
					kind: z.literal("working_tree"),
					sourceRevisionRole: z.literal("base_revision"),
					sourceRevision: safeTextSchema(128).nullable(),
					targetDigest: rawSha256Schema,
				})
				.strict(),
			z
				.object({
					kind: z.literal("full"),
					sourceRevisionRole: z.literal("snapshot_revision"),
					sourceRevision: safeTextSchema(128).nullable(),
					targetDigest: rawSha256Schema,
				})
				.strict(),
		]),
		bindingDigest: sha256Schema,
		createdAt: timestampSchema,
	})
	.strict();
export type ProviderScanBindingV2 = z.infer<typeof providerScanBindingV2Schema>;

export function deriveProviderScanBindingV2(
	input: Omit<ProviderScanBindingV2, "bindingRef" | "bindingDigest">,
): ProviderScanBindingV2 {
	const { createdAt: _createdAt, ...semantic } = input;
	const bindingDigest = digestValue(semantic);
	return providerScanBindingV2Schema.parse({
		...input,
		bindingRef: `sisbr:v2:${bindingDigest.slice("sha256:".length)}`,
		bindingDigest,
	});
}

export const securityAssessmentReceiptV1Schema = z
	.object({
		version: z.literal(1),
		receiptRef: z.string().regex(/^siar:v1:[a-f0-9]{64}$/),
		repositoryId: safeRefSchema,
		scanBindingRef: z.string().regex(/^sisbr:v2:[a-f0-9]{64}$/),
		providerBindingProofRef: z.string().regex(/^sibp:v1:[a-f0-9]{64}$/),
		providerBindingProofDigest: sha256Schema,
		providerProjectRef: safeRefSchema,
		scanRunRef: safeRefSchema,
		canonicalProjectRef: z.string().regex(/^project:[A-Za-z0-9._:-]{1,247}$/),
		canonicalScanRunRef: z.string().regex(/^scan-run:[A-Za-z0-9._:-]{1,247}$/),
		normalizedTarget: z
			.object({
				kind: z.enum(["diff", "snapshot", "commit"]),
				sourceRevision: safeTextSchema(128),
				baseRevision: safeTextSchema(128).optional(),
				targetDigest: sha256Schema,
			})
			.strict(),
		producerContractVersion: z.literal(1),
		bundleRef: z.string().regex(/^sib:v1:[a-f0-9]{64}$/),
		assessmentRefs: z.array(safeRefSchema).min(1).max(2),
		payloadDigest: sha256Schema,
		payload: nightworkersSecurityIntelligenceBundleSchema,
		receivedAt: timestampSchema,
	})
	.strict();
export type SecurityAssessmentReceiptV1 = z.infer<
	typeof securityAssessmentReceiptV1Schema
>;

export function deriveSecurityAssessmentReceiptV1(input: {
	repositoryId: string;
	scanBindingRef: string;
	providerBindingProofRef: string;
	providerBindingProofDigest: string;
	providerProjectRef: string;
	scanRunRef: string;
	canonicalProjectRef: string;
	canonicalScanRunRef: string;
	normalizedTarget: SecurityAssessmentReceiptV1["normalizedTarget"];
	payload: NightworkersSecurityIntelligenceBundle;
	receivedAt: string;
}): SecurityAssessmentReceiptV1 {
	ensureCanonicalBytes(
		input.payload,
		2 * 1024 * 1024,
		"security_intelligence:assessment_payload_too_large",
	);
	const payloadDigest = digestValue(input.payload);
	const assessmentRefs = [
		input.payload.dependencyAssessment.assessmentRef,
		...(input.payload.authorizationShadow.status === "available"
			? [input.payload.authorizationShadow.assessment.assessmentRef]
			: []),
	];
	return securityAssessmentReceiptV1Schema.parse({
		version: 1,
		receiptRef: `siar:v1:${payloadDigest.slice("sha256:".length)}`,
		repositoryId: input.repositoryId,
		scanBindingRef: input.scanBindingRef,
		providerBindingProofRef: input.providerBindingProofRef,
		providerBindingProofDigest: input.providerBindingProofDigest,
		providerProjectRef: input.providerProjectRef,
		scanRunRef: input.scanRunRef,
		canonicalProjectRef: input.canonicalProjectRef,
		canonicalScanRunRef: input.canonicalScanRunRef,
		normalizedTarget: input.normalizedTarget,
		producerContractVersion: 1,
		bundleRef: input.payload.bundleRef,
		assessmentRefs,
		payloadDigest,
		payload: input.payload,
		receivedAt: input.receivedAt,
	});
}

const preSubjectBindingSchema = z
	.object({
		version: z.literal(1),
		bindingRef: z.string().regex(/^siasb:v1:[a-f0-9]{64}$/),
		phase: z.literal("pre_implementation"),
		assessmentReceiptRef: z.string().regex(/^siar:v1:[a-f0-9]{64}$/),
		taskId: safeRefSchema,
		taskRevisionSnapshotId: safeRefSchema,
		taskRevision: z.number().int().positive(),
		taskDigest: safeTextSchema(256),
		repositoryIdentityRevision: z.number().int().nonnegative(),
		repositoryBaseWorktreeId: safeRefSchema,
		expectedBaseHeadSha: safeTextSchema(128),
		bindingDigest: sha256Schema,
		createdAt: timestampSchema,
	})
	.strict();

const postSubjectBindingSchema = z
	.object({
		version: z.literal(1),
		bindingRef: z.string().regex(/^siasb:v1:[a-f0-9]{64}$/),
		phase: z.literal("post_implementation"),
		assessmentReceiptRef: z.string().regex(/^siar:v1:[a-f0-9]{64}$/),
		taskId: safeRefSchema,
		taskRevisionSnapshotId: safeRefSchema,
		taskRevision: z.number().int().positive(),
		taskDigest: safeTextSchema(256),
		implementationRunId: safeRefSchema,
		evidenceSubjectSnapshotId: safeRefSchema,
		providerWorkspaceTargetGrantRef: z.string().regex(/^siwg:v1:[a-f0-9]{64}$/),
		providerWorkspaceTargetGrantDigest: sha256Schema,
		providerWorkspaceStateDigest: sha256Schema,
		workspaceId: safeRefSchema,
		workspaceAllocationVersion: z.number().int().nonnegative(),
		admittedHeadSha: safeTextSchema(128),
		sourceStateHash: safeTextSchema(256),
		diffDigest: safeTextSchema(256),
		bindingDigest: sha256Schema,
		createdAt: timestampSchema,
	})
	.strict();

export const securityAssessmentSubjectBindingV1Schema = z.discriminatedUnion(
	"phase",
	[preSubjectBindingSchema, postSubjectBindingSchema],
);
export type SecurityAssessmentSubjectBindingV1 = z.infer<
	typeof securityAssessmentSubjectBindingV1Schema
>;

type SubjectBindingWithoutIdentity<T> = T extends unknown
	? Omit<T, "bindingRef" | "bindingDigest">
	: never;

export function deriveSecurityAssessmentSubjectBindingV1(
	input: SubjectBindingWithoutIdentity<SecurityAssessmentSubjectBindingV1>,
): SecurityAssessmentSubjectBindingV1 {
	const { createdAt: _createdAt, ...semantic } = input;
	const bindingDigest = digestValue(semantic);
	return securityAssessmentSubjectBindingV1Schema.parse({
		...input,
		bindingRef: `siasb:v1:${bindingDigest.slice("sha256:".length)}`,
		bindingDigest,
	});
}

const assetSchema = z
	.object({ kind: safeTextSchema(64), ref: safeRefSchema })
	.strict();
const unknownSchema = z
	.object({ source: safeRefSchema, reasonCode: safeRefSchema })
	.strict();

export const securityContractV1Schema = z
	.object({
		version: z.literal(1),
		contractRef: z.string().regex(/^sic:v1:[a-f0-9]{64}$/),
		contractRevision: z.number().int().positive(),
		taskId: safeRefSchema,
		taskRevisionSnapshotId: safeRefSchema,
		taskRevision: z.number().int().positive(),
		taskDigest: safeTextSchema(256),
		repositoryId: safeRefSchema,
		projectRef: z.string().regex(/^project:[A-Za-z0-9._:-]{1,247}$/),
		sourceState: z
			.object({
				phase: z.literal("pre_implementation"),
				assessmentSubjectBindingRef: z
					.string()
					.regex(/^siasb:v1:[a-f0-9]{64}$/),
				revisionRole: z.literal("assessed_revision"),
				revision: safeTextSchema(128),
				targetDigest: sha256Schema,
			})
			.strict(),
		affectedAssets: z.array(assetSchema).max(1_000),
		declaredInvariantRefs: boundedRefArraySchema,
		knowledgeRefs: boundedRefArraySchema,
		assessmentSubjectBindingRefs: z
			.array(z.string().regex(/^siasb:v1:[a-f0-9]{64}$/))
			.max(1_000),
		requiredBaselineVerificationRefs: boundedRefArraySchema,
		targetedVerificationCandidateRefs: boundedRefArraySchema,
		nonGoals: z.array(safeTextSchema(1_024)).max(1_000),
		approvedBounds: z
			.object({
				policyRefs: boundedRefArraySchema,
				budgetRefs: boundedRefArraySchema,
			})
			.strict(),
		unknowns: z.array(unknownSchema).max(200),
		supersedesContractRef: z
			.string()
			.regex(/^sic:v1:[a-f0-9]{64}$/)
			.optional(),
		contractDigest: sha256Schema,
		createdAt: timestampSchema,
		authorPrincipalRef: safeRefSchema,
	})
	.strict();
export type SecurityContractV1 = z.infer<typeof securityContractV1Schema>;

export const securityContractSemanticSchema = securityContractV1Schema.omit({
	version: true,
	contractRef: true,
	contractRevision: true,
	taskId: true,
	taskRevisionSnapshotId: true,
	taskRevision: true,
	taskDigest: true,
	repositoryId: true,
	supersedesContractRef: true,
	contractDigest: true,
	createdAt: true,
	authorPrincipalRef: true,
});

export const writeSecurityContractCommandSchema = z
	.object({
		version: z.literal(1),
		taskId: safeRefSchema,
		taskRevisionSnapshotId: safeRefSchema,
		expectedCurrentContractRef: z
			.string()
			.regex(/^sic:v1:[a-f0-9]{64}$/)
			.nullable(),
		expectedHeadRevision: z.number().int().nonnegative(),
		semantic: securityContractSemanticSchema,
	})
	.strict();

export function deriveSecurityContractV1(
	input: Omit<SecurityContractV1, "contractRef" | "contractDigest">,
): SecurityContractV1 {
	const {
		createdAt: _createdAt,
		authorPrincipalRef: _authorPrincipalRef,
		...semantic
	} = input;
	ensureCanonicalBytes(
		semantic,
		128 * 1024,
		"security_intelligence:security_contract_too_large",
	);
	const contractDigest = digestValue(semantic);
	return securityContractV1Schema.parse({
		...input,
		contractRef: `sic:v1:${contractDigest.slice("sha256:".length)}`,
		contractDigest,
	});
}

const completionConditionSourceSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("feature_plan"),
			artifactRef: safeRefSchema,
			artifactDigest: sha256Schema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("project_policy"),
			policyRef: safeRefSchema,
			policyRevision: z.number().int().nonnegative(),
			artifactDigest: sha256Schema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("direct_user_instruction"),
			messageRef: safeRefSchema,
			artifactDigest: sha256Schema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("coding_agent_todo"),
			runId: safeRefSchema,
			todoKey: safeRefSchema,
			todoRevision: z.number().int().positive(),
			todoPlanRevision: z.number().int().nonnegative(),
			artifactDigest: sha256Schema,
		})
		.strict(),
]);

export const adoptedCompletionConditionSchema = z
	.object({
		conditionRef: z.string().regex(/^sicc:v1:[a-f0-9]{64}$/),
		taskId: safeRefSchema,
		taskRevisionSnapshotId: safeRefSchema,
		taskRevision: z.number().int().positive(),
		taskDigest: safeTextSchema(256),
		conditionRevision: z.number().int().positive(),
		conditionKey: safeRefSchema,
		state: z.enum(["adopted", "revoked"]),
		source: completionConditionSourceSchema,
		subjectRef: safeRefSchema,
		supersedesConditionRef: z
			.string()
			.regex(/^sicc:v1:[a-f0-9]{64}$/)
			.optional(),
		conditionDigest: sha256Schema,
		recordedAt: timestampSchema,
		authorPrincipalRef: safeRefSchema,
	})
	.strict();
export type AdoptedCompletionCondition = z.infer<
	typeof adoptedCompletionConditionSchema
>;

export const completionConditionSemanticSchema =
	adoptedCompletionConditionSchema.omit({
		conditionRef: true,
		taskId: true,
		taskRevisionSnapshotId: true,
		taskRevision: true,
		taskDigest: true,
		conditionRevision: true,
		supersedesConditionRef: true,
		conditionDigest: true,
		recordedAt: true,
		authorPrincipalRef: true,
	});

export const writeCompletionConditionCommandSchema = z
	.object({
		version: z.literal(1),
		taskId: safeRefSchema,
		taskRevisionSnapshotId: safeRefSchema,
		expectedCurrentConditionRef: z
			.string()
			.regex(/^sicc:v1:[a-f0-9]{64}$/)
			.nullable(),
		expectedHeadRevision: z.number().int().nonnegative(),
		semantic: completionConditionSemanticSchema,
	})
	.strict();

export function deriveAdoptedCompletionCondition(
	input: Omit<AdoptedCompletionCondition, "conditionRef" | "conditionDigest">,
): AdoptedCompletionCondition {
	const {
		recordedAt: _recordedAt,
		authorPrincipalRef: _authorPrincipalRef,
		...semantic
	} = input;
	const conditionDigest = digestValue(semantic);
	return adoptedCompletionConditionSchema.parse({
		...input,
		conditionRef: `sicc:v1:${conditionDigest.slice("sha256:".length)}`,
		conditionDigest,
	});
}

export const securityFinalJudgmentV1Schema = z
	.object({
		version: z.literal(1),
		runId: safeRefSchema,
		taskRevisionSnapshotId: safeRefSchema,
		securityContractRef: z.string().regex(/^sic:v1:[a-f0-9]{64}$/),
		securityContractDigest: sha256Schema,
		assessmentAttemptRefs: z.array(safeRefSchema).max(1_000),
		assessmentSubjectBindingRefs: z
			.array(z.string().regex(/^siasb:v1:[a-f0-9]{64}$/))
			.max(1_000),
		conditionEvaluations: z
			.array(
				z
					.object({
						conditionRef: z.string().regex(/^sicc:v1:[a-f0-9]{64}$/),
						result: z.enum([
							"satisfied",
							"not_satisfied",
							"needs_human",
							"blocked",
							"not_applicable",
							"unavailable",
						]),
						evidenceRefs: boundedRefArraySchema,
						limitationCodes: z.array(safeRefSchema).max(200),
						rationale: safeTextSchema(4_096),
					})
					.strict(),
			)
			.max(100)
			.superRefine((values, ctx) => {
				if (
					values.some(
						(value, index) =>
							index > 0 &&
							(values[index - 1]?.conditionRef ?? "") >= value.conditionRef,
					)
				) {
					ctx.addIssue({
						code: "custom",
						message:
							"security_intelligence:condition_evaluations_must_be_unique_and_sorted",
					});
				}
			}),
		residualRisk: z
			.object({
				level: z.enum(["low", "medium", "high", "unknown"]),
				rationale: safeTextSchema(4_096),
			})
			.strict(),
		judgmentDigest: sha256Schema,
		createdAt: timestampSchema,
	})
	.strict();
export type SecurityFinalJudgmentV1 = z.infer<
	typeof securityFinalJudgmentV1Schema
>;

export function deriveSecurityFinalJudgmentV1(
	input: Omit<SecurityFinalJudgmentV1, "judgmentDigest">,
): SecurityFinalJudgmentV1 {
	const { createdAt: _createdAt, ...semantic } = input;
	ensureCanonicalBytes(
		semantic,
		128 * 1024,
		"security_intelligence:final_judgment_too_large",
	);
	return securityFinalJudgmentV1Schema.parse({
		...input,
		judgmentDigest: digestValue(semantic),
	});
}

export const submitSecurityFinalJudgmentCommandV1Schema = z
	.object({
		version: z.literal(1),
		runId: safeRefSchema,
		expectedRunStatus: z.enum(["running", "finalizing", "verifying"]),
		expectedTaskRevisionSnapshotId: safeRefSchema,
		expectedSecurityContractRef: z.string().regex(/^sic:v1:[a-f0-9]{64}$/),
		expectedConditionRefs: z
			.array(z.string().regex(/^sicc:v1:[a-f0-9]{64}$/))
			.max(100)
			.superRefine((values, ctx) => {
				if (
					values.some(
						(value, index) => index > 0 && (values[index - 1] ?? "") >= value,
					)
				) {
					ctx.addIssue({
						code: "custom",
						message:
							"security_intelligence:expected_condition_refs_must_be_unique_and_sorted",
					});
				}
			}),
		judgment: securityFinalJudgmentV1Schema,
	})
	.strict();

export const submitSecurityFinalJudgmentToolInputSchema =
	submitSecurityFinalJudgmentCommandV1Schema
		.omit({ judgment: true })
		.extend({
			judgment: securityFinalJudgmentV1Schema
				.omit({ judgmentDigest: true, createdAt: true })
				.strict(),
		})
		.strict();

export const securityAssessmentAttemptResultSchema = z.discriminatedUnion(
	"status",
	[
		z
			.object({
				status: z.literal("completed"),
				assessmentAttemptRef: safeRefSchema,
				assessmentSubjectBindingRef: z
					.string()
					.regex(/^siasb:v1:[a-f0-9]{64}$/),
			})
			.strict(),
		z
			.object({
				status: z.literal("not_applicable"),
				assessmentAttemptRef: safeRefSchema,
				reasonCode: safeRefSchema,
			})
			.strict(),
		z
			.object({
				status: z.literal("unavailable"),
				assessmentAttemptRef: safeRefSchema,
				reasonCode: safeRefSchema,
				retryable: z.boolean(),
			})
			.strict(),
	],
);
