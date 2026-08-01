import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRunCheckRunner } from "../api/services/worker-tools/run-check";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await fs.rm(directory, { recursive: true, force: true });
	}
});

describe("run_check runner resolution", () => {
	it("infers Vitest from a symbolic package script command", async () => {
		const repoRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "run-check-runner-"),
		);
		temporaryDirectories.push(repoRoot);
		await fs.writeFile(
			path.join(repoRoot, "package.json"),
			JSON.stringify({ scripts: { test: "vitest run --reporter=json" } }),
		);

		await expect(
			resolveRunCheckRunner(
				{ command: "test", checkKind: "test", repoRoot },
				"bun run test",
			),
		).resolves.toBe("vitest");
	});

	it("keeps an explicit runner hint authoritative", async () => {
		await expect(
			resolveRunCheckRunner(
				{
					command: "test",
					checkKind: "test",
					repoRoot: process.cwd(),
					runnerHint: "jest",
				},
				"bun run test",
			),
		).resolves.toBe("jest");
	});
});
