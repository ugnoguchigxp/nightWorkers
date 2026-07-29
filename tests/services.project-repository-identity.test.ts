import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectProjectRepositoryIdentity } from "../api/services/git/project-repository-identity";

const cleanupPaths: string[] = [];

afterEach(async () => {
	for (const cleanupPath of cleanupPaths.splice(0)) {
		await fs.rm(cleanupPath, { recursive: true, force: true });
	}
});

describe("project repository identity", () => {
	it("records the canonical Git top-level and primary worktree identity", async () => {
		const root = await createGitRepository();
		const identity = await inspectProjectRepositoryIdentity(root);

		expect(identity).toMatchObject({
			repositoryKind: "git",
			status: "ready",
			registeredRootCanonical: await fs.realpath(root),
			baseWorktreePathCanonical: await fs.realpath(root),
			observedBranch: "main",
			baseWorktreeDirty: false,
			failureCode: null,
		});
		expect(identity.gitCommonDirCanonical).toBe(
			await fs.realpath(path.join(root, ".git")),
		);
		expect(identity.baseWorktreeId).toMatch(/^sha256:/);
		expect(identity.digest).toMatch(/^sha256:/);
		expect(identity.observedHeadSha).toMatch(/^[0-9a-f]{40,64}$/);
	});

	it("does not accept a repository subdirectory as the registered root", async () => {
		const root = await createGitRepository();
		const subdirectory = path.join(root, "src");
		await fs.mkdir(subdirectory);

		const identity = await inspectProjectRepositoryIdentity(subdirectory);

		expect(identity.status).toBe("invalid");
		expect(identity.failureCode).toBe("project_root_not_git_toplevel");
	});

	it("does not accept a symlink alias as the registered root", async () => {
		const root = await createGitRepository();
		const alias = `${root}-alias`;
		cleanupPaths.push(alias);
		await fs.symlink(root, alias);

		const identity = await inspectProjectRepositoryIdentity(alias);

		expect(identity.status).toBe("invalid");
		expect(identity.failureCode).toBe("project_root_symlink_alias");
	});

	it("separates non-Git directories as materialization pending", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "nw-non-git-"));
		cleanupPaths.push(root);

		const identity = await inspectProjectRepositoryIdentity(root);

		expect(identity).toMatchObject({
			repositoryKind: "non_git",
			status: "materialization_pending",
			gitCommonDirCanonical: null,
			baseWorktreeId: null,
			failureCode: "not_git_repository",
		});
	});
});

async function createGitRepository() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "nw-git-identity-"));
	cleanupPaths.push(root);
	execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" });
	await fs.writeFile(path.join(root, "README.md"), "# fixture\n", "utf-8");
	execFileSync("git", ["-C", root, "add", "README.md"], { stdio: "ignore" });
	execFileSync(
		"git",
		[
			"-C",
			root,
			"-c",
			"user.name=NightWorkers Test",
			"-c",
			"user.email=nightworkers@example.test",
			"commit",
			"-m",
			"fixture",
		],
		{ stdio: "ignore" },
	);
	return root;
}
