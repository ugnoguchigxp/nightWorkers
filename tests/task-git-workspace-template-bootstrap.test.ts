import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories } from "../api/db/schema";
import {
	ensureTaskGitWorkspace,
	provisionTaskGitWorkspace,
} from "../api/modules/gitworktree/task-git-workspace.service";
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
});
