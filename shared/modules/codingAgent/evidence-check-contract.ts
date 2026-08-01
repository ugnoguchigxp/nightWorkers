import { z } from "@hono/zod-openapi";
import {
	evidenceAssuranceSnapshotSchema,
	legacyEvidenceAssuranceSnapshot,
} from "./evidence-assurance-contract";

export const evidenceCheckDescriptorSchema = z.object({
	taskId: z.string().uuid(),
	verificationDocumentId: z.string().uuid(),
	specMessageId: z.string().uuid().nullable(),
	specArtifactId: z.string().nullable(),
	generatedAt: z.string(),
});

export const evidenceCheckTestScopeSchema = z.enum([
	"none",
	"unit",
	"e2e_if_ui",
	"unit_and_e2e_if_ui",
	"unspecified",
]);

export const evidenceCheckMappingStatusSchema = z.enum([
	"matched",
	"missing",
	"stale",
	"ambiguous",
	"not_required",
]);

export const evidenceCheckVerifyStatusSchema = z.enum([
	"passed",
	"failed",
	"not_run",
	"stale",
]);

export const evidenceCheckConfirmationStatusSchema = z.enum([
	"awaiting_initial_verify",
	"awaiting_confirmation",
	"confirmed",
	"settled",
]);

export const evidenceCheckMappingMatchSchema = z.object({
	caseKey: z.string().min(1),
	name: z.string().min(1),
	filePath: z.string().nullable(),
	runner: z.string().min(1),
});

export const evidenceCheckMappingItemSchema = z.object({
	id: z.string().min(1),
	text: z.string().min(1),
	required: z.boolean(),
	status: z.enum(["matched", "missing", "ambiguous", "not_required"]),
	matches: z.array(evidenceCheckMappingMatchSchema),
});

export const evidenceCheckReadinessSnapshotSchema = z.object({
	runId: z.string().uuid().nullable(),
	sourceStateHash: z.string().nullable(),
	scope: z.object({
		testScope: evidenceCheckTestScopeSchema,
		e2eAllowed: z.boolean(),
		authorizedVerifyCommand: z
			.object({
				id: z.string().min(1).nullable(),
				command: z.string().min(1),
				cwd: z.string().nullable(),
			})
			.nullable(),
	}),
	mapping: z.object({
		status: evidenceCheckMappingStatusSchema,
		definitionDigest: z.string().nullable(),
		total: z.number().int().nonnegative(),
		matched: z.number().int().nonnegative(),
		items: z.array(evidenceCheckMappingItemSchema),
	}),
	verify: z.object({
		status: evidenceCheckVerifyStatusSchema,
		command: z.string().nullable(),
		cwd: z.string().nullable(),
		exitCode: z.number().int().nullable(),
		sourceStateHash: z.string().nullable(),
		finishedAt: z.string().nullable(),
		logRefs: z.array(z.string()),
	}),
	confirmation: z.object({
		status: evidenceCheckConfirmationStatusSchema,
		initialEvidenceRunId: z.string().min(1).nullable(),
		confirmedAt: z.string().nullable(),
	}),
	assurance: evidenceAssuranceSnapshotSchema.default(
		legacyEvidenceAssuranceSnapshot,
	),
	ready: z.boolean(),
	suggestedAction: z.enum([
		"record_mapping",
		"run_structured_tests",
		"request_human_confirmation",
		"run_verify",
		"fix_verify",
		"confirm_evidence_check",
		"start_new_run",
		"write_final_report",
	]),
	readinessDigest: z.string().min(1),
});

export const evidenceCheckSnapshotSchema = z.object({
	version: z.literal(2),
	taskId: z.string().uuid(),
	verificationDocumentId: z.string().uuid(),
	specMessageId: z.string().uuid().nullable(),
	specArtifactId: z.string().nullable(),
	generatedAt: z.string(),
	evaluatedAt: z.string(),
	...evidenceCheckReadinessSnapshotSchema.shape,
});

export type EvidenceCheckDescriptor = z.infer<
	typeof evidenceCheckDescriptorSchema
>;
export type EvidenceCheckReadinessSnapshot = z.infer<
	typeof evidenceCheckReadinessSnapshotSchema
>;
export type EvidenceCheckSnapshot = z.infer<typeof evidenceCheckSnapshotSchema>;
