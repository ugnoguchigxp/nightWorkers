import { z } from "@hono/zod-openapi";
import { taskWithMissionPilotSchema } from "../modules/missionPilot";

const dateLikeSchema = z.union([z.string(), z.date()]);
const jsonValueSchema: z.ZodType<unknown> = z.unknown();

export const projectQualityRunTypeSchema = z.enum(["unit", "e2e", "all"]);
export const projectQualityRunStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"failed",
	"cancelled",
]);

export const qualityCapabilitySchema = z.object({
	runnable: z.boolean(),
	missingCapabilities: z.array(z.string()),
	command: z.string().optional(),
});

export const projectQualityCapabilitiesSchema = z.object({
	projectType: z.literal("typescript"),
	unit: qualityCapabilitySchema,
	coverage: qualityCapabilitySchema,
	e2e: qualityCapabilitySchema,
	all: qualityCapabilitySchema,
});
export type ProjectQualityCapabilities = z.infer<
	typeof projectQualityCapabilitiesSchema
>;

export const e2eSummarySchema = z.object({
	status: z.enum(["passed", "failed", "unknown"]),
	total: z.number().int().nonnegative(),
	passed: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
	skipped: z.number().int().nonnegative(),
	durationMs: z.number().int().nonnegative().nullable(),
	suites: z
		.array(
			z.object({
				title: z.string(),
				status: z.enum(["passed", "failed", "unknown"]),
				tests: z.number().int().nonnegative(),
				durationMs: z.number().int().nonnegative().nullable(),
				lastFailure: z.string().nullable(),
			}),
		)
		.default([]),
});
export type E2ESummary = z.infer<typeof e2eSummarySchema>;

export const projectQualityRunSchema = z
	.object({
		id: z.string().uuid(),
		repositoryId: z.string().uuid(),
		runType: projectQualityRunTypeSchema,
		status: projectQualityRunStatusSchema,
		command: z.string(),
		exitCode: z.number().int().nullable(),
		startedAt: dateLikeSchema,
		completedAt: dateLikeSchema.nullable(),
		outputArtifactId: z.string().nullable(),
		latestOutput: z.string().nullable().optional(),
		coverageSummary: jsonValueSchema.nullable(),
		e2eSummary: e2eSummarySchema.nullable(),
		errorMessage: z.string().nullable(),
		createdAt: dateLikeSchema,
		updatedAt: dateLikeSchema,
	})
	.openapi("ProjectQualityRun");
export type ProjectQualityRun = z.infer<typeof projectQualityRunSchema>;

export const projectQualityOverviewSchema = z.object({
	capabilities: projectQualityCapabilitiesSchema,
	latestUnitRun: projectQualityRunSchema.nullable(),
	latestE2eRun: projectQualityRunSchema.nullable(),
	latestCoverageRun: projectQualityRunSchema.nullable(),
	latestE2eResultRun: projectQualityRunSchema.nullable(),
	latestAllRun: projectQualityRunSchema.nullable(),
	recentRuns: z.array(projectQualityRunSchema),
	runningRuns: z.array(projectQualityRunSchema),
});
export type ProjectQualityOverview = z.infer<
	typeof projectQualityOverviewSchema
>;

export const createProjectQualityRunRequestSchema = z.object({
	runType: projectQualityRunTypeSchema,
});

export const createCoverageImprovementTaskRequestSchema = z.object({
	fileKeys: z.array(z.string().min(1)).min(1).max(20),
});
export type CreateCoverageImprovementTaskRequest = z.infer<
	typeof createCoverageImprovementTaskRequestSchema
>;

export const createCoverageImprovementTaskResponseSchema = z.object({
	task: taskWithMissionPilotSchema,
});
export type CreateCoverageImprovementTaskResponse = z.infer<
	typeof createCoverageImprovementTaskResponseSchema
>;

export const coverageFileReportSchema = z.discriminatedUnion("available", [
	z.object({
		available: z.literal(true),
		html: z.string(),
		reason: z.null(),
		generatedAt: z.string(),
	}),
	z.object({
		available: z.literal(false),
		html: z.null(),
		reason: z.enum([
			"not_single_report",
			"report_missing",
			"report_stale",
			"file_report_missing",
		]),
		generatedAt: z.null(),
	}),
]);
export type CoverageFileReport = z.infer<typeof coverageFileReportSchema>;
