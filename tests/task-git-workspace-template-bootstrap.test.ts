import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, taskGitWorkspaces } from "../api/db/schema";
import {
	ensureTaskGitWorkspace,
	provisionTaskGitWorkspace,
} from "../api/modules/gitworktree/task-git-workspace.service";
import { alignBootstrappedRepositoryBranch } from "../api/modules/missionPilot/mission-pilot-repository-bootstrap.service";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";

vi.mock("../api/services/worker-tools/import-project", async () => {
	const { execFileSync } = await import("node:child_process");
	const { writeFileSync } = await import("node:fs");
	return {
		importProjectTool: vi.fn(async (input: { targetPath: string }) => {
			writeFileSync(path.join(input.targetPath, "README.md"), "# starter\n");
			execFileSync("git", ["init", "--initial-branch=main"], {
				cwd: input.targetPath,
			});
			execFileSync("git", ["add", "."], { cwd: input.targetPath });
			execFileSync(
				"git",
				[
					"-c",
					"user.name=Test",
					"-c",
					"user.email=test@example.com",
					"commit",
					"-m",
					"baseline",
				],
				{ cwd: input.targetPath },
			);
			return {
				ok: true,
				payload: {
					postImport: { initializedGit: true, baselineCommitCreated: true },
				},
			};
		}),
	};
});

const roots: string[] = [];
const repositoryIds: string[] = [];
beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true });
});

describe("Task Git workspace template bootstrap", () => {
	it("creates the baseline first and starts implementation from a dedicated worktree", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "nw-template-bootstrap-"));
		roots.push(root, `${root}-worktrees`);
		const project = await repo.createRepository({
			name: `TEST: template ${crypto.randomUUID()}`,
			localPath: root,
			branch: "main",
		});
		repositoryIds.push(project.id);
		const task = await repo.createTask({
			repositoryId: project.id,
			title: "Starter",
			status: "queued",
		});
		const planned = await ensureTaskGitWorkspace({
			taskId: task.id,
			planReviewId: crypto.randomUUID(),
			admissionKey: `template:${task.id}`,
			materializationIntent: {
				kind: "starter_template",
				source: "starter",
				stack: "hono",
				initialize: true,
			},
		});
		expect(planned.status).toBe("waiting_for_repository_initialization");
		const ready = await provisionTaskGitWorkspace(task.id);
		expect(ready.status).toBe("ready");
		expect(ready.bootstrapEvidenceJson).toMatchObject({
			baselineCommitCreated: true,
		});
		expect(ready.worktreePath).not.toBe(root);
	});

	it("restarts a failed existing-git allocation from template materialization", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "nw-template-retry-"));
		roots.push(root, `${root}-worktrees`);
		const project = await repo.createRepository({
			name: `TEST: template retry ${crypto.randomUUID()}`,
			localPath: root,
			branch: "main",
		});
		repositoryIds.push(project.id);
		const task = await repo.createTask({
			repositoryId: project.id,
			title: "Retry Starter",
			status: "queued",
		});
		const failed = await ensureTaskGitWorkspace({
			taskId: task.id,
			planReviewId: crypto.randomUUID(),
			admissionKey: `template-retry:${task.id}`,
		});
		await db
			.update(taskGitWorkspaces)
			.set({
				status: "provision_failed",
				provisionAttempt: 1,
				lastErrorCode: "workspace_provision_failed",
				lastErrorMessage: "not a git repository",
			})
			.where(eq(taskGitWorkspaces.id, failed.id));
		const resumed = await ensureTaskGitWorkspace({
			taskId: task.id,
			planReviewId: crypto.randomUUID(),
			admissionKey: `template-retry:${task.id}`,
			materializationIntent: {
				kind: "starter_template",
				source: "starter",
				stack: "hono",
				initialize: true,
			},
		});
		expect(resumed).toMatchObject({
			status: "waiting_for_repository_initialization",
			materializationKind: "starter_template",
			lastErrorCode: null,
			lastErrorMessage: null,
		});
		const ready = await provisionTaskGitWorkspace(task.id);
		expect(ready).toMatchObject({
			status: "ready",
			materializationKind: "starter_template",
		});
		expect(ready.worktreePath).not.toBe(root);
	});

	it("replaces a stale waiting materialization intent after Plan regeneration", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "nw-template-refresh-"));
		roots.push(root, `${root}-worktrees`);
		const project = await repo.createRepository({
			name: `TEST: template refresh ${crypto.randomUUID()}`,
			localPath: root,
			branch: "main",
		});
		repositoryIds.push(project.id);
		const task = await repo.createTask({
			repositoryId: project.id,
			title: "Refresh Starter",
			status: "ready",
		});
		const waiting = await ensureTaskGitWorkspace({
			taskId: task.id,
			planReviewId: null,
			admissionKey: `template-refresh:${task.id}`,
			materializationIntent: {
				kind: "starter_template",
				source: "starter",
				stack: "hono",
				variant: "sqlite",
				initialize: true,
			},
		});
		await db
			.update(taskGitWorkspaces)
			.set({
				materializationIntentJson: {
					kind: "starter_template",
					source: "starter",
					stack: "hono",
					variant: "hono-react-vite-sqlite",
					initialize: true,
				},
			})
			.where(eq(taskGitWorkspaces.id, waiting.id));

		const refreshed = await ensureTaskGitWorkspace({
			taskId: task.id,
			planReviewId: null,
			admissionKey: `template-refresh:${task.id}`,
			materializationIntent: {
				kind: "starter_template",
				source: "starter",
				stack: "hono",
				variant: "sqlite",
				initialize: true,
			},
		});

		expect(refreshed).toMatchObject({
			status: "waiting_for_repository_initialization",
			materializationIntentJson: {
				kind: "starter_template",
				stack: "hono",
				variant: "sqlite",
			},
		});
	});

	it("reuses a held starter allocation after a worker creates the baseline", async () => {
		const { execFileSync } = await import("node:child_process");
		const { writeFileSync } = await import("node:fs");
		const root = await mkdtemp(path.join(tmpdir(), "nw-worker-bootstrap-"));
		roots.push(root, `${root}-worktrees`);
		const project = await repo.createRepository({
			name: `TEST: worker bootstrap ${crypto.randomUUID()}`,
			localPath: root,
			branch: "main",
		});
		repositoryIds.push(project.id);
		const task = await repo.createTask({
			repositoryId: project.id,
			title: "Worker Bootstrap",
			status: "queued",
		});
		const held = await ensureTaskGitWorkspace({
			taskId: task.id,
			planReviewId: crypto.randomUUID(),
			admissionKey: `worker-bootstrap:${task.id}`,
			materializationIntent: {
				kind: "starter_template",
				source: "starter",
				stack: "hono",
				initialize: true,
			},
		});
		expect(held.status).toBe("waiting_for_repository_initialization");
		writeFileSync(path.join(root, "README.md"), "# bootstrapped\n");
		execFileSync("git", ["init", "--initial-branch=master"], { cwd: root });
		execFileSync("git", ["add", "."], { cwd: root });
		execFileSync(
			"git",
			[
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.com",
				"commit",
				"-m",
				"baseline",
			],
			{ cwd: root },
		);
		await alignBootstrappedRepositoryBranch({
			repositoryPath: root,
			targetBranch: "main",
		});
		expect(
			execFileSync("git", ["branch", "--show-current"], {
				cwd: root,
				encoding: "utf8",
			}).trim(),
		).toBe("main");
		const initialized = await ensureTaskGitWorkspace({
			taskId: task.id,
			planReviewId: crypto.randomUUID(),
			admissionKey: `worker-bootstrap:${task.id}`,
			materializationIntent: { kind: "existing_git" },
		});
		expect(initialized).toMatchObject({
			id: held.id,
			status: "planned",
			materializationKind: "existing_git",
		});
		const ready = await provisionTaskGitWorkspace(task.id);
		expect(ready.status).toBe("ready");
		expect(ready.worktreePath).not.toBe(root);
	});
});
