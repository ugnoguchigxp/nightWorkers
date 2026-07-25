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

export const evidenceCheckSnapshotSchema = z.object({
	taskId: z.string().uuid(),
	verificationDocumentId: z.string().uuid(),
	specMessageId: z.string().uuid().nullable(),
	specArtifactId: z.string().nullable(),
	generatedAt: z.string(),
	conditions: z.array(evidenceCheckConditionSchema),
	summary: z.object({
		total: z.number().int().nonnegative(),
		confirmed: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		pending: z.number().int().nonnegative(),
	}),
});

export type EvidenceCheckSnapshot = z.infer<typeof evidenceCheckSnapshotSchema>;
