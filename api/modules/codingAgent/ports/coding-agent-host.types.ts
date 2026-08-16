/**
 * Coding Agent が扱う状態値だけを表す contract 型。
 *
 * Host の DB schema をここから import すると、port が repository row の別名に
 * なってしまうため、role module が必要とする安定した値集合を所有する。
 */
export type CodingAgentTaskStatus =
	| "draft"
	| "ready"
	| "context_compiling"
	| "queued"
	| "running"
	| "finalizing"
	| "verifying"
	| "needs_review"
	| "integration_pending"
	| "completed"
	| "archived"
	| "blocked"
	| "failed"
	| "timed_out"
	| "cancelled"
	| "needs_human";

export type CodingAgentSafetyPolicy = {
	allowedPaths?: string[];
	externalAllowedPaths?: string[];
	deniedPaths?: string[];
	blockedCommands?: string[];
	maxCommandSeconds?: number;
	requireReadBeforeEdit?: boolean;
	maxTimeSeconds?: number;
	trackedSecretFilesAcknowledged?: boolean;
};

export type CodingAgentRunStatus = Extract<
	CodingAgentTaskStatus,
	| "ready"
	| "queued"
	| "running"
	| "context_compiling"
	| "finalizing"
	| "verifying"
	| "completed"
	| "failed"
	| "cancelled"
	| "needs_review"
	| "blocked"
	| "timed_out"
	| "needs_human"
>;

export type CodingAgentTaskSnapshot = {
	id: string;
	repositoryId: string;
	revision: number;
	status: CodingAgentTaskStatus;
	title: string;
	description: string | null;
	objective: string | null;
	acceptanceCriteria: string | null;
	timeoutSeconds: number;
	priority: number;
	worktreePath: string | null;
	currentRevisionSnapshotId: string | null;
	updatedAt: Date;
};

export type CodingAgentRepositorySnapshot = {
	id: string;
	localPath: string;
	branch: string;
	safetyPolicy: CodingAgentSafetyPolicy | null;
	queueEnabled: boolean;
	maxConcurrentSessions: number;
	updatedAt: Date;
};

export type CodingAgentRunSnapshot = {
	id: string;
	taskId: string;
	repositoryId: string | null;
	status: CodingAgentRunStatus;
	todoPlanRevision: number;
	workerKind: string;
	agentModeSessionId: string | null;
	contextSnapshot: unknown;
	summary: string | null;
	finalReport: string | null;
	startedAt: Date;
	updatedAt: Date;
};

export type CodingAgentRunTodoSnapshot = {
	id: string;
	runId: string;
	todoKey: string;
	seq: number;
	revision: number;
	status: string;
	title: string;
	description: string | null;
	objective: string | null;
	taskType: string;
	procedureId: string | null;
	context: string | null;
	nextAction: string;
	acceptanceCriteria: unknown;
	dependsOn: unknown;
	humanBlocker: unknown;
	lastFailure: string | null;
	attemptCount: number;
	statusReason: string | null;
	systemContextVersion: number;
	systemContextSnapshot: unknown;
};

export type CodingAgentVerificationDocumentSnapshot = {
	id: string;
	taskId: string;
	status: string;
	sourceStateHash: string | null;
	updatedAt: Date;
};

export type CodingAgentRunEventInput = {
	version?: 1;
	runId: string;
	taskId?: string;
	type: string;
	severity: "debug" | "info" | "warning" | "error" | "checkpoint";
	actor: "human" | "runtime" | "recovery" | "system" | "supervisor" | "worker";
	message: string;
	data: Record<string, unknown>;
	timestamp: string;
};

export type CodingAgentTaskMessageInput = {
	taskId: string;
	runId: string | null;
	role: "user" | "assistant" | "system";
	content: string;
	messageType: string;
	payloadJson?: Record<string, unknown>;
};

export type CodingAgentRunContextCasInput = {
	runId: string;
	expectedUpdatedAt: Date;
	expectedStatuses: readonly [CodingAgentRunStatus, ...CodingAgentRunStatus[]];
	contextSnapshot: unknown;
};

export type CodingAgentRunContextCasResult =
	| { kind: "applied"; run: CodingAgentRunSnapshot }
	| { kind: "conflict"; current: CodingAgentRunSnapshot }
	| { kind: "not_found" };

export type CodingAgentCompletionCheckSnapshot = {
	ok: boolean;
	reason: string | null;
	suggestedAction: string | null;
	sourceStateHash: string | null;
	verify: { status: "passed" | "failed" | "not_run" | "stale" };
	confirmation: {
		status:
			| "confirmed"
			| "awaiting_confirmation"
			| "awaiting_initial_verify"
			| "settled"
			| "not_required";
	};
};
