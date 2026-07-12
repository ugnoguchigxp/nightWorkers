import type { MissionPilotControlSummary } from "../../../../shared/schemas/mission-pilot.schema";
import type { ReviewResult } from "../../review";
import type { TaskEvent } from "./activity";
import type { TaskRunTodo } from "./blueprint";

export type Repository = {
	id: string;
	name: string;
	localPath: string;
	branch: string;
	allowed: boolean;
	queueEnabled: boolean;
	maxConcurrentSessions: number;
	safetyPolicy?: unknown | null;
	createdAt: unknown;
	updatedAt: unknown;
};

export type ProjectSafetyPolicy = {
	allowedPaths?: string[];
	externalAllowedPaths?: string[];
	deniedPaths?: string[];
	blockedCommands?: string[];
	maxCommandSeconds?: number;
	requireReadBeforeEdit?: boolean;
	maxTimeSeconds?: number;
};

export type Task = {
	id: string;
	repositoryId: string;
	title: string;
	description?: string | null;
	objective?: string | null;
	acceptanceCriteria?: string | null;
	worktreePath?: string | null;
	status: string;
	compiledPrompt?: string | null;
	timeoutSeconds: number;
	priority: number;
	createdBy?: string | null;
	createdAt: unknown;
	updatedAt: unknown;
	completedAt?: unknown | null;
	archivedAt?: unknown | null;
	missionPilot: MissionPilotControlSummary;
};

export type TaskRun = {
	id: string;
	taskId: string;
	repositoryId?: string | null;
	status: string;
	workerKind: string;
	timeoutSeconds: number;
	contextSnapshot?: unknown | null;
	summary?: string | null;
	finalReport?: string | null;
	finalJudgment?: unknown | null;
	startedAt: unknown;
	endedAt?: unknown | null;
	finishedAt?: unknown | null;
	logContent?: string | null;
	diffPatch?: string | null;
	testResults?: unknown | null;
	createdAt: unknown;
	updatedAt: unknown;
	events?: TaskEvent[];
	reviews?: ReviewResult[];
	todos?: TaskRunTodo[];
	commitRecord?: {
		status:
			| "not_requested"
			| "pending"
			| "ready"
			| "committed"
			| "needs_human"
			| "failed";
		baselineHead?: string | null;
		preExistingDirtyPathsJson?: string[] | null;
		ownedCandidatePathsJson?: string[] | null;
		stageableOwnedPathsJson?: string[] | null;
		excludedPathsJson?: Array<{ path: string; reason: string }> | null;
		verificationStatus: "not_run" | "passed" | "failed" | "partial";
		commitSha?: string | null;
		commitMessage?: string | null;
		pushStatus?:
			| "not_pushed"
			| "pushing"
			| "pushed"
			| "failed"
			| "blocked"
			| null;
		pushedAt?: string | null;
		pushRemote?: string | null;
		pushBranch?: string | null;
		statusReason?: string | null;
	} | null;
};

export type GitCloseoutState = {
	runId: string;
	repositoryId: string;
	canCommit: boolean;
	canPush: boolean;
	state:
		| "review_required"
		| "commit_ready"
		| "commit_running"
		| "committed"
		| "push_ready"
		| "push_running"
		| "pushed"
		| "needs_human"
		| "failed";
	blockingCode:
		| "RUN_NOT_FOUND"
		| "REPOSITORY_NOT_FOUND"
		| "REVIEW_SESSION_MISSING"
		| "REQUIRED_REVIEW_NOT_DONE"
		| "COMMIT_RECORD_MISSING"
		| "COMMIT_RECORD_NOT_READY"
		| "NO_STAGEABLE_PATHS"
		| "HEAD_MOVED"
		| "DIRTY_PATHS_MISSING"
		| "STAGED_PATHS_OUTSIDE_OWNERSHIP"
		| "COMMIT_ALREADY_CREATED"
		| "UPSTREAM_MISSING"
		| "PUSH_HEAD_MISMATCH"
		| "PUSH_POLICY_BLOCKED"
		| "GIT_COMMAND_FAILED"
		| null;
	blockingReason?: string | null;
	commitRecord: TaskRun["commitRecord"];
	requiredReview: {
		reviewSessionId?: string | null;
		testCoverageStatus?:
			| "not_started"
			| "running"
			| "done"
			| "blocked"
			| "needs_human"
			| null;
		reviewRunStatus?:
			| "not_started"
			| "running"
			| "done"
			| "blocked"
			| "needs_human"
			| null;
		complete: boolean;
	};
	git: {
		head?: string | null;
		branch?: string | null;
		upstream?: string | null;
		dirtyPaths: string[];
		stagedPaths: string[];
	};
	counts: {
		stageablePaths: number;
		excludedPaths: number;
	};
};

export type ImplementationQueueEntryStatus =
	| "queued"
	| "claimed"
	| "processing"
	| "needs_human"
	| "awaiting_commit_decision"
	| "execution_completed"
	| "execution_archived"
	| "failed"
	| "cancelled";

export type ImplementationQueueEntry = {
	id: string;
	taskId: string;
	repositoryId: string;
	status: ImplementationQueueEntryStatus;
	priority: number;
	queuePosition?: number | null;
	processorSlot?: number | null;
	activeRunId?: string | null;
	claimedAt?: unknown | null;
	lastHeartbeatAt?: unknown | null;
	archivedAt?: unknown | null;
	statusReason?: string | null;
	leaseOwnerId?: string | null;
	leaseAcquiredAt?: unknown | null;
	leaseExpiresAt?: unknown | null;
	leaseVersion?: number;
	attemptCount?: number;
	recoveredAt?: unknown | null;
	recoveryReason?: string | null;
	lastFailureKind?: string | null;
	executionType?: "normal" | "exclusive" | "sequence";
	executionLockKey?: string | null;
	sequenceGroupId?: string | null;
	sequenceOrder?: number | null;
	sequenceDependsOnEntryId?: string | null;
	schedulingReason?: string | null;
	createdAt: unknown;
	updatedAt: unknown;
};

export type ImplementationQueueItem = ImplementationQueueEntry & {
	task: Task;
	repository: Repository;
};

export type ImplementationProcessorLane = {
	slot: number;
	entry: ImplementationQueueItem | null;
};

export type ImplementationQueueDashboard = {
	settings: { processorCount: number };
	processors: ImplementationProcessorLane[];
	queued: ImplementationQueueItem[];
	completed: ImplementationQueueItem[];
	notQueued: Array<{ task: Task; repository: Repository }>;
};

export type ImplementationQueueHealthClassification =
	| "normal"
	| "stale_claim"
	| "stale_processing"
	| "terminal_run_pending_completion"
	| "orphaned_active_run"
	| "needs_human"
	| "failed";

export type ImplementationQueueRecoveryAction =
	| "retry"
	| "complete"
	| "mark_needs_human"
	| "archive";

export type ImplementationQueueHealth = {
	generatedAt: unknown;
	counts: {
		queued: number;
		claimed: number;
		processing: number;
		stale: number;
		retryable: number;
		needsHuman: number;
		orphaned: number;
		pendingCompletion: number;
	};
	items: Array<{
		entryId: string;
		taskId: string;
		runId?: string | null;
		status: string;
		classification: ImplementationQueueHealthClassification;
		processorSlot?: number | null;
		leaseOwnerId?: string | null;
		leaseExpiresAt?: unknown | null;
		lastHeartbeatAt?: unknown | null;
		attemptCount: number;
		recoveryReason?: string | null;
		statusReason?: string | null;
		recommendedAction: "none" | ImplementationQueueRecoveryAction;
	}>;
};

export type TodoWorkflowSettings = {
	id: string;
	requirePerTodoReview: boolean;
	requirePerTodoFix: boolean;
	requireFinalVerification: boolean;
	requireRegisterCandidatePrompt: boolean;
	askCommitOnCompletion: boolean;
	hookPolicyJson?: unknown | null;
	createdAt: unknown;
	updatedAt: unknown;
};
