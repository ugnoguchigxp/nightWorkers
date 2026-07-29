import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
	isProjectSecretPath,
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
});
