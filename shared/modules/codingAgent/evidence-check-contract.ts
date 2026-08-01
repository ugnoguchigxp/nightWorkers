import { z } from "@hono/zod-openapi";

export const evidenceCheckDescriptorSchema = z.object({
	taskId: z.string().uuid(),
	verificationDocumentId: z.string().uuid(),
	specMessageId: z.string().uuid().nullable(),
	specArtifactId: z.string().nullable(),
	generatedAt: z.string(),
});

export const evidenceCheckAssuranceStatusSchema = z.enum([
	"safe_pass",
	"failed",
	"stale",
	"not_run",
	"unmapped",
	"details_missing",
	"manual",
	"not_applicable",
	"pending",
]);

export const evidenceCheckTestSchema = z.object({
	caseKey: z.string().min(1),
	name: z.string().min(1),
	filePath: z.string().nullable(),
	runner: z.string().min(1),
	mappingSource: z.string().min(1),
	execution: z.object({
		status: z.enum(["passed", "failed", "skipped", "unknown", "not_run"]),
		evidenceRunId: z.string().nullable(),
		evidenceKind: z.string().nullable().optional(),
		durationMs: z.number().nonnegative().nullable(),
		finishedAt: z.string().nullable(),
	}),
	guards: z.object({
		currentSource: z.boolean(),
		sourceStableDuringExecution: z.boolean().nullable(),
		testExecutionObserved: z.boolean(),
		fullVerifyPassed: z.boolean(),
	}),
});

export const evidenceCheckConditionSchema = z.object({
	id: z.string().min(1),
	text: z.string().min(1),
	status: z.string().min(1),
	required: z.boolean(),
	verificationKind: z.string().nullable(),
	expectedEvidence: z.array(z.string()),
	evidenceIds: z.array(z.string()),
	reason: z.string().nullable(),
	lastCheckedAt: z.string().nullable(),
	assuranceStatus: evidenceCheckAssuranceStatusSchema,
	assuranceReason: z.string().nullable(),
	tests: z.array(evidenceCheckTestSchema),
});

export const evidenceCheckImplementationPlanStepSchema = z.object({
	seq: z.number().int().positive(),
	title: z.string().min(1),
	systemContext: z.string().min(1),
	todoId: z.string().uuid().nullable(),
	todoStatus: z.string().min(1).nullable(),
	aligned: z.boolean(),
	evidenceIds: z.array(z.string()),
	completionGateRecorded: z.boolean(),
});

export const evidenceCheckImplementationPlanTraceabilitySchema = z.object({
	sourceMessageId: z.string().uuid(),
	digest: z.string().min(1),
	runId: z.string().uuid().nullable(),
	runStatus: z.string().min(1).nullable(),
	provenanceStatus: z.enum([
		"matched",
		"legacy_inferred",
		"todo_mismatch",
		"provenance_mismatch",
		"missing",
	]),
	exactTodoMatch: z.boolean(),
	steps: z.array(evidenceCheckImplementationPlanStepSchema),
	summary: z.object({
		total: z.number().int().nonnegative(),
		passed: z.number().int().nonnegative(),
		incomplete: z.number().int().nonnegative(),
		unaligned: z.number().int().nonnegative(),
		extraTodos: z.number().int().nonnegative(),
		evidenceLinked: z.number().int().nonnegative(),
	}),
});

export const evidenceCheckSnapshotSchema = z.object({
	taskId: z.string().uuid(),
	verificationDocumentId: z.string().uuid(),
	specMessageId: z.string().uuid().nullable(),
	specArtifactId: z.string().nullable(),
	generatedAt: z.string(),
	evaluatedAt: z.string(),
	sourceStateHash: z.string().nullable(),
	conditions: z.array(evidenceCheckConditionSchema),
	implementationPlanTraceability:
		evidenceCheckImplementationPlanTraceabilitySchema.nullable(),
	summary: z.object({
		total: z.number().int().nonnegative(),
		confirmed: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		pending: z.number().int().nonnegative(),
	}),
	assuranceSummary: z.object({
		automated: z.number().int().nonnegative(),
		safePass: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		attention: z.number().int().nonnegative(),
		required: z.number().int().nonnegative().optional(),
		requiredSafePass: z.number().int().nonnegative().optional(),
		unmapped: z.number().int().nonnegative().optional(),
		detailsMissing: z.number().int().nonnegative().optional(),
		stale: z.number().int().nonnegative().optional(),
		fullVerifyStatus: z.enum(["passed", "failed", "unknown"]),
	}),
});

export type EvidenceCheckDescriptor = z.infer<
	typeof evidenceCheckDescriptorSchema
>;
export type EvidenceCheckSnapshot = z.infer<typeof evidenceCheckSnapshotSchema>;
