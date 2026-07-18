import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { WorkspaceSourceSnapshot } from "../../../../shared/schemas/verification-checklist.schema";

const execFileAsync = promisify(execFile);

/** A content hash of tracked and non-ignored files, excluding Git metadata. */
export async function captureWorkspaceSourceSnapshot(
	repoRoot: string,
): Promise<WorkspaceSourceSnapshot> {
	const root = path.resolve(repoRoot);
	const files = await listWorkspaceSourceFiles(root);
	const digest = crypto.createHash("sha256");
	for (const file of files) {
		const relativePath = path.relative(root, file).split(path.sep).join("/");
		digest.update(relativePath).update("\0");
		digest.update(await fs.readFile(file));
		digest.update("\0");
	}
	return {
		sourceStateHash: digest.digest("hex"),
		gitHead: await readGitHead(root),
		fileCount: files.length,
		capturedAt: new Date().toISOString(),
	};
}

async function readGitHead(root: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
			cwd: root,
			maxBuffer: 16 * 1024,
		});
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

export async function listWorkspaceSourceFiles(
	root: string,
): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["ls-files", "-co", "--exclude-standard", "-z"],
			{ cwd: root, maxBuffer: 16 * 1024 * 1024 },
		);
		return stdout
			.split("\0")
			.filter(Boolean)
			.map((relativePath) => path.resolve(root, relativePath))
			.filter(
				(filePath) =>
					filePath.startsWith(`${root}${path.sep}`) || filePath === root,
			)
			.sort();
	} catch {
		// A registered repository can be non-Git (for example an imported local
		// directory). Fall back to all non-runtime files in that case.
	}
	const files: string[] = [];
	async function visit(directory: string) {
		const entries = await fs.readdir(directory, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name === ".git" || entry.name === "node_modules") continue;
			const fullPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				await visit(fullPath);
			} else if (entry.isFile()) {
				files.push(fullPath);
			}
		}
	}
	await visit(root);
	return files.sort();
}
