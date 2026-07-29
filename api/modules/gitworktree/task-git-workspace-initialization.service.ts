import { randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors";
import * as workspaceRepo from "./task-git-workspace.repository";
import {
	runWorkspaceDependencyBootstrap,
	WorkspaceBootstrapError,
} from "./workspace-bootstrap";

const MAX_INITIALIZATION_ATTEMPTS = 3;
const INITIALIZATION_LEASE_TTL_MS = 2 * 60 * 1_000;
const INITIALIZATION_LEASE_HEARTBEAT_MS = 30 * 1_000;

type TaskGitWorkspace = NonNullable<
	Awaited<ReturnType<typeof workspaceRepo.getTaskGitWorkspace>>
>;

export function canRetryTaskGitWorkspaceInitialization(
	workspace: TaskGitWorkspace,
) {
	return (
		workspace.status === "initialization_failed" &&
		Boolean(workspace.worktreePath) &&
		workspace.initializationAttempt < MAX_INITIALIZATION_ATTEMPTS &&
		isInitializationFailureRetryable(workspace.bootstrapEvidenceJson)
	);
}

export async function initializeTaskGitWorkspace(
	initialWorkspace: TaskGitWorkspace,
	options: { signal?: AbortSignal; timeoutMs?: number },
) {
	let workspace = initialWorkspace;
	if (["ready", "active"].includes(workspace.status)) return workspace;
	if (workspace.status === "initialization_failed") {
		assertInitializationRetryable(workspace);
		const resumed = await workspaceRepo.transitionTaskGitWorkspace({
			id: workspace.id,
			expectedStatus: "initialization_failed",
			data: {
				status: "initializing",
				leaseOwner: null,
				leaseExpiresAt: null,
				lastErrorCode: null,
				lastErrorMessage: null,
			},
		});
		if (resumed) workspace = resumed;
	}
	if (workspace.status !== "initializing" || !workspace.worktreePath) {
		throw new AppError(
			409,
			"workspace_not_initializable",
			"Workspace dependency environment cannot be initialized.",
		);
	}
	const worktreePath = workspace.worktreePath;
	const leaseOwner = randomUUID();
	const attempting = await workspaceRepo.claimTaskGitWorkspaceInitialization({
		id: workspace.id,
		leaseOwner,
		leaseExpiresAt: initializationLeaseExpiry(),
		maxAttempts: MAX_INITIALIZATION_ATTEMPTS,
	});
	if (!attempting) return resolveLostInitializationClaim(workspace.id);
	workspace = attempting;
	const initializationController = new AbortController();
	const abortFromCaller = () => initializationController.abort();
	if (options.signal?.aborted) abortFromCaller();
	else
		options.signal?.addEventListener("abort", abortFromCaller, { once: true });
	const heartbeat = startInitializationHeartbeat(
		workspace.id,
		leaseOwner,
		initializationController,
	);
	try {
		const evidence = await runWorkspaceDependencyBootstrap({
			workspaceId: workspace.id,
			workspaceRoot: worktreePath,
			previousEvidence: workspace.bootstrapEvidenceJson,
			signal: initializationController.signal,
			timeoutMs: options.timeoutMs,
		});
		const ready =
			await workspaceRepo.transitionClaimedTaskGitWorkspaceInitialization({
				id: workspace.id,
				leaseOwner,
				data: {
					status: "ready",
					bootstrapEvidenceJson: {
						...toRecord(workspace.bootstrapEvidenceJson),
						dependencyBootstrap: evidence,
					},
					initializedAt: new Date(),
					lastErrorCode: null,
					lastErrorMessage: null,
				},
			});
		if (ready) return ready;
		const concurrent = await workspaceRepo.getTaskGitWorkspaceById(
			workspace.id,
		);
		if (concurrent && ["ready", "active"].includes(concurrent.status)) {
			return concurrent;
		}
		throw new AppError(
			409,
			"workspace_initialization_transition_lost",
			"Workspace initialization changed concurrently.",
		);
	} catch (error) {
		await persistInitializationFailure(workspace, leaseOwner, error);
		throw mapInitializationError(error);
	} finally {
		clearInterval(heartbeat);
		options.signal?.removeEventListener("abort", abortFromCaller);
	}
}

function assertInitializationRetryable(workspace: TaskGitWorkspace) {
	if (!isInitializationFailureRetryable(workspace.bootstrapEvidenceJson)) {
		const failure = readInitializationFailure(workspace.bootstrapEvidenceJson);
		throw new AppError(
			422,
			"workspace_dependency_initialization_failed",
			"Workspace dependency initialization cannot be retried without changing its inputs.",
			{
				bootstrapCode: failure?.code,
				stage: failure?.stage,
				retryable: false,
			},
		);
	}
	if (workspace.initializationAttempt >= MAX_INITIALIZATION_ATTEMPTS) {
		throw new AppError(
			409,
			"workspace_initialization_retry_exhausted",
			"Workspace dependency initialization exhausted its retry limit.",
		);
	}
}

async function resolveLostInitializationClaim(workspaceId: string) {
	const current = await workspaceRepo.getTaskGitWorkspaceById(workspaceId);
	if (current && ["ready", "active"].includes(current.status)) return current;
	if (
		current?.status === "initializing" &&
		current.leaseOwner &&
		current.leaseExpiresAt &&
		current.leaseExpiresAt.getTime() > Date.now()
	) {
		throw new AppError(
			409,
			"workspace_initialization_in_progress",
			"Workspace dependency initialization is already in progress.",
		);
	}
	if (current?.initializationAttempt >= MAX_INITIALIZATION_ATTEMPTS) {
		throw new AppError(
			409,
			"workspace_initialization_retry_exhausted",
			"Workspace dependency initialization exhausted its retry limit.",
		);
	}
	throw new AppError(
		409,
		"workspace_initialization_in_progress",
		"Workspace dependency initialization is already in progress.",
	);
}

function startInitializationHeartbeat(
	workspaceId: string,
	leaseOwner: string,
	controller: AbortController,
) {
	let consecutiveErrors = 0;
	let renewing = false;
	const heartbeat = setInterval(() => {
		if (renewing || controller.signal.aborted) return;
		renewing = true;
		void workspaceRepo
			.renewTaskGitWorkspaceInitializationLease({
				id: workspaceId,
				leaseOwner,
				leaseExpiresAt: initializationLeaseExpiry(),
			})
			.then((renewed) => {
				if (!renewed) controller.abort();
				else consecutiveErrors = 0;
			})
			.catch(() => {
				consecutiveErrors += 1;
				if (consecutiveErrors >= 2) controller.abort();
			})
			.finally(() => {
				renewing = false;
			});
	}, INITIALIZATION_LEASE_HEARTBEAT_MS);
	heartbeat.unref();
	return heartbeat;
}

async function persistInitializationFailure(
	workspace: TaskGitWorkspace,
	leaseOwner: string,
	error: unknown,
) {
	const bootstrapError =
		error instanceof WorkspaceBootstrapError ? error : null;
	await workspaceRepo.transitionClaimedTaskGitWorkspaceInitialization({
		id: workspace.id,
		leaseOwner,
		data: {
			status: "initialization_failed",
			lastErrorCode: bootstrapError?.code ?? "DEPENDENCY_INSTALL_FAILED",
			lastErrorMessage:
				bootstrapError?.message ??
				"Workspace dependency initialization failed.",
			bootstrapEvidenceJson: {
				...toRecord(workspace.bootstrapEvidenceJson),
				dependencyBootstrapFailure: bootstrapError
					? {
							code: bootstrapError.code,
							message: bootstrapError.message,
							...bootstrapError.details,
						}
					: {
							code: "DEPENDENCY_INSTALL_FAILED",
							message: "Workspace dependency initialization failed.",
							stage: "install",
							retryable: true,
						},
			},
		},
	});
}

function mapInitializationError(error: unknown) {
	if (!(error instanceof WorkspaceBootstrapError)) return error;
	return new AppError(
		error.details.retryable ? 503 : 422,
		"workspace_dependency_initialization_failed",
		error.message,
		{
			bootstrapCode: error.code,
			stage: error.details.stage,
			retryable: error.details.retryable,
			adapterId: error.details.adapterId,
			componentRoot: error.details.componentRoot,
		},
	);
}

function initializationLeaseExpiry() {
	return new Date(Date.now() + INITIALIZATION_LEASE_TTL_MS);
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function readInitializationFailure(value: unknown) {
	const root = toRecord(value);
	const failure = toRecord(root.dependencyBootstrapFailure);
	return Object.keys(failure).length > 0 ? failure : null;
}

function isInitializationFailureRetryable(value: unknown) {
	return readInitializationFailure(value)?.retryable === true;
}
