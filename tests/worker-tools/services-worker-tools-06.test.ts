import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	analyzeCommand,
	gitDiffTool,
	runCheckTool,
	runCommandTool,
	runVerificationTool,
} from "../../api/services/worker-tools";

let dummyRepoDir: string;

beforeEach(async () => {
	dummyRepoDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-worker-tools-"),
	);
});

afterEach(async () => {
	await fs.rm(dummyRepoDir, { recursive: true, force: true });
});

describe("Worker Tools Unit Tests", () => {
	it("blocks chained commands", async () => {
		const result = await runCommandTool({
			command: "pnpm test && rm -rf .",
			repoRoot: dummyRepoDir,
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("DESTRUCTIVE_COMMAND");
	});

	it("does not allow substring-matched build command names", () => {
		const safety = analyzeCommand("xpnpm test run tests/foo.ts");
		expect(safety.allowed).toBe(false);
		expect(safety.classification).toBe("unknown");
	});

	it("allows package verify scripts as build/test commands", () => {
		for (const command of [
			"bun run test",
			"bun run typecheck",
			"bun run lint",
			"bun run build",
			"bun run verify",
			"bun run verify:base",
			"bun verify:strict",
			"bun scripts/verify.ts",
			"pnpm run verify",
			"pnpm verify:full",
			"npm run verify",
			"yarn verify",
		]) {
			const safety = analyzeCommand(command);
			expect(safety, command).toMatchObject({
				allowed: true,
				classification: "build_test",
			});
		}
	});

	it("compresses large command output by default and stores full output as an artifact", async () => {
		const longOutput = "x".repeat(21000);
		const result = await runCommandTool({
			command: `echo "${longOutput}"`,
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.truncated).toBe(true);
		expect(result.payload.stdout).toContain("[command-output-compressed]");
		expect(result.payload.compression?.stdout?.strategy).toBe("log_error_tail");
		expect(result.payload.logArtifactPath).toBeTruthy();

		const artifact = await fs.readFile(
			result.payload.logArtifactPath as string,
			"utf-8",
		);
		expect(artifact).toContain(longOutput);
	});

	it("keeps full command output when compressionMode is explicitly off", async () => {
		const longOutput = "x".repeat(21000);
		const result = await runCommandTool({
			command: `echo "${longOutput}"`,
			compressionMode: "off",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.truncated).toBe(false);
		expect(result.payload.stdout).toContain(longOutput);
		expect(result.payload.stdout).not.toContain("[command-output-compressed]");
		expect(result.payload.logArtifactPath).toBeUndefined();
	});

	it("inherits default output compression for verification commands", async () => {
		const longOutput = "x".repeat(21000);
		const result = await runVerificationTool({
			command: `echo "${longOutput}"`,
			reason: "large verification output fixture",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.verified).toBe(true);
		expect(result.payload.truncated).toBe(true);
		expect(result.payload.stdout).toContain("OK verify");
		expect(result.payload.reason).toBe("large verification output fixture");
		expect(result.payload.logArtifactPath).toBeTruthy();
	});

	it("resolves bare run_check script names and keeps artifact paths out of the model summary", async () => {
		await fs.writeFile(
			path.join(dummyRepoDir, "package.json"),
			JSON.stringify(
				{
					type: "module",
					scripts: {
						test: "node -e \"console.log('unit ok')\"",
					},
				},
				null,
				2,
			),
			"utf-8",
		);

		const result = await runCheckTool({
			command: "test",
			checkKind: "test",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.command).toBe("bun run test");
		expect(result.payload.llmSummary).toBe("OK test\nexitCode=0");
		expect(result.payload.llmSummary).not.toContain("stdoutArtifact=");
		expect(result.payload.llmSummary).not.toContain("stderrArtifact=");
	});

	it("reports policy rejections directly instead of artifact paths", async () => {
		const result = await runCheckTool({
			command: "unknown-quality-command",
			checkKind: "test",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("DESTRUCTIVE_COMMAND");
		expect(result.payload.managedEvidence).toBe(false);
		expect(result.payload.llmSummary).toContain("ERROR test");
		expect(result.payload.llmSummary).toContain(
			"errorCode=DESTRUCTIVE_COMMAND",
		);
		expect(result.payload.llmSummary).toContain(
			"error=Unknown command is denied by default.",
		);
		expect(result.payload.llmSummary).not.toContain("stdoutArtifact=");
		expect(result.payload.llmSummary).not.toContain("stderrArtifact=");
	});
});

describe("gitDiffTool", () => {
	it("includes untracked files in diff evidence", async () => {
		const repoDir = path.join(dummyRepoDir, "git-diff-untracked");
		await fs.rm(repoDir, { recursive: true, force: true });
		await fs.mkdir(repoDir, { recursive: true });
		await fs.writeFile(path.join(repoDir, "README.md"), "# fixture\n", "utf-8");
		execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
		execFileSync("git", ["add", "README.md"], {
			cwd: repoDir,
			stdio: "ignore",
		});
		execFileSync(
			"git",
			[
				"-c",
				"user.email=e2e@example.test",
				"-c",
				"user.name=NightWorkers Test",
				"commit",
				"-m",
				"initial",
			],
			{ cwd: repoDir, stdio: "ignore" },
		);
		await fs.mkdir(path.join(repoDir, "src"), { recursive: true });
		await fs.writeFile(
			path.join(repoDir, "src/new-file.txt"),
			"untracked evidence\n",
			"utf-8",
		);

		const result = await gitDiffTool({ repoRoot: repoDir });

		expect(result.ok).toBe(true);
		expect(result.payload.hasChanges).toBe(true);
		expect(result.payload.diff).toContain("src/new-file.txt");
		expect(result.payload.diff).toContain("@@ -0,0 +1,1 @@");
		expect(result.payload.diff).toContain("+untracked evidence");
	});

	it("includes untracked files when the repository has no HEAD commit yet", async () => {
		const repoDir = path.join(dummyRepoDir, "git-diff-unborn");
		await fs.rm(repoDir, { recursive: true, force: true });
		await fs.mkdir(repoDir, { recursive: true });
		execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
		await fs.writeFile(path.join(repoDir, "README.md"), "# unborn\n", "utf-8");

		const result = await gitDiffTool({ repoRoot: repoDir });

		expect(result.ok).toBe(true);
		expect(result.payload.hasChanges).toBe(true);
		expect(result.payload.diff).toContain("README.md");
		expect(result.payload.diff).toContain("+# unborn");
	});
});
