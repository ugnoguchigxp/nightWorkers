import { z } from "@hono/zod-openapi";
import {
	SECURITY_SCAN_TASK_GENERATION_MAX_FINDINGS,
	securityScanResourceRefSchema,
} from "./security-scan.schema";
import {
	MISSION_TASK_CANDIDATE_MAX_COUNT,
	MISSION_TASK_CANDIDATE_TEXT_LIMITS,
	missionTaskCandidateSchema,
	missionTaskComplexitySchema,
	missionTaskTokenSizeSchema,
	taskGenerationLlmUsageSchema,
} from "./task-generation.schema";

export const generateSecurityScanTaskCandidatesRequestSchema = z
	.object({
		scanRunRef: securityScanResourceRefSchema,
		findingRefs: z
			.array(securityScanResourceRefSchema)
			.min(1)
			.max(SECURITY_SCAN_TASK_GENERATION_MAX_FINDINGS),
	})
	.strict()
	.refine(
		(value) => new Set(value.findingRefs).size === value.findingRefs.length,
		{ message: "findingRefs must be unique", path: ["findingRefs"] },
	);
export type GenerateSecurityScanTaskCandidatesRequest = z.infer<
	typeof generateSecurityScanTaskCandidatesRequestSchema
>;

export const securityScanTaskCandidateDuplicateSchema = z
	.object({
		findingRef: securityScanResourceRefSchema,
		candidateId: z.string().uuid(),
		taskId: z.string().uuid().nullable(),
	})
	.strict();

export const generateSecurityScanTaskCandidatesResponseSchema = z
	.object({
		batchId: z.string().uuid().nullable(),
		status: z.literal("completed"),
		candidates: z.array(missionTaskCandidateSchema),
		duplicates: z.array(securityScanTaskCandidateDuplicateSchema),
		needsHuman: z.array(
			z
				.object({
					findingRef: securityScanResourceRefSchema,
					reason: z.string().min(1).max(360),
				})
				.strict(),
		),
		coverageWarnings: z.array(z.string().min(1).max(512)),
		llmUsage: taskGenerationLlmUsageSchema.nullable().optional(),
	})
	.strict();
export type GenerateSecurityScanTaskCandidatesResponse = z.infer<
	typeof generateSecurityScanTaskCandidatesResponseSchema
>;

export const securityScanTaskCandidatesResultSchema = z
	.object({
		schemaVersion: z.literal("nightworkers.security-task-candidates/v1"),
		candidates: z
			.array(
				z
					.object({
						title: z
							.string()
							.trim()
							.min(1)
							.max(MISSION_TASK_CANDIDATE_TEXT_LIMITS.title),
						candidateKind: z.enum([
							"security_remediation",
							"security_investigation",
						]),
						findingRefs: z
							.array(securityScanResourceRefSchema)
							.min(1)
							.max(SECURITY_SCAN_TASK_GENERATION_MAX_FINDINGS),
						summary: z
							.string()
							.trim()
							.min(1)
							.max(MISSION_TASK_CANDIDATE_TEXT_LIMITS.summary),
						rationale: z
							.string()
							.trim()
							.min(1)
							.max(MISSION_TASK_CANDIDATE_TEXT_LIMITS.rationale),
						moduleRouting: z
							.object({
								primaryModule: z.string().trim().min(1).max(160).nullable(),
								secondaryModules: z
									.array(z.string().trim().min(1).max(160))
									.max(5),
								confidencePercent: z.number().int().min(0).max(100),
								reason: z
									.string()
									.trim()
									.min(1)
									.max(MISSION_TASK_CANDIDATE_TEXT_LIMITS.routingReason)
									.nullable(),
							})
							.strict(),
						planModeOpenQuestions: z
							.array(
								z
									.string()
									.trim()
									.min(1)
									.max(MISSION_TASK_CANDIDATE_TEXT_LIMITS.openQuestion),
							)
							.max(5),
						importancePercent: z.number().int().min(0).max(100),
						confidencePercent: z.number().int().min(0).max(100),
						tokenSize: missionTaskTokenSizeSchema,
						complexity: missionTaskComplexitySchema,
						taskPrompt: z
							.string()
							.trim()
							.min(1)
							.max(MISSION_TASK_CANDIDATE_TEXT_LIMITS.taskPrompt),
						acceptanceCriteria: z
							.string()
							.trim()
							.min(1)
							.max(MISSION_TASK_CANDIDATE_TEXT_LIMITS.acceptanceCriteria),
						verificationPlan: z
							.string()
							.trim()
							.min(1)
							.max(MISSION_TASK_CANDIDATE_TEXT_LIMITS.verificationPlan),
					})
					.strict(),
			)
			.max(MISSION_TASK_CANDIDATE_MAX_COUNT),
		needsHuman: z
			.array(
				z
					.object({
						findingRef: securityScanResourceRefSchema,
						reason: z.string().trim().min(1).max(360),
					})
					.strict(),
			)
			.max(SECURITY_SCAN_TASK_GENERATION_MAX_FINDINGS),
	})
	.strict();
export type SecurityScanTaskCandidatesResult = z.infer<
	typeof securityScanTaskCandidatesResultSchema
>;
