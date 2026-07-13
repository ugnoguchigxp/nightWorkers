import path from "node:path";
import type { ProjectGitIntegrationPolicy } from "../../../shared/schemas/git-integration.schema";
import { db } from "../../db/client";
import { AppError, NotFoundError } from "../../lib/errors";
import type { AgentRuntimeResult } from "../../services/agent-runtime/types";
import { summarizeLlmUsageForTask } from "../../services/llm-usage";
import { resolveWorktreePath } from "../gitworktree/gitworktree.service";
import { runGitCommand } from "../gitworktree/gitworktree-cli";
import {
	getSessionByTaskId,
	toControlSummary,
} from "../missionPilot/mission-pilot.repository";
import {
	buildBlueprintPlanningReadiness,
	isBlueprintMessage,
} from "./nightworkers.planning-helpers.service";
import * as repo from "./nightworkers.repository";
import { runSessionQueueForRepository } from "./nightworkers.run-orchestration.service";
import { createTaskWithMissionPilot } from "./nightworkers.task-creation.service";

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
	let branch = data.branch?.trim() || "main";
	try {
		await runGitCommand(["-C", data.localPath, "rev-parse", "--git-dir"]);
		if (!data.branch?.trim()) {
			branch = (
				await runGitCommand([
					"-C",
					data.localPath,
					"symbolic-ref",
					"--short",
					"HEAD",
				])
			).stdout.trim();
		}
		await runGitCommand(["check-ref-format", "--branch", branch]);
		await runGitCommand([
			"-C",
			data.localPath,
			"show-ref",
			"--verify",
			`refs/heads/${branch}`,
		]);
	} catch (_error) {
		const isGitRepository = await runGitCommand([
			"-C",
			data.localPath,
			"rev-parse",
			"--git-dir",
		])
			.then(() => true)
			.catch(() => false);
		if (isGitRepository)
			throw new AppError(
				400,
				"GIT_INTEGRATION_TARGET_INVALID",
				"指定したlocal branchを確認できません",
			);
	}
	return repo.createRepository({
		...data,
		branch,
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
		branch?: string;
		gitIntegrationPolicy?: ProjectGitIntegrationPolicy;
		expectedGitIntegrationVersion?: number;
	},
) {
	const gitSettingsRequested =
		data.branch !== undefined || data.gitIntegrationPolicy !== undefined;
	const existing =
		data.safetyPolicy !== undefined || gitSettingsRequested
			? await repo.getRepository(id)
			: null;
	if ((data.safetyPolicy !== undefined || gitSettingsRequested) && !existing)
		throw new NotFoundError("Repository not found");
	if (gitSettingsRequested) {
		if (
			data.branch === undefined ||
			data.gitIntegrationPolicy === undefined ||
			data.expectedGitIntegrationVersion === undefined
		)
			throw new AppError(
				400,
				"GIT_INTEGRATION_SETTINGS_INCOMPLETE",
				"Git integration settings must be saved together",
			);
		try {
			await runGitCommand(["check-ref-format", "--branch", data.branch]);
			await runGitCommand([
				"-C",
				existing?.localPath ?? "",
				"show-ref",
				"--verify",
				`refs/heads/${data.branch}`,
			]);
			if (data.gitIntegrationPolicy.remoteName) {
				const remotes = await runGitCommand([
					"-C",
					existing?.localPath ?? "",
					"remote",
				]);
				if (
					!remotes.stdout
						.split("\n")
						.includes(data.gitIntegrationPolicy.remoteName)
				)
					throw new Error("remote missing");
			}
		} catch {
			throw new AppError(
				400,
				"GIT_INTEGRATION_TARGET_INVALID",
				"指定したlocal branchまたはremoteを確認できません",
			);
		}
	}
	const safetyPolicy =
		data.safetyPolicy !== undefined && existing
			? normalizeSafetyPolicyForRepository(
					existing.localPath,
					data.safetyPolicy,
				)
			: undefined;
	const normalized = {
		queueEnabled: data.queueEnabled,
		branch: data.branch,
		gitIntegrationPolicyJson: data.gitIntegrationPolicy,
		gitIntegrationVersion: gitSettingsRequested
			? (data.expectedGitIntegrationVersion ?? 0) + 1
			: undefined,
		safetyPolicy,
		maxConcurrentSessions:
			data.maxConcurrentSessions === undefined
				? undefined
				: Math.max(1, Math.floor(data.maxConcurrentSessions)),
	};
	const updated = await repo.updateRepository(
		id,
		normalized,
		gitSettingsRequested ? data.expectedGitIntegrationVersion : undefined,
	);
	if (!updated) {
		if (gitSettingsRequested)
			throw new AppError(
				409,
				"GIT_INTEGRATION_SETTINGS_CHANGED",
				"Git integration settings changed; refresh and retry",
			);
		throw new NotFoundError("Repository not found");
	}
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
	return db.transaction(async (tx) => {
		const task = await createTaskWithMissionPilot(
			{
				...taskData,
				worktreePath,
				status: "draft",
			},
			tx,
		);
		if (data.description?.trim()) {
			await repo.createTaskMessage(
				{
					taskId: task.id,
					role: "user",
					content: data.description.trim(),
					messageType: "text",
				},
				tx,
			);
		}
		return task;
	});
}

export async function getTask(id: string) {
	const task = await repo.getTask(id);
	if (!task) return task;
	const session = await getSessionByTaskId(id);
	if (!session)
		throw new Error(`Task ${id} is missing its Mission Pilot session`);
	return { ...task, missionPilot: toControlSummary(session) };
}

export async function listTasks() {
	const { listTasksWithMissionPilot } = await import("../missionPilot");
	return listTasksWithMissionPilot();
}

export async function listTaskMessages(
	taskId: string,
	options?: { channel?: "chat" | "pilot_thought" | "artifact" | "internal" },
) {
	const task = await repo.getTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	return repo.listTaskMessages(taskId, { traceChannel: options?.channel });
}

export async function getTaskLlmUsageSummary(taskId: string) {
	const task = await repo.getTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	return summarizeLlmUsageForTask(taskId);
}

export async function listTaskActivityEvents(
	taskId: string,
	options?: {
		afterSeq?: number;
		channel?: "chat" | "pilot_thought" | "artifact" | "internal";
	},
) {
	const task = await repo.getTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	const events = await repo.listActivityEventsForTask(taskId, {
		afterSeq: options?.afterSeq,
		traceChannel: options?.channel,
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
	if (!updated) return updated;
	const session = await getSessionByTaskId(id);
	if (!session)
		throw new Error(`Task ${id} is missing its Mission Pilot session`);
	return { ...updated, missionPilot: toControlSummary(session) };
}
