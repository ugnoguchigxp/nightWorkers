import type { ReviewResult } from "../../review";
import type { TaskRunTodo } from "./blueprint";
import type { TaskRun } from "./core";

export type TaskLlmUsageSummary = {
	taskId: string;
	promptInputTokens: number;
	inputTokens: number;
	outputTokens: number;
	stateCardTokens: number;
	cachedInputTokens: number;
	nonCachedInputTokens: number;
	reasoningOutputTokens: number;
	totalTokens: number;
	totalDurationMs: number;
	averageDurationMs: number | null;
	usageMode: "measured" | "estimated" | "mixed" | "unavailable";
	callCount: number;
	measuredCallCount: number;
	estimatedCallCount: number;
	lastUpdatedAt?: unknown | null;
};

export type ActivityArtifact = {
	id: string;
	taskId: string;
	runId?: string | null;
	kind: string;
	path?: string | null;
	contentText?: string | null;
	metadataJson?: unknown;
	createdAt: unknown;
};

export type ActivityEvent = {
	id: string;
	taskId: string;
	runId?: string | null;
	turnId?: string | null;
	parentEventId?: string | null;
	seq: number;
	runSeq?: number | null;
	kind: string;
	source: string;
	status?: string | null;
	text?: string | null;
	payloadJson?: unknown;
	artifactId?: string | null;
	clientTempId?: string | null;
	externalId?: string | null;
	dedupeKey?: string | null;
	ingestError?: string | null;
	visibility: string;
	createdAt: unknown;
};

export type ActivityReplay = {
	events: ActivityEvent[];
	artifacts: ActivityArtifact[];
};

export type BackgroundProcess = {
	id: string;
	repositoryId: string;
	taskId?: string | null;
	runId?: string | null;
	command: string;
	cwd: string;
	status: string;
	pid?: number | null;
	exitCode?: number | null;
	signal?: string | null;
	startedAt: unknown;
	endedAt?: unknown | null;
	stopReason?: string | null;
	latestOutput: string;
	outputArtifactId?: string | null;
	metadataJson?: unknown;
	createdAt: unknown;
	updatedAt: unknown;
};

export type WorkbenchChatIntent =
	| "intake"
	| "draft"
	| "feature_plan"
	| "create_task"
	| "queue"
	| "run_task"
	| "adjust_running"
	| "review_followup"
	| "learning_capture"
	| "design_component"
	| "design_blueprint_data";

export type RunDetails = TaskRun & {
	todos: TaskRunTodo[];
	events: TaskEvent[];
	reviews: ReviewResult[];
};

export type TaskEvent = {
	id: string;
	taskRunId?: string;
	runId?: string;
	seq?: number;
	type?: string;
	actor?: string;
	eventType?: string | null;
	message: string;
	payloadJson?: {
		runEvent?: {
			version: 1;
			id?: string;
			runId: string;
			taskId?: string;
			seq?: number;
			timestamp: string;
			type: string;
			severity: "debug" | "info" | "warning" | "error" | "checkpoint";
			actor:
				| "system"
				| "runtime"
				| "supervisor"
				| "worker"
				| "tool"
				| "verifier"
				| "human";
			message: string;
			data?: Record<string, unknown>;
		};
		legacyPayload?: unknown;
		[key: string]: unknown;
	};
	timestamp?: unknown;
	createdAt?: unknown;
};
