import { z } from "zod";

export const testEvidenceStatusSchema = z.enum([
	"confirmed",
	"not_found",
	"unclear",
	"not_applicable",
]);

export const testEvidenceConfidenceSchema = z.enum(["high", "medium", "low"]);

export const testEvidenceToolEvidenceSchema = z.object({
	kind: z.enum(["test_name", "test_body", "cli", "file_path", "reasoning"]),
	filePath: z.string().optional(),
	testName: z.string().optional(),
	command: z.string().optional(),
	excerpt: z.string().optional(),
	note: z.string(),
});

export const testEvidenceCriterionResultSchema = z.object({
	criterion: z.string(),
	status: testEvidenceStatusSchema,
	confidence: testEvidenceConfidenceSchema,
	evidence: z.array(testEvidenceToolEvidenceSchema),
	improvementPrompt: z.string().optional(),
});

export const testEvidenceReviewResultSchema = z.object({
	version: z.literal(1),
	summary: z.string(),
	criteria: z.array(testEvidenceCriterionResultSchema),
	commandsRun: z.array(
		z.object({
			command: z.string(),
			exitCode: z.number().int().nullable(),
			summary: z.string(),
		}),
	),
});

export type TestEvidenceReviewResult = z.infer<
	typeof testEvidenceReviewResultSchema
>;
export type TestEvidenceCriterionResult = z.infer<
	typeof testEvidenceCriterionResultSchema
>;
export type TestEvidenceToolEvidence = z.infer<
	typeof testEvidenceToolEvidenceSchema
>;
