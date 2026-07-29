import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { WorktreeUsage } from "../../../shared/schemas/gitworktree.schema";
import { db } from "../../db/client";
import {
	repositories,
	taskGitWorkspaces,
	taskRunCommitRecords,
	taskRunMergeRecords,
	taskRuns,
	tasks,
} from "../../db/schema";

const ACTIVE_TASK_STATUSES = [
	"draft",
	"ready",
	"context_compiling",
	"queued",
	"running",
	"finalizing",
	"verifying",
	"needs_review",
	"integration_pending",
	"blocked",
	"needs_human",
] as const;
const ACTIVE_RUN_STATUSES = [
	"running",
	"context_compiling",
	"finalizing",
	"needs_review",
	"blocked",
	"needs_human",
] as const;
const PENDING_CLOSEOUT_STATUSES = ["pending", "ready", "needs_human"] as const;

export async function getRepository(id: string) {
	const [repository] = await db
		.select()
		.from(repositories)
		.where(eq(repositories.id, id));
	return repository;
}

export async function readUsage(repositoryId: string) {
	const [taskRows, runRows, closeoutRows, mergeRows, workspaceRows] =
		await Promise.all([
			db
				.select({
					id: tasks.id,
					status: tasks.status,
					path: tasks.worktreePath,
				})
				.from(tasks)
				.where(
					and(
						eq(tasks.repositoryId, repositoryId),
						isNotNull(tasks.worktreePath),
					),
				),
			db
				.select({
					id: taskRuns.id,
					status: taskRuns.status,
					path: taskRuns.worktreePath,
				})
				.from(taskRuns)
				.where(
					and(
						eq(taskRuns.repositoryId, repositoryId),
						isNotNull(taskRuns.worktreePath),
					),
				),
			db
				.select({
					runId: taskRunCommitRecords.runId,
					path: taskRuns.worktreePath,
				})
				.from(taskRunCommitRecords)
				.innerJoin(taskRuns, eq(taskRunCommitRecords.runId, taskRuns.id))
				.where(
					and(
						eq(taskRuns.repositoryId, repositoryId),
						isNotNull(taskRuns.worktreePath),
						inArray(taskRunCommitRecords.status, [
							...PENDING_CLOSEOUT_STATUSES,
						]),
					),
				),
			db
				.select({
					runId: taskRunMergeRecords.runId,
					path: taskGitWorkspaces.worktreePath,
				})
				.from(taskRunMergeRecords)
				.innerJoin(
					taskGitWorkspaces,
					eq(taskRunMergeRecords.workspaceId, taskGitWorkspaces.id),
				)
				.where(
					and(
						eq(taskGitWorkspaces.repositoryId, repositoryId),
						isNotNull(taskGitWorkspaces.worktreePath),
						inArray(taskRunMergeRecords.status, [
							"decision_required",
							"previewing",
							"merge_ready",
							"merging",
							"deferred",
							"merge_blocked",
							"merge_conflicted",
						]),
					),
				),
			db
				.select()
				.from(taskGitWorkspaces)
				.where(
					and(
						eq(taskGitWorkspaces.repositoryId, repositoryId),
						isNotNull(taskGitWorkspaces.worktreePath),
					),
				),
		]);
	const map = new Map<string, WorktreeUsage>();
	const canonicalPaths = new Map<string, Promise<string>>();
	const canonicalize = (value: string) => {
		const absolute = path.resolve(value);
		let pending = canonicalPaths.get(absolute);
		if (!pending) {
			pending = fs.realpath(absolute).catch(() => absolute);
			canonicalPaths.set(absolute, pending);
		}
		return pending;
	};
	const get = async (value: string) => {
		const key = await canonicalize(value);
		let usage = map.get(key);
		if (!usage) {
			usage = {
				taskIds: [],
				runIds: [],
				activeTaskCount: 0,
				activeRunCount: 0,
				pendingCloseoutCount: 0,
				workspaceBinding: null,
			};
			map.set(key, usage);
		}
		return usage;
	};
	for (const row of taskRows) {
		if (
			!row.path ||
			!(ACTIVE_TASK_STATUSES as readonly string[]).includes(row.status)
		)
			continue;
		const usage = await get(row.path);
		usage.taskIds.push(row.id);
		usage.activeTaskCount += 1;
	}
	for (const row of runRows) {
		if (
			!row.path ||
			!(ACTIVE_RUN_STATUSES as readonly string[]).includes(row.status)
		)
			continue;
		const usage = await get(row.path);
		usage.runIds.push(row.id);
		usage.activeRunCount += 1;
	}
	for (const row of closeoutRows) {
		if (!row.path) continue;
		const usage = await get(row.path);
		if (!usage.runIds.includes(row.runId)) usage.runIds.push(row.runId);
		usage.pendingCloseoutCount += 1;
	}
	for (const row of mergeRows) {
		if (!row.path) continue;
		const usage = await get(row.path);
		if (!usage.runIds.includes(row.runId)) usage.runIds.push(row.runId);
		usage.pendingCloseoutCount += 1;
	}
	for (const row of workspaceRows) {
		if (!row.worktreePath) continue;
		const usage = await get(row.worktreePath);
		usage.workspaceBinding = {
			workspaceId: row.id,
			allocationVersion: row.allocationVersion,
			status: row.status,
			sourceBranch: row.sourceBranch,
			targetBranch: row.targetBranch,
			targetBaseSha: row.targetBaseSha,
			expectedHeadSha: row.expectedHeadSha,
			lastVerifiedHead: row.lastVerifiedHead,
			repositoryIdentityRevision: row.repositoryIdentityRevision,
		};
	}
	return map;
}
