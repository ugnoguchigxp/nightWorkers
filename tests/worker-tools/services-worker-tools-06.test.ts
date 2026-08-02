import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	analyzeCommand,
	gitDiffTool,
	readFileTool,
	runCheckTool,
	runCommandTool,
	runVerificationTool,
	searchFilesTool,
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
	it("never exposes Project secret files through file tools", async () => {
		await fs.writeFile(path.join(dummyRepoDir, ".env"), "API_KEY=raw-secret");
		await fs.writeFile(
			path.join(dummyRepoDir, ".env.example"),
			"API_KEY=example",
		);
		await fs.writeFile(path.join(dummyRepoDir, "config.txt"), "API_KEY=public");

		const readSecret = await readFileTool({
			filePath: ".env",
			repoRoot: dummyRepoDir,
		});
		const search = await searchFilesTool({
			query: "API_KEY",
			repoRoot: dummyRepoDir,
		});
		const readExample = await readFileTool({
			filePath: ".env.example",
			repoRoot: dummyRepoDir,
		});

		expect(readSecret.ok).toBe(false);
		expect(readSecret.error?.code).toBe("ACCESS_DENIED");
		expect(search.ok).toBe(true);
		expect(search.payload.matches.map((match) => match.filePath)).toEqual([
			"config.txt",
		]);
		expect(readExample.ok).toBe(true);
		expect(readExample.payload.content).toContain("example");
	});

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

	it("compresses large command output without persisting raw output", async () => {
		const longOutput = "x".repeat(21000);
		const result = await runCommandTool({
			command: `echo "${longOutput}"`,
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.truncated).toBe(true);
		expect(result.payload.stdout).toContain("[command-output-compressed]");
		expect(result.payload.compression?.stdout?.strategy).toBe("log_error_tail");
		expect(result.payload.logArtifactPath).toBeUndefined();
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

	it.runIf(process.platform === "darwin")(
		"confines shell reads and writes to the workspace",
		async () => {
			execFileSync("git", ["init", "-b", "main", dummyRepoDir], {
				stdio: "ignore",
			});
			await fs.writeFile(
				path.join(dummyRepoDir, "inside.txt"),
				"inside\n",
				"utf-8",
			);
			const outsidePath = path.join(
				os.tmpdir(),
				`nightworkers-confinement-${crypto.randomUUID()}.txt`,
			);
			await fs.writeFile(outsidePath, "outside\n", "utf-8");

			const inside = await runCommandTool({
				command: "cat inside.txt",
				repoRoot: dummyRepoDir,
				confinementRequired: true,
			});
			const outsideRead = await runCommandTool({
				command: `cat "${outsidePath}"`,
				repoRoot: dummyRepoDir,
				confinementRequired: true,
			});
			const outsideWrite = await runCommandTool({
				command: `echo escaped > "${outsidePath}"`,
				repoRoot: dummyRepoDir,
				confinementRequired: true,
			});

			expect(inside.ok).toBe(true);
			expect(inside.payload.stdout).toContain("inside");
			expect(outsideRead.ok).toBe(false);
			expect(outsideWrite.ok).toBe(false);
			expect(await fs.readFile(outsidePath, "utf-8")).toBe("outside\n");
			await fs.rm(outsidePath, { force: true });
		},
	);

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
		expect(result.payload.logArtifactPath).toBeUndefined();
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

	it("parses Vitest JSON even when the bare package script hides the runner", async () => {
		const report = {
			testResults: [
				{
					name: "tests/example.test.ts",
					assertionResults: [
						{
							fullName: "example passes",
							status: "passed",
						},
					],
				},
			],
		};
		await fs.writeFile(
			path.join(dummyRepoDir, "package.json"),
			JSON.stringify({
				type: "module",
				scripts: {
					test: `node -e 'console.log(JSON.stringify(${JSON.stringify(report)}))'`,
				},
			}),
			"utf-8",
		);

		const result = await runCheckTool({
			command: "test",
			checkKind: "test",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(true);
		expect(result.payload).toMatchObject({
			evidenceKinds: ["automated_test"],
			structuredCaseCount: 1,
			resolvedCaseCount: 0,
		});
	});

	it("normalizes generic and specific automated evidence independent of order", async () => {
		const report = {
			testResults: [
				{
					name: "tests/example.test.ts",
					assertionResults: [{ fullName: "example passes", status: "passed" }],
				},
			],
		};
		await fs.writeFile(
			path.join(dummyRepoDir, "package.json"),
			JSON.stringify({
				type: "module",
				scripts: {
					test: `node -e 'console.log(JSON.stringify(${JSON.stringify(report)}))'`,
				},
			}),
			"utf-8",
		);

		for (const evidenceKinds of [
			["automated_test", "unit_test"],
			["unit_test", "automated_test"],
		] as const) {
			const result = await runCheckTool({
				command: "test",
				checkKind: "test",
				repoRoot: dummyRepoDir,
				evidenceKinds: [...evidenceKinds],
			});

			expect(result.ok).toBe(true);
			expect(result.payload).toMatchObject({
				evidenceKinds: ["unit_test"],
				structuredCaseCount: 1,
			});
		}
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

	it("removes terminal controls and duplicate command errors from failed check summaries", async () => {
		await fs.writeFile(
			path.join(dummyRepoDir, "package.json"),
			JSON.stringify({
				type: "module",
				scripts: { test: "node failing-test.mjs" },
			}),
			"utf-8",
		);
		await fs.writeFile(
			path.join(dummyRepoDir, "failing-test.mjs"),
			[
				'process.stderr.write("\\u001b[31mFailed Tests 1\\u001b[39m\\n");',
				'process.stderr.write("AssertionError: expected 404 to be 201\\n");',
				"process.exit(1);",
			].join("\n"),
			"utf-8",
		);

		const result = await runCheckTool({
			command: "test",
			checkKind: "test",
			repoRoot: dummyRepoDir,
		});

		expect(result.ok).toBe(false);
		expect(result.payload.llmSummary).toContain("ERROR test");
		expect(result.payload.llmSummary).toContain("errorCode=COMMAND_FAILED");
		expect(result.payload.llmSummary).toContain("Failed Tests 1");
		expect(result.payload.llmSummary).toContain(
			"AssertionError: expected 404 to be 201",
		);
		expect(result.payload.llmSummary).not.toContain("error=Command failed:");
		expect(result.payload.llmSummary).not.toContain(String.fromCharCode(27));
		expect(result.payload.llmSummary.match(/Failed Tests 1/g)).toHaveLength(1);
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
