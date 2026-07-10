import path from "node:path";
import { NotFoundError } from "../../lib/errors";
import { getCurrentSettings } from "../../routes/settings";
import type { AgentRuntimeResult } from "../../services/agent-runtime/types";
import { summarizeLlmUsageForTask } from "../../services/llm-usage";
import {
	buildOverviewDashboard,
	type OverviewRange,
} from "../../services/overview";
import {
	buildBlueprintPlanningReadiness,
	isBlueprintMessage,
} from "./nightworkers.planning-helpers.service";
import * as repo from "./nightworkers.repository";
import { runSessionQueueForRepository } from "./nightworkers.run-orchestration.service";
import { resolveWorktreePath } from "./nightworkers.worktrees.service";

type RepositorySafetyPolicy = Parameters<
	typeof repo.createRepository
>[0]["safetyPolicy"];
type UpdateTaskData = Parameters<typeof repo.updateTask>[1];

function normalizeSafetyPolicyForRepository(
	localPath: string,
	safetyPolicy: RepositorySafetyPolicy,
): RepositorySafetyPolicy {
	if (!safetyPolicy || !Array.isArray(safetyPolicy.externalAllowedPaths))
		return safetyPolicy;

	const externalAllowedPaths = Array.from(
		new Set(
			safetyPolicy.externalAllowedPaths
				.filter(
					(candidate: unknown): candidate is string =>
						typeof candidate === "string",
				)
				.map((candidate: string) =>
					path.isAbsolute(candidate)
						? path.resolve(candidate)
						: path.resolve(localPath, candidate),
				),
		),
	);

	return {
		...safetyPolicy,
		externalAllowedPaths,
	};
}

export type BlueprintPlanningReadiness = {
	source: "adopted" | "latest_generated" | "none";
	diagnostic:
		| "adopted_blueprint"
		| "using_latest_generated_blueprint"
		| "no_adopted_blueprint";
	messageId: string | null;
	blueprint: unknown;
	summary: string;
};

export function outcomeFromRuntimeResult(runtimeResult: AgentRuntimeResult): {
	status: AgentRuntimeResult["terminalState"];
	reason: string;
	summary: string;
} {
	const coverageAutonomy = readCoverageAutonomyStatus(
		runtimeResult.testResults,
	);
	if (coverageAutonomy === "needs_human" || coverageAutonomy === "continue") {
		return {
			status: "needs_human",
			reason: "coverage_gate_failed",
			summary:
				runtimeResult.finalReport ||
				runtimeResult.summary ||
				"Coverage autonomy gate did not pass.",
		};
	}
	const status = runtimeResult.terminalState;
	const reason =
		runtimeResult.stoppedBy === "policy"
			? "policy_violation"
			: runtimeResult.stoppedBy === "budget"
				? "budget_exceeded"
				: runtimeResult.stoppedBy === "tool_failure"
					? "tool_failure_limit"
					: runtimeResult.stoppedBy;
	return {
		status,
		reason,
		summary:
			runtimeResult.finalReport ||
			runtimeResult.summary ||
			`Runtime finished: ${status}`,
	};
}

function readCoverageAutonomyStatus(testResults: unknown): string | null {
	if (
		!testResults ||
		typeof testResults !== "object" ||
		Array.isArray(testResults)
	)
		return null;
	const coverageAutonomy = (testResults as Record<string, unknown>)
		.coverageAutonomy;
	if (
		!coverageAutonomy ||
		typeof coverageAutonomy !== "object" ||
		Array.isArray(coverageAutonomy)
	) {
		return null;
	}
	const status = (coverageAutonomy as Record<string, unknown>).status;
	return typeof status === "string" ? status : null;
}

// --- Repositories ---
export async function createRepository(data: {
	name: string;
	localPath: string;
	branch?: string;
	allowed?: boolean;
	queueEnabled?: boolean;
	maxConcurrentSessions?: number;
	safetyPolicy?: RepositorySafetyPolicy;
}) {
	return repo.createRepository({
		...data,
		branch: data.branch || "main",
		safetyPolicy: normalizeSafetyPolicyForRepository(
			data.localPath,
			data.safetyPolicy,
		),
	});
}

export async function getRepository(id: string) {
	return repo.getRepository(id);
}

export async function listRepositories() {
	return repo.listRepositories();
}

export async function updateRepository(
	id: string,
	data: {
		queueEnabled?: boolean;
		maxConcurrentSessions?: number;
		safetyPolicy?: RepositorySafetyPolicy;
	},
) {
	const existing =
		data.safetyPolicy !== undefined ? await repo.getRepository(id) : null;
	if (data.safetyPolicy !== undefined && !existing)
		throw new NotFoundError("Repository not found");
	const safetyPolicy =
		data.safetyPolicy !== undefined && existing
			? normalizeSafetyPolicyForRepository(
					existing.localPath,
					data.safetyPolicy,
				)
			: undefined;
	const normalized = {
		...data,
		safetyPolicy,
		maxConcurrentSessions:
			data.maxConcurrentSessions === undefined
				? undefined
				: Math.max(1, Math.floor(data.maxConcurrentSessions)),
	};
	const updated = await repo.updateRepository(id, normalized);
	if (!updated) throw new NotFoundError("Repository not found");
	if (updated.queueEnabled) {
		void runSessionQueueForRepository(updated.id);
	}
	return updated;
}

export async function deleteRepository(id: string) {
	return repo.deleteRepository(id);
}

// --- Tasks ---
export async function createTask(data: {
	repositoryId: string;
	title: string;
	description?: string | null;
	objective?: string | null;
	acceptanceCriteria?: string | null;
	worktreeId?: string;
	timeoutSeconds?: number;
	priority?: number;
	createdBy?: string | null;
}) {
	const { worktreeId, ...taskData } = data;
	const worktreePath = worktreeId
		? await resolveWorktreePath(data.repositoryId, worktreeId)
		: null;
	const task = await repo.createTask({
		...taskData,
		worktreePath,
		status: "draft",
	});
	if (data.description?.trim()) {
		await repo.createTaskMessage({
			taskId: task.id,
			role: "user",
			content: data.description.trim(),
			messageType: "text",
		});
	}
	return task;
}

export async function getTask(id: string) {
	return repo.getTask(id);
}

export async function listTasks() {
	return repo.listTasks();
}

export async function listTaskMessages(taskId: string) {
	const task = await repo.getTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	return repo.listTaskMessages(taskId);
}

export async function getTaskLlmUsageSummary(taskId: string) {
	const task = await repo.getTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	return summarizeLlmUsageForTask(taskId);
}

export async function getOverviewDashboard(input: {
	range?: OverviewRange;
	repositoryId?: string | null;
	timezone?: string | null;
	currency?: "JPY" | "USD" | "EUR" | null;
}) {
	const settings = getCurrentSettings();
	const activeProvider = settings.ACTIVE_LLM_PROVIDER || null;
	const activeModel =
		activeProvider === "openai"
			? settings.OPENAI_MODEL
			: activeProvider === "azure"
				? settings.AZURE_OPENAI_DEPLOYMENT_NAME
				: activeProvider === "bedrock"
					? settings.AWS_BEDROCK_MODEL
					: activeProvider === "codex"
						? settings.CODEX_MODEL
						: null;
	return buildOverviewDashboard({
		...input,
		activeProvider,
		activeModel: activeModel || null,
	});
}

export async function listTaskActivityEvents(
	taskId: string,
	options?: { afterSeq?: number },
) {
	const task = await repo.getTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	const events = await repo.listActivityEventsForTask(taskId, {
		afterSeq: options?.afterSeq,
	});
	const artifacts = await listReferencedActivityArtifacts(taskId, events);
	return { events, artifacts };
}

async function listReferencedActivityArtifacts(
	taskId: string,
	events: Array<{ artifactId?: string | null }>,
) {
	const artifactIds = new Set(
		events.map((event) => event.artifactId).filter(Boolean),
	);
	if (artifactIds.size === 0) return [];
	const artifacts = await repo.listActivityArtifactsForTask(taskId);
	return artifacts.filter((artifact) => artifactIds.has(artifact.id));
}

export async function resolveBlueprintPlanningReadiness(
	taskId: string,
): Promise<BlueprintPlanningReadiness> {
	const messages = await repo.listTaskMessages(taskId);
	const blueprintMessages = messages.filter(isBlueprintMessage);
	for (const message of [...blueprintMessages].reverse()) {
		const adoption = await repo.getBlueprintArtifactAdoption(
			taskId,
			message.id,
		);
		if (adoption?.adopted) {
			return buildBlueprintPlanningReadiness("adopted", message);
		}
	}
	const latestGenerated = blueprintMessages.at(-1);
	if (latestGenerated) {
		return buildBlueprintPlanningReadiness("latest_generated", latestGenerated);
	}
	return {
		source: "none",
		diagnostic: "no_adopted_blueprint",
		messageId: null,
		blueprint: null,
		summary: "No adopted Blueprint artifact is available for task planning.",
	};
}

export async function updateTask(id: string, data: UpdateTaskData) {
	const updated = await repo.updateTask(id, data);
	if (updated?.status === "ready") {
		void runSessionQueueForRepository(updated.repositoryId);
	}
	return updated;
}
