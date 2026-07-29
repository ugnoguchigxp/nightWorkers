import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, taskGitWorkspaces } from "../api/db/schema";
import * as workspaceRepo from "../api/modules/gitworktree/task-git-workspace.repository";
import {
	ensureTaskGitWorkspace,
	provisionTaskGitWorkspace,
} from "../api/modules/gitworktree/task-git-workspace.service";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";

const roots: string[] = [];
const repositoryIds: string[] = [];
const execFileAsync = promisify(execFile);

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("workspace dependency initialization lease", () => {
	it("allows only one concurrent initializer to claim an allocation", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "nw-init-lease-"));
		roots.push(root);
		const repository = await nightworkersRepo.createRepository({
			name: `TEST: initialization lease ${crypto.randomUUID()}`,
			localPath: root,
			branch: "main",
		});
		repositoryIds.push(repository.id);
		const task = await nightworkersRepo.createTask({
			repositoryId: repository.id,
			title: "Claim initialization once",
			status: "queued",
		});
		const allocation = await ensureTaskGitWorkspace({
			taskId: task.id,
			planReviewId: null,
			admissionKey: `lease:${task.id}`,
		});
		await db
			.update(taskGitWorkspaces)
			.set({ status: "initializing", worktreePath: root })
			.where(eq(taskGitWorkspaces.id, allocation.id));

		const owners = [crypto.randomUUID(), crypto.randomUUID()];
		const claims = await Promise.all(
			owners.map((leaseOwner) =>
				workspaceRepo.claimTaskGitWorkspaceInitialization({
					id: allocation.id,
					leaseOwner,
					leaseExpiresAt: new Date(Date.now() + 60_000),
					maxAttempts: 3,
				}),
			),
		);

		expect(claims.filter(Boolean)).toHaveLength(1);
		const winnerIndex = claims.findIndex(Boolean);
		const winner = owners[winnerIndex];
		const loser = owners[winnerIndex === 0 ? 1 : 0];
		expect(winner).toBeTruthy();
		expect(loser).toBeTruthy();
		await expect(
			workspaceRepo.transitionClaimedTaskGitWorkspaceInitialization({
				id: allocation.id,
				leaseOwner: loser as string,
				data: { status: "ready" },
			}),
		).resolves.toBeNull();
		await expect(
			workspaceRepo.transitionClaimedTaskGitWorkspaceInitialization({
				id: allocation.id,
				leaseOwner: winner as string,
				data: { status: "ready", initializedAt: new Date() },
			}),
		).resolves.toMatchObject({
			status: "ready",
			initializationAttempt: 1,
			leaseOwner: null,
			leaseExpiresAt: null,
		});
	});

	it("does not retry a structural lockfile failure", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "nw-init-lock-"));
		roots.push(root, `${root}-worktrees`);
		await execFileAsync("git", ["init", "--initial-branch=main"], {
			cwd: root,
		});
		await execFileAsync("git", ["config", "user.name", "NightWorkers Test"], {
			cwd: root,
		});
		await execFileAsync(
			"git",
			["config", "user.email", "nightworkers@example.test"],
			{ cwd: root },
		);
		await writeFile(path.join(root, "package.json"), "{}");
		await execFileAsync("git", ["add", "package.json"], { cwd: root });
		await execFileAsync("git", ["commit", "-m", "base"], { cwd: root });
		const repository = await nightworkersRepo.createRepository({
			name: `TEST: non-retryable initialization ${crypto.randomUUID()}`,
			localPath: root,
			branch: "main",
		});
		repositoryIds.push(repository.id);
		const task = await nightworkersRepo.createTask({
			repositoryId: repository.id,
			title: "Require dependency lock",
			status: "queued",
		});
		const allocation = await ensureTaskGitWorkspace({
			taskId: task.id,
			planReviewId: null,
			admissionKey: `lock:${task.id}`,
		});

		await expect(provisionTaskGitWorkspace(task.id)).rejects.toMatchObject({
			statusCode: 422,
			code: "workspace_dependency_initialization_failed",
			details: {
				bootstrapCode: "BOOTSTRAP_LOCK_REQUIRED",
				retryable: false,
			},
		});
		await expect(provisionTaskGitWorkspace(task.id)).rejects.toMatchObject({
			statusCode: 422,
			code: "workspace_dependency_initialization_failed",
			details: { retryable: false },
		});
		const [persisted] = await db
			.select()
			.from(taskGitWorkspaces)
			.where(eq(taskGitWorkspaces.id, allocation.id));
		expect(persisted).toMatchObject({
			status: "initialization_failed",
			initializationAttempt: 1,
			lastErrorCode: "BOOTSTRAP_LOCK_REQUIRED",
		});
	});
});
