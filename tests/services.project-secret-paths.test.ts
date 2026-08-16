import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
	commandArgumentsReferenceProjectSecret,
	isProjectSecretPath,
	listExistingProjectSecretPaths,
	listTrackedProjectSecretPaths,
} from "../api/services/security/project-secret-paths";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

describe("Project secret path boundary", () => {
	it("excludes examples but identifies tracked secret files without reading them", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "nw-secret-paths-"));
		temporaryRoots.push(root);
		await execFileAsync("git", ["init", root]);
		await fs.writeFile(path.join(root, ".env"), "SECRET=must-not-be-read\n");
		await fs.writeFile(path.join(root, ".env.example"), "SECRET=example\n");
		await fs.writeFile(path.join(root, "credentials.json"), "{}\n");
		await execFileAsync("git", [
			"-C",
			root,
			"add",
			".env",
			".env.example",
			"credentials.json",
		]);

		expect(isProjectSecretPath(".env.example")).toBe(false);
		await expect(listTrackedProjectSecretPaths(root)).resolves.toEqual([
			".env",
			"credentials.json",
		]);
	});

	it("finds untracked secret files and denies aliases without reading contents", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "nw-secret-paths-"));
		const outside = await fs.mkdtemp(
			path.join(os.tmpdir(), "nw-secret-outside-"),
		);
		temporaryRoots.push(root, outside);
		await fs.writeFile(path.join(root, ".env.local"), "fixture-content\n");
		await fs.writeFile(path.join(root, "regular.txt"), "safe\n");
		await fs.writeFile(path.join(outside, "external.txt"), "outside\n");
		await fs.symlink(".env.local", path.join(root, "secret-alias"));
		await fs.symlink(
			path.join(outside, "external.txt"),
			path.join(root, "outside-alias"),
		);

		const canonicalRoot = await fs.realpath(root);
		const existing = await listExistingProjectSecretPaths(root);
		expect(existing).toEqual(
			expect.arrayContaining([
				path.join(canonicalRoot, ".env.local"),
				path.join(canonicalRoot, "secret-alias"),
				path.join(canonicalRoot, "outside-alias"),
			]),
		);
		for (const args of [
			[".env.local"],
			[path.join(root, ".env.local")],
			["secret-alias"],
			["outside-alias"],
			["--config=.env.local"],
		]) {
			await expect(
				commandArgumentsReferenceProjectSecret({
					args,
					repositoryRoot: root,
					cwd: root,
				}),
			).resolves.toBe(true);
		}
		await expect(
			commandArgumentsReferenceProjectSecret({
				args: ["regular.txt"],
				repositoryRoot: root,
				cwd: root,
			}),
		).resolves.toBe(false);
	});
});
