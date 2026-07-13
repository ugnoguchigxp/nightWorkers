import { z } from "@hono/zod-openapi";
import {
	traceChannelSchema,
	traceOwnerSchema,
} from "../trace-provenance.schema";

const jsonValueSchema = z.unknown();
const dateLikeSchema = z.union([z.string(), z.date()]);

export const taskEventSchema = z
	.object({
		id: z.string().uuid(),
		taskRunId: z.string().uuid(),
		seq: z.number(),
		actor: z.string(),
		eventType: z.string().nullable().optional(),
		type: z.string(),
		message: z.string(),
		payloadJson: jsonValueSchema.nullable().optional(),
		timestamp: dateLikeSchema,
	})
	.openapi("TaskEvent");

export const artifactSchema = z
	.object({
		id: z.string().uuid(),
		runId: z.string().uuid(),
		kind: z.string(),
		path: z.string(),
		metadataJson: jsonValueSchema.nullable().optional(),
		createdAt: dateLikeSchema,
	})
	.openapi("Artifact");

export const activityArtifactSchema = z
	.object({
		id: z.string().uuid(),
		taskId: z.string().uuid(),
		runId: z.string().uuid().nullable().optional(),
		kind: z.string(),
		path: z.string().nullable().optional(),
		contentText: z.string().nullable().optional(),
		metadataJson: jsonValueSchema.nullable().optional(),
		createdAt: dateLikeSchema,
	})
	.openapi("ActivityArtifact");

export const activityEventSchema = z
	.object({
		id: z.string().uuid(),
		taskId: z.string().uuid(),
		runId: z.string().uuid().nullable().optional(),
		turnId: z.string().nullable().optional(),
		parentEventId: z.string().nullable().optional(),
		seq: z.number().int(),
		runSeq: z.number().int().nullable().optional(),
		kind: z.string(),
		source: z.string(),
		status: z.string().nullable().optional(),
		text: z.string().nullable().optional(),
		payloadJson: jsonValueSchema.nullable().optional(),
		artifactId: z.string().uuid().nullable().optional(),
		clientTempId: z.string().nullable().optional(),
		externalId: z.string().nullable().optional(),
		dedupeKey: z.string().nullable().optional(),
		ingestError: z.string().nullable().optional(),
		visibility: z.string(),
		traceOwner: traceOwnerSchema,
		traceChannel: traceChannelSchema,
		createdAt: dateLikeSchema,
	})
	.openapi("ActivityEvent");

export const activityReplaySchema = z
	.object({
		events: z.array(activityEventSchema),
		artifacts: z.array(activityArtifactSchema),
	})
	.openapi("ActivityReplay");

export const backgroundProcessSchema = z
	.object({
		id: z.string().uuid(),
		repositoryId: z.string().uuid(),
		taskId: z.string().uuid().nullable().optional(),
		runId: z.string().uuid().nullable().optional(),
		command: z.string(),
		cwd: z.string(),
		status: z.string(),
		pid: z.number().int().nullable().optional(),
		exitCode: z.number().int().nullable().optional(),
		signal: z.string().nullable().optional(),
		startedAt: dateLikeSchema,
		endedAt: dateLikeSchema.nullable().optional(),
		stopReason: z.string().nullable().optional(),
		latestOutput: z.string(),
		outputArtifactId: z.string().uuid().nullable().optional(),
		metadataJson: jsonValueSchema.nullable().optional(),
		createdAt: dateLikeSchema,
		updatedAt: dateLikeSchema,
	})
	.openapi("BackgroundProcess");

export const startBackgroundProcessRequestSchema = z
	.object({
		command: z.string().min(1),
		cwd: z.string().optional(),
		repositoryId: z.string().uuid().optional(),
		taskId: z.string().uuid().optional(),
		runId: z.string().uuid().optional(),
	})
	.openapi("StartBackgroundProcessRequest");

export const taskMessageSchema = z
	.object({
		id: z.string().uuid(),
		taskId: z.string().uuid(),
		runId: z.string().uuid().nullable().optional(),
		role: z.enum(["user", "assistant", "system", "tool"]),
		content: z.string(),
		messageType: z.string().nullable().optional(),
		metadataJson: jsonValueSchema.nullable().optional(),
		traceOwner: traceOwnerSchema,
		traceChannel: traceChannelSchema,
		createdAt: dateLikeSchema,
	})
	.openapi("TaskMessage");

export const taskLlmUsageSummarySchema = z
	.object({
		taskId: z.string().uuid(),
		promptInputTokens: z.number().int().nonnegative(),
		inputTokens: z.number().int().nonnegative(),
		outputTokens: z.number().int().nonnegative(),
		stateCardTokens: z.number().int().nonnegative(),
		cachedInputTokens: z.number().int().nonnegative(),
		reasoningOutputTokens: z.number().int().nonnegative(),
		totalTokens: z.number().int().nonnegative(),
		totalDurationMs: z.number().int().nonnegative(),
		averageDurationMs: z.number().int().nonnegative().nullable(),
		usageMode: z.enum(["measured", "estimated", "mixed", "unavailable"]),
		callCount: z.number().int().nonnegative(),
		measuredCallCount: z.number().int().nonnegative(),
		estimatedCallCount: z.number().int().nonnegative(),
		lastUpdatedAt: z.string().nullable(),
	})
	.openapi("TaskLlmUsageSummary");
