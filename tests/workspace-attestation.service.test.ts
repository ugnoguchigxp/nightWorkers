import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, taskGitWorkspaces } from "../api/db/schema";
import { attestTaskWorkspaceForRun } from "../api/modules/gitworktree/workspace-attestation.service";
import { appendActivityArtifact } from "../api/modules/nightworkers/nightworkers.activity-persistence.repository";
import * as repository from "../api/modules/nightworkers/nightworkers.repository";
import { createTaskRun } from "../api/modules/nightworkers/nightworkers.runs.repository";
import { executeWorkerTool } from "../api/services/worker-tools/dispatcher";
import {
	assertRequestedRunWorkspaceRoot,
	resolveRunWorkspaceAuthority,
} from "../api/services/workspace/run-workspace-authority.service";
import { reconcileTaskWorkspaceAuthorities } from "../api/services/workspace/workspace-authority-reconciliation";

let root: string;
let worktreeRoot: string;
let taskId: string;

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "nw-attestation-base-"));
	worktreeRoot = `${root}-task`;
	execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" });
	await fs.writeFile(path.join(root, "README.md"), "# fixture\n", "utf-8");
	git(root, ["add", "README.md"]);
	git(root, [
		"-c",
		"user.name=NightWorkers Test",
		"-c",
		"user.email=nightworkers@example.test",
		"commit",
		"-m",
		"fixture",
	]);
	git(root, ["worktree", "add", "-b", "codex/task", worktreeRoot, "HEAD"]);
	const project = await repository.createRepository({
		name: `TEST: attestation ${crypto.randomUUID()}`,
		localPath: root,
		branch: "main",
	});
	const task = await repository.createTask({
		repositoryId: project.id,
		title: "TEST: attestation task",
	});
	taskId = task.id;
	const canonicalWorktree = await fs.realpath(worktreeRoot);
	await db.insert(taskGitWorkspaces).values({
		taskId,
		repositoryId: project.id,
		admissionKey: crypto.randomUUID(),
		status: "ready",
		materializationKind: "existing_git",
		integrationPolicySnapshotJson: {},
		sourceBranch: "codex/task",
		targetBranch: "main",
		sourceRef: "refs/heads/codex/task",
		targetRef: "refs/heads/main",
		targetBaseSha: git(root, ["rev-parse", "main"]),
		worktreePath: canonicalWorktree,
		taskWorktreePathCanonical: canonicalWorktree,
		worktreeId: crypto.randomUUID(),
		allocationVersion: 1,
		expectedHeadSha: git(worktreeRoot, ["rev-parse", "HEAD"]),
		repositoryIdentityRevision: project.repositoryIdentityRevision,
		repositoryIdentityDigest: project.repositoryIdentityDigest,
		baseWorktreeId: project.baseWorktreeId,
		baseWorktreePathCanonical: project.baseWorktreePathCanonical,
		gitCommonDirDigest: digest(project.gitCommonDirCanonical ?? ""),
	});
});

afterEach(async () => {
	await fs.rm(worktreeRoot, { recursive: true, force: true });
	await fs.rm(root, { recursive: true, force: true });
});

describe("workspace attestation", () => {
	it("persists an append-only observation with comparison freshness", async () => {
		const result = await attestTaskWorkspaceForRun({
			taskId,
			requireClean: true,
		});

		expect(result.attestation).toMatchObject({
			revision: 1,
			branchRef: "refs/heads/codex/task",
			dirty: false,
			conflicted: false,
			ahead: 0,
			behind: 0,
			comparisonRef: "refs/heads/main",
			stagedPathsJson: [],
			modifiedPathsJson: [],
			untrackedPathsJson: [],
			conflictPathsJson: [],
			upstreamFreshness: "upstream_missing",
		});
		expect(result.attestation.digest).toMatch(/^sha256:/);
		expect(result.attestation.comparisonSha).toBe(
			git(root, ["rev-parse", "main"]),
		);
		expect(result.workspace.lastAttestationId).toBe(result.attestation.id);
	});

	it("allows only the original Run's owned dirty paths during resume", async () => {
		await fs.writeFile(path.join(worktreeRoot, "owned.txt"), "owned\n");

		const resumed = await attestTaskWorkspaceForRun({
			taskId,
			requireClean: false,
			allowedDirtyPaths: ["owned.txt"],
		});
		expect(resumed.attestation.untrackedPathsJson).toEqual(["owned.txt"]);

		await fs.writeFile(path.join(worktreeRoot, "foreign.txt"), "foreign\n");
		await expect(
			attestTaskWorkspaceForRun({
				taskId,
				requireClean: false,
				allowedDirtyPaths: ["owned.txt"],
			}),
		).rejects.toMatchObject({ code: "workspace_attestation_failed" });
	});

	it("allows the current Task worktree diff for an explicit fresh review Run", async () => {
		await fs.writeFile(
			path.join(worktreeRoot, "review-target.txt"),
			"review\n",
		);

		const reviewed = await attestTaskWorkspaceForRun({
			taskId,
			requireClean: false,
			allowCurrentDirtyState: true,
		});

		expect(reviewed.attestation).toMatchObject({
			canonicalPath: await fs.realpath(worktreeRoot),
			branchRef: "refs/heads/codex/task",
			dirty: true,
			conflicted: false,
			untrackedPathsJson: ["review-target.txt"],
		});
	});

	it("records both sides of a staged rename as owned dirty paths", async () => {
		git(worktreeRoot, ["mv", "README.md", "RENAMED.md"]);

		await expect(
			attestTaskWorkspaceForRun({
				taskId,
				requireClean: false,
				allowedDirtyPaths: ["RENAMED.md"],
			}),
		).rejects.toMatchObject({ code: "workspace_attestation_failed" });

		const resumed = await attestTaskWorkspaceForRun({
			taskId,
			requireClean: false,
			allowedDirtyPaths: ["README.md", "RENAMED.md"],
		});
		expect(resumed.attestation.stagedPathsJson).toEqual([
			"README.md",
			"RENAMED.md",
		]);
	});

	it("rejects a dirty workspace for new Run admission", async () => {
		await fs.writeFile(
			path.join(worktreeRoot, "dirty.txt"),
			"dirty\n",
			"utf-8",
		);

		await expect(
			attestTaskWorkspaceForRun({ taskId, requireClean: true }),
		).rejects.toMatchObject({ code: "workspace_attestation_failed" });
	});

	it("binds every requested root to the Run admission attestation", async () => {
		const admission = await attestTaskWorkspaceForRun({
			taskId,
			requireClean: true,
		});
		const run = await createTaskRun({
			taskId,
			repositoryId: admission.workspace.repositoryId,
			workspaceAuthorityKind: "task_workspace",
			workspaceId: admission.workspace.id,
			workspaceAllocationVersion: admission.workspace.allocationVersion,
			repositoryIdentityRevision:
				admission.workspace.repositoryIdentityRevision,
			admissionAttestationId: admission.attestation.id,
			admissionAttestationDigest: admission.attestation.digest,
			admittedHeadSha: admission.attestation.headSha,
			worktreePath: admission.attestation.canonicalPath,
		});

		await expect(resolveRunWorkspaceAuthority(run.id)).resolves.toMatchObject({
			ok: true,
			kind: "task_workspace",
			executionRoot: admission.attestation.canonicalPath,
		});
		await expect(
			assertRequestedRunWorkspaceRoot({
				runId: run.id,
				taskId,
				requestedRoot: root,
			}),
		).resolves.toMatchObject({
			ok: false,
			code: "RUN_WORKSPACE_ROOT_MISMATCH",
		});
		git(worktreeRoot, ["checkout", "-b", "codex/drift"]);
		await expect(resolveRunWorkspaceAuthority(run.id)).resolves.toMatchObject({
			ok: false,
			code: "RUN_WORKSPACE_ROOT_MISMATCH",
		});
		git(worktreeRoot, ["checkout", "codex/task"]);
		await fs.writeFile(path.join(worktreeRoot, "head-drift.txt"), "drift\n");
		git(worktreeRoot, ["add", "head-drift.txt"]);
		git(worktreeRoot, [
			"-c",
			"user.name=NightWorkers Test",
			"-c",
			"user.email=nightworkers@example.test",
			"commit",
			"-m",
			"head drift",
		]);
		await expect(resolveRunWorkspaceAuthority(run.id)).resolves.toMatchObject({
			ok: false,
			code: "RUN_WORKSPACE_HEAD_MISMATCH",
		});
		const blockedSideEffect = await executeWorkerTool({
			toolName: "run_command",
			args: { command: "touch should-not-exist.txt" },
			repoRoot: worktreeRoot,
			taskId,
			runId: run.id,
			readFiles: [],
			confinementRequired: true,
		});
		expect(blockedSideEffect.result).toMatchObject({
			ok: false,
			error: { code: "RUN_WORKSPACE_HEAD_MISMATCH" },
		});
		await expect(
			fs.stat(path.join(worktreeRoot, "should-not-exist.txt")),
		).rejects.toMatchObject({ code: "ENOENT" });

		await db
			.update(repositories)
			.set({
				repositoryIdentityRevision:
					(admission.workspace.repositoryIdentityRevision ?? 0) + 1,
			})
			.where(eq(repositories.id, admission.workspace.repositoryId));
		await expect(resolveRunWorkspaceAuthority(run.id)).resolves.toMatchObject({
			ok: false,
			code: "RUN_WORKSPACE_BINDING_MISMATCH",
		});
	});

	it("accepts only digest-bound files inside the attested Task worktree", async () => {
		const admission = await attestTaskWorkspaceForRun({
			taskId,
			requireClean: true,
		});
		const run = await createTaskRun({
			taskId,
			repositoryId: admission.workspace.repositoryId,
			workspaceAuthorityKind: "task_workspace",
			workspaceId: admission.workspace.id,
			workspaceAllocationVersion: admission.workspace.allocationVersion,
			repositoryIdentityRevision:
				admission.workspace.repositoryIdentityRevision,
			admissionAttestationId: admission.attestation.id,
			admissionAttestationDigest: admission.attestation.digest,
			admittedHeadSha: admission.attestation.headSha,
			worktreePath: admission.attestation.canonicalPath,
		});
		const relativePath = "artifact.txt";
		const content = "workspace evidence\n";
		await fs.writeFile(path.join(worktreeRoot, relativePath), content);

		const artifact = await appendActivityArtifact({
			taskId,
			runId: run.id,
			kind: "workspace_file",
			path: relativePath,
			workspaceArtifactRef: {
				workspaceId: admission.workspace.id,
				allocationVersion: admission.workspace.allocationVersion,
				relativePath,
				contentDigest: digest(content),
				observedHeadSha: admission.attestation.headSha,
				source: "workspace_file",
			},
		});
		expect(artifact.metadataJson).toMatchObject({
			workspaceProvenance: {
				workspaceId: admission.workspace.id,
				relativePath,
				attestationId: admission.attestation.id,
			},
		});

		await expect(
			appendActivityArtifact({
				taskId,
				runId: run.id,
				kind: "workspace_file",
				path: "../outside.txt",
				workspaceArtifactRef: {
					workspaceId: admission.workspace.id,
					allocationVersion: admission.workspace.allocationVersion,
					relativePath: "../outside.txt",
					contentDigest: digest("outside"),
					observedHeadSha: admission.attestation.headSha,
					source: "workspace_file",
				},
			}),
		).rejects.toThrow();

		const nestedRoot = path.join(worktreeRoot, "nested");
		await fs.mkdir(nestedRoot);
		git(nestedRoot, ["init"]);
		await fs.writeFile(path.join(nestedRoot, "nested.txt"), "nested\n");
		await expect(
			appendActivityArtifact({
				taskId,
				runId: run.id,
				kind: "workspace_file",
				path: "nested/nested.txt",
				workspaceArtifactRef: {
					workspaceId: admission.workspace.id,
					allocationVersion: admission.workspace.allocationVersion,
					relativePath: "nested/nested.txt",
					contentDigest: digest("nested\n"),
					observedHeadSha: admission.attestation.headSha,
					source: "workspace_file",
				},
			}),
		).rejects.toThrow("WORKSPACE_ARTIFACT_NESTED_REPOSITORY_DENIED");
	});

	it("moves a drifted ready workspace to attention during startup reconciliation", async () => {
		await attestTaskWorkspaceForRun({ taskId, requireClean: true });
		git(worktreeRoot, ["checkout", "-b", "codex/startup-drift"]);

		const results = await reconcileTaskWorkspaceAuthorities();
		const [workspace] = await db
			.select()
			.from(taskGitWorkspaces)
			.where(eq(taskGitWorkspaces.taskId, taskId));

		expect(results).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					workspaceId: workspace.id,
					status: "attention",
					mismatchCode: "workspace_branch_mismatch",
				}),
			]),
		);
		expect(workspace.status).toBe("attention");
	});
});

function git(cwd: string, args: string[]) {
	return execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
}

function digest(value: string) {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
