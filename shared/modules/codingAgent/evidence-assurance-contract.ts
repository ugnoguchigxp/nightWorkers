import { z } from "@hono/zod-openapi";
import {
	expectedEvidenceSchema,
	verificationKindSchema,
} from "../../schemas/verification-checklist.schema";

export const EVIDENCE_ASSURANCE_POLICY_STRICT_V1 = "strict_v1" as const;
export const EVIDENCE_ASSURANCE_POLICY_LEGACY = "legacy_verify_only" as const;

export const evidenceAssurancePolicyVersionSchema = z.enum([
	EVIDENCE_ASSURANCE_POLICY_STRICT_V1,
	EVIDENCE_ASSURANCE_POLICY_LEGACY,
]);

export const evidenceAssuranceStatusSchema = z.enum([
	"safe_pass",
	"failed",
	"stale",
	"not_run",
	"unmapped",
	"details_missing",
	"manual",
	"not_applicable",
	"legacy",
]);

export const EVIDENCE_ASSURANCE_REASON_CODES = [
	"MAPPED_TEST_NOT_RUN",
	"MAPPED_TEST_FAILED",
	"TEST_EVIDENCE_CAPTURE_FAILED",
	"TEST_IDENTITY_AMBIGUOUS",
	"TEST_EVIDENCE_STALE",
	"VERIFICATION_SCOPE_DENIED",
	"COMMAND_GATE_PLAN_MISSING",
	"CONDITION_MAPPING_MISSING",
	"CONDITION_CASE_EXECUTION_MISSING",
	"CONDITION_CASE_DETAILS_MISSING",
	"CONDITION_CASE_FAILED",
	"CONDITION_CASE_SKIPPED",
	"CONDITION_EVIDENCE_KIND_MISMATCH",
	"CONDITION_EVIDENCE_STALE",
	"CONDITION_SOURCE_MUTATED",
	"CONDITION_COMMAND_SCOPE_MISSING",
	"MANUAL_CONFIRMATION_MISSING",
	"FULL_VERIFY_MISSING",
	"FULL_VERIFY_FAILED",
	"TEST_INVENTORY_MISSING",
	"VERIFICATION_DOCUMENT_CHANGED",
	"EVIDENCE_CONFIRMATION_SOURCE_CHANGED",
	"EVIDENCE_CONFIRMATION_COMMAND_CHANGED",
] as const;

export const evidenceAssuranceReasonCodeSchema = z.enum(
	EVIDENCE_ASSURANCE_REASON_CODES,
);

export const evidenceAssuranceEvidenceRefSchema = z
	.object({
		evidenceRunId: z.string().min(1),
		caseKey: z.string().min(1).optional(),
		evidenceKind: expectedEvidenceSchema,
		sourceStateHash: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict();

export const evidenceAssuranceTestSchema = z
	.object({
		caseKey: z.string().min(1),
		name: z.string().min(1),
		filePath: z.string().nullable(),
		runner: z.string().min(1),
		mappingSource: z.string().min(1),
		execution: z
			.object({
				status: z.enum(["passed", "failed", "skipped", "unknown", "not_run"]),
				evidenceRunId: z.string().nullable(),
				evidenceKind: expectedEvidenceSchema.nullable(),
				durationMs: z.number().nonnegative().nullable(),
				finishedAt: z.string().nullable(),
			})
			.strict(),
		guards: z
			.object({
				currentSource: z.boolean(),
				sourceStableDuringExecution: z.boolean().nullable(),
				testExecutionObserved: z.boolean(),
			})
			.strict(),
	})
	.strict();

export const evidenceAssuranceConditionSchema = z
	.object({
		conditionId: z.string().regex(/^AC-\d{3}$/),
		text: z.string().min(1),
		required: z.boolean(),
		verificationKind: verificationKindSchema,
		expectedEvidence: z.array(expectedEvidenceSchema),
		assuranceStatus: evidenceAssuranceStatusSchema,
		reasonCode: evidenceAssuranceReasonCodeSchema.nullable(),
		evidenceRefs: z.array(evidenceAssuranceEvidenceRefSchema),
		tests: z.array(evidenceAssuranceTestSchema),
	})
	.strict();

export const evidenceAssuranceSnapshotSchema = z
	.object({
		policyVersion: evidenceAssurancePolicyVersionSchema,
		status: z.enum(["passed", "failed", "stale", "legacy"]),
		verificationDocumentDigest: z.string().nullable(),
		receiptDigest: z.string().nullable(),
		conditions: z.array(evidenceAssuranceConditionSchema),
		reasonCodes: z.array(evidenceAssuranceReasonCodeSchema),
	})
	.strict();

export const legacyEvidenceAssuranceSnapshot = {
	policyVersion: EVIDENCE_ASSURANCE_POLICY_LEGACY,
	status: "legacy",
	verificationDocumentDigest: null,
	receiptDigest: null,
	conditions: [],
	reasonCodes: [],
} satisfies z.infer<typeof evidenceAssuranceSnapshotSchema>;

export type EvidenceAssurancePolicyVersion = z.infer<
	typeof evidenceAssurancePolicyVersionSchema
>;
export type EvidenceAssuranceReasonCode = z.infer<
	typeof evidenceAssuranceReasonCodeSchema
>;
export type EvidenceAssuranceCondition = z.infer<
	typeof evidenceAssuranceConditionSchema
>;
export type EvidenceAssuranceSnapshot = z.infer<
	typeof evidenceAssuranceSnapshotSchema
>;
