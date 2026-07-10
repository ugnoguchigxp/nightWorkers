import { z } from "@hono/zod-openapi";
import {
	projectCodeSizeSnapshotSchema,
	projectStackProfileSchema,
} from "./tech-stack.schema";

export type {
	ProjectCodeSizeSnapshot,
	ProjectStackProfile,
	ProjectStackTechnology,
} from "./tech-stack.schema";
export {
	projectCodeSizeSnapshotSchema,
	projectStackProfileSchema,
	projectStackTechnologySchema,
} from "./tech-stack.schema";
export const projectFileScaleSchema = z.enum([
	"huge",
	"large",
	"medium",
	"small",
	"tiny",
]);
export type ProjectFileScale = z.infer<typeof projectFileScaleSchema>;

export const projectMetaSchema = z.object({
	version: z.literal(1),
	scannedAt: z.string(),
	scanDurationMs: z.number(),
	git: z.object({
		head: z.string().nullable(),
		shortHead: z.string().nullable(),
		displayHead: z.string().nullable(),
		committedAt: z.string().nullable(),
		status: z.enum(["available", "unavailable"]),
	}),
	files: z.object({
		total: z.number(),
		source: z.number(),
		tests: z.number(),
		sourceLoc: z.number(),
	}),
	ontology: z.object({
		moduleCount: z.number(),
		available: z.boolean(),
	}),
	fileScale: z.object({
		value: projectFileScaleSchema,
		score: z.number(),
	}),
});
export type ProjectMeta = z.infer<typeof projectMetaSchema>;

export const projectDetailMetricsSchema = z.object({
	stackProfile: projectStackProfileSchema,
	codeSizeSnapshot: projectCodeSizeSnapshotSchema.nullable(),
	projectMeta: projectMetaSchema.nullable(),
});
export type ProjectDetailMetrics = z.infer<typeof projectDetailMetricsSchema>;
