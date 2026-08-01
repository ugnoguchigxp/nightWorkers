import { z } from "@hono/zod-openapi";

export const evidenceCheckConditionSchema = z.object({
	id: z.string().min(1),
	text: z.string().min(1),
	status: z.string().min(1),
	required: z.boolean(),
	evidenceIds: z.array(z.string()),
	reason: z.string().nullable(),
	lastCheckedAt: z.string().nullable(),
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
	conditions: z.array(evidenceCheckConditionSchema),
	implementationPlanTraceability:
		evidenceCheckImplementationPlanTraceabilitySchema.nullable(),
	summary: z.object({
		total: z.number().int().nonnegative(),
		confirmed: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		pending: z.number().int().nonnegative(),
	}),
});

export type EvidenceCheckSnapshot = z.infer<typeof evidenceCheckSnapshotSchema>;
