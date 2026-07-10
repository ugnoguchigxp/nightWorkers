import { z } from "@hono/zod-openapi";

const dateLikeSchema = z.union([z.string(), z.date()]);

export const projectStackTechnologySchema = z.object({
	name: z.string(),
	category: z.enum([
		"language",
		"frontend",
		"backend",
		"runtime",
		"database",
		"orm",
		"testing",
		"desktop",
		"tooling",
	]),
	packageName: z.string().nullable(),
	version: z.string().nullable(),
	source: z.enum(["package_json", "file", "lockfile"]),
	confidence: z.enum(["high", "medium", "low"]),
});
export type ProjectStackTechnology = z.infer<
	typeof projectStackTechnologySchema
>;

export const projectStackProfileSchema = z.object({
	summary: z.string(),
	manifestStatus: z.enum(["found", "missing", "parse_failed"]),
	manifestPath: z.string(),
	packageManager: z.string().nullable(),
	technologies: z.array(projectStackTechnologySchema),
});
export type ProjectStackProfile = z.infer<typeof projectStackProfileSchema>;

export const projectCodeSizeSourceCategorySchema = z.enum([
	"frontend",
	"backend",
	"batch",
	"script",
	"shared",
	"database",
	"desktop",
	"other",
]);
export type ProjectCodeSizeSourceCategory = z.infer<
	typeof projectCodeSizeSourceCategorySchema
>;

export const projectCodeSizeTestKindSchema = z.enum(["unit", "e2e", "other"]);
export type ProjectCodeSizeTestKind = z.infer<
	typeof projectCodeSizeTestKindSchema
>;

export const projectCodeSizeClassificationSourceSchema = z.enum([
	"test_path_rule",
	"explicit_path_rule",
	"ownership_root_rule",
	"manifest_evidence",
	"fallback",
]);
export type ProjectCodeSizeClassificationSource = z.infer<
	typeof projectCodeSizeClassificationSourceSchema
>;

export const projectCodeSizeRootSummarySchema = z.object({
	path: z.string().min(1),
	files: z.number().int().nonnegative(),
	effectiveLines: z.number().int().nonnegative(),
	classificationSource: projectCodeSizeClassificationSourceSchema,
});
export type ProjectCodeSizeRootSummary = z.infer<
	typeof projectCodeSizeRootSummarySchema
>;

export const projectCodeSizeSourceBucketSchema = z.object({
	category: projectCodeSizeSourceCategorySchema,
	files: z.number().int().nonnegative(),
	effectiveLines: z.number().int().nonnegative(),
	roots: z.array(projectCodeSizeRootSummarySchema),
});
export type ProjectCodeSizeSourceBucket = z.infer<
	typeof projectCodeSizeSourceBucketSchema
>;

export const projectCodeSizeTestBucketSchema = z.object({
	kind: projectCodeSizeTestKindSchema,
	files: z.number().int().nonnegative(),
	effectiveLines: z.number().int().nonnegative(),
	roots: z.array(projectCodeSizeRootSummarySchema),
});
export type ProjectCodeSizeTestBucket = z.infer<
	typeof projectCodeSizeTestBucketSchema
>;

export const projectCodeSizeSkipSummarySchema = z.object({
	unsupportedExtension: z.number().int().nonnegative(),
	generatedPath: z.number().int().nonnegative(),
	tooLarge: z.number().int().nonnegative(),
	binary: z.number().int().nonnegative(),
	symlink: z.number().int().nonnegative(),
	missing: z.number().int().nonnegative(),
	unreadable: z.number().int().nonnegative(),
});
export type ProjectCodeSizeSkipSummary = z.infer<
	typeof projectCodeSizeSkipSummarySchema
>;

export const projectCodeSizeSnapshotSchema = z.object({
	id: z.string().uuid(),
	repositoryId: z.string().uuid(),
	schemaVersion: z.literal(1),
	algorithmVersion: z.literal("effective-lines-v1"),
	measuredAt: dateLikeSchema,
	scanDurationMs: z.number().int().nonnegative(),
	inventory: z.object({
		source: z.enum(["git", "filesystem"]),
		listedFiles: z.number().int().nonnegative(),
		skipped: projectCodeSizeSkipSummarySchema,
	}),
	git: z.object({
		status: z.enum(["available", "unavailable"]),
		head: z.string().nullable(),
		shortHead: z.string().nullable(),
		dirty: z.boolean().nullable(),
	}),
	totals: z.object({
		totalFiles: z.number().int().nonnegative(),
		sourceFiles: z.number().int().nonnegative(),
		testFiles: z.number().int().nonnegative(),
		totalEffectiveLines: z.number().int().nonnegative(),
		sourceEffectiveLines: z.number().int().nonnegative(),
		testEffectiveLines: z.number().int().nonnegative(),
	}),
	sourceBuckets: z.array(projectCodeSizeSourceBucketSchema).length(8),
	testBuckets: z.array(projectCodeSizeTestBucketSchema).length(3),
	warnings: z.array(
		z.object({
			code: z.literal("classification_conflict"),
			count: z.number().int().positive(),
		}),
	),
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});
export type ProjectCodeSizeSnapshot = z.infer<
	typeof projectCodeSizeSnapshotSchema
>;

export const projectTechStackOverviewSchema = z.object({
	stackProfile: projectStackProfileSchema,
	codeSizeSnapshot: projectCodeSizeSnapshotSchema.nullable(),
});
export type ProjectTechStackOverview = z.infer<
	typeof projectTechStackOverviewSchema
>;
