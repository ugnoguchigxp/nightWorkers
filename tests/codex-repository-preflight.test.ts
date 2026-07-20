import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectCodexRepositoryPreflight } from "../api/modules/codingAgent/runtime/codex-repository-preflight";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await fs.rm(root, { recursive: true, force: true });
	}
});

describe("Codex repository preflight", () => {
	it("records pwd, ls, Git HEAD, and the import template registry", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-preflight-"));
		roots.push(root);
		await fs.writeFile(path.join(root, "README.md"), "# project\n", "utf8");
		execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
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

		const result = await inspectCodexRepositoryPreflight({
			repositoryRoot: root,
			materialization: { status: "ready", kind: "starter_template" },
		});

		expect(result.ready).toBe(true);
		expect(result.workingDirectory.resolved).toBe(await fs.realpath(root));
		expect(result.directoryEntries).toContain("README.md");
		expect(result.directoryEntryPage).toMatchObject({
			offset: 0,
			limit: 200,
			total: expect.any(Number),
			hasMore: false,
			digest: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		expect(result.gitHead).toMatch(/^[0-9a-f]{40}$/);
		expect(result.importTemplateRegistry.starterStacks).toContain("hono");
		expect(result.checks.every((check) => check.status === "passed")).toBe(
			true,
		);
	});

	it("does not allow provider execution without a baseline Git HEAD", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-preflight-"));
		roots.push(root);

		const result = await inspectCodexRepositoryPreflight({
			repositoryRoot: root,
			materialization: { status: "not_configured" },
		});

		expect(result.ready).toBe(false);
		expect(result.gitHead).toBeNull();
		expect(result.checks).toContainEqual({
			name: "git_head",
			status: "failed",
		});
	});

	it("pages large root listings without losing total and digest", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-preflight-"));
		roots.push(root);
		await Promise.all(
			Array.from({ length: 205 }, (_, index) =>
				fs.writeFile(
					path.join(root, `entry-${String(index).padStart(3, "0")}.txt`),
					"",
				),
			),
		);

		const result = await inspectCodexRepositoryPreflight({
			repositoryRoot: root,
			materialization: { status: "not_configured" },
		});

		expect(result.directoryEntries).toHaveLength(200);
		expect(result.directoryEntryPage).toMatchObject({
			total: 205,
			hasMore: true,
			digest: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
	});
});
