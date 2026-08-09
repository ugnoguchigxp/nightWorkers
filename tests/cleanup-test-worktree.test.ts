import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeDedicatedTestWorkspace } from "../api/scripts/test-worktree-cleanup";
import { requireVitestWorkspaceRoot } from "./vitest-db-env";

const disposableRoots: string[] = [];

afterEach(() => {
	for (const root of disposableRoots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function git(repositoryRoot: string, args: string[]) {
	return execFileSync("git", ["-C", repositoryRoot, ...args], {
		encoding: "utf8",
	}).trim();
}

function createFixture() {
	const workspaceRoot = requireVitestWorkspaceRoot();
	const repositoryRoot = fs.mkdtempSync(
		path.join(workspaceRoot, "nightworkers-cleanup-test-"),
	);
	const worktreeRoot = `${repositoryRoot}-worktrees`;
	const worktreePath = path.join(worktreeRoot, "cleanup-test");
	disposableRoots.push(repositoryRoot, worktreeRoot);
	git(repositoryRoot, ["init", "--initial-branch=main"]);
	fs.writeFileSync(path.join(repositoryRoot, "README.md"), "# fixture\n");
	git(repositoryRoot, ["add", "README.md"]);
	git(repositoryRoot, [
		"-c",
		"core.hooksPath=/dev/null",
		"-c",
		"user.name=NightWorkers Test",
		"-c",
		"user.email=nightworkers@example.test",
		"commit",
		"-m",
		"fixture",
	]);
	git(repositoryRoot, [
		"worktree",
		"add",
		"-b",
		"nightworkers/cleanup-test",
		worktreePath,
		"main",
	]);
	return { repositoryRoot, worktreePath };
}

function workspaceRecord(repositoryRoot: string, worktreePath: string) {
	return {
		worktreePath,
		repositoryRoot,
		repositoryLocalPath: repositoryRoot,
		sourceBranch: "nightworkers/cleanup-test",
		sourceRef: "refs/heads/nightworkers/cleanup-test",
		targetBranch: "main",
	};
}

describe("dedicated test worktree cleanup", () => {
	it("rejects an empty recorded worktree path", () => {
		expect(() =>
			removeDedicatedTestWorkspace({
				worktreePath: " ",
				repositoryRoot: null,
				repositoryLocalPath: "/tmp/repository",
				sourceBranch: "nightworkers/cleanup-test",
				sourceRef: "refs/heads/nightworkers/cleanup-test",
				targetBranch: "main",
			}),
		).toThrow("workspace path is required");
	});

	it("removes the owned worktree and its branch", () => {
		const fixture = createFixture();

		removeDedicatedTestWorkspace(
			workspaceRecord(fixture.repositoryRoot, fixture.worktreePath),
		);

		expect(fs.existsSync(fixture.worktreePath)).toBe(false);
		expect(
			git(fixture.repositoryRoot, ["worktree", "list", "--porcelain"]),
		).not.toContain(fixture.worktreePath);
		expect(
			spawnSync("git", [
				"-C",
				fixture.repositoryRoot,
				"show-ref",
				"--verify",
				"--quiet",
				"refs/heads/nightworkers/cleanup-test",
			]).status,
		).toBe(1);
	});

	it("refuses inconsistent ownership metadata before deleting anything", () => {
		const fixture = createFixture();
		const record = workspaceRecord(
			fixture.repositoryRoot,
			fixture.worktreePath,
		);

		expect(() =>
			removeDedicatedTestWorkspace({
				...record,
				sourceRef: "refs/heads/unrelated",
			}),
		).toThrow("source ref is inconsistent");
		expect(fs.existsSync(fixture.worktreePath)).toBe(true);
	});

	it("refuses to delete a branch outside the NightWorkers namespace", () => {
		const fixture = createFixture();
		const record = workspaceRecord(
			fixture.repositoryRoot,
			fixture.worktreePath,
		);

		expect(() =>
			removeDedicatedTestWorkspace({
				...record,
				sourceBranch: "feature/user-owned",
				sourceRef: "refs/heads/feature/user-owned",
			}),
		).toThrow("branch is not NightWorkers-owned");
		expect(fs.existsSync(fixture.worktreePath)).toBe(true);
	});

	it("still removes the owned branch when the worktree is already gone", () => {
		const fixture = createFixture();
		git(fixture.repositoryRoot, [
			"worktree",
			"remove",
			"--force",
			fixture.worktreePath,
		]);

		removeDedicatedTestWorkspace(
			workspaceRecord(fixture.repositoryRoot, fixture.worktreePath),
		);

		expect(
			spawnSync("git", [
				"-C",
				fixture.repositoryRoot,
				"show-ref",
				"--verify",
				"--quiet",
				"refs/heads/nightworkers/cleanup-test",
			]).status,
		).toBe(1);
	});

	it("refuses to delete a branch checked out by a different worktree", () => {
		const fixture = createFixture();
		const missingRecordedPath = path.join(
			path.dirname(fixture.worktreePath),
			"stale-recorded-path",
		);

		expect(() =>
			removeDedicatedTestWorkspace(
				workspaceRecord(fixture.repositoryRoot, missingRecordedPath),
			),
		).toThrow("branch belongs to a different Git worktree");
		expect(fs.existsSync(fixture.worktreePath)).toBe(true);
		expect(
			spawnSync("git", [
				"-C",
				fixture.repositoryRoot,
				"show-ref",
				"--verify",
				"--quiet",
				"refs/heads/nightworkers/cleanup-test",
			]).status,
		).toBe(0);
	});

	it("refuses to remove a recorded path owned by another branch", () => {
		const fixture = createFixture();
		const record = workspaceRecord(
			fixture.repositoryRoot,
			fixture.worktreePath,
		);

		expect(() =>
			removeDedicatedTestWorkspace({
				...record,
				sourceBranch: "nightworkers/different",
				sourceRef: "refs/heads/nightworkers/different",
			}),
		).toThrow("path belongs to a different Git branch");
		expect(fs.existsSync(fixture.worktreePath)).toBe(true);
	});

	it("refuses cleanup outside the authorized isolated run root", () => {
		const fixture = createFixture();
		const authorizedRoot = path.join(fixture.repositoryRoot, "isolated-run");
		fs.mkdirSync(authorizedRoot);

		expect(() =>
			removeDedicatedTestWorkspace(
				workspaceRecord(fixture.repositoryRoot, fixture.worktreePath),
				{ authorizedRoot },
			),
		).toThrow("repository root is outside its run root");
		expect(fs.existsSync(fixture.worktreePath)).toBe(true);
	});
});
