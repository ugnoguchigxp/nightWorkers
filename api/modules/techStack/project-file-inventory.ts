import { execFile } from "node:child_process";
import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ProjectCodeSizeSkipSummary } from "../../../shared/schemas/tech-stack.schema";
import { ValidationError } from "../../lib/errors";
import { isSupportedSourcePath } from "./effective-line-counter";

const execFileAsync = promisify(execFile);
const MAX_FILES = 50_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const IGNORED_SEGMENTS = new Set([
	".git",
	"node_modules",
	"coverage",
	"coverage-backend",
	"dist",
	"dist-web",
	"dist-api",
	"dist-api-desktop",
	"build",
	"out",
	".next",
	".nuxt",
	".svelte-kit",
	".turbo",
	".cache",
	"playwright-report",
	"test-results",
	"vendor",
	"target",
	"DerivedData",
]);

export type ProjectFileCandidate = {
	relativePath: string;
	fullPath: string;
};

export type ProjectFileInventory = {
	source: "git" | "filesystem";
	listedFiles: number;
	candidates: ProjectFileCandidate[];
	skipped: ProjectCodeSizeSkipSummary;
};

function emptySkipped(): ProjectCodeSizeSkipSummary {
	return {
		unsupportedExtension: 0,
		generatedPath: 0,
		tooLarge: 0,
		binary: 0,
		symlink: 0,
		missing: 0,
		unreadable: 0,
	};
}

function isGeneratedPath(filePath: string) {
	return filePath
		.split(/[\\/]/)
		.some((segment) => IGNORED_SEGMENTS.has(segment));
}

async function gitFiles(repoRoot: string): Promise<string[] | null> {
	try {
		const result = await execFileAsync(
			"git",
			["-C", repoRoot, "ls-files", "-co", "--exclude-standard", "-z"],
			{
				encoding: "utf8",
				timeout: 5000,
				maxBuffer: 32 * 1024 * 1024,
			},
		);
		return String(result.stdout).split("\0").filter(Boolean).sort();
	} catch {
		return null;
	}
}

async function filesystemFiles(repoRoot: string) {
	const files: string[] = [];
	let symlinks = 0;
	let unreadable = 0;
	let listedFiles = 0;
	let limitExceeded = false;
	async function visit(current: string) {
		if (limitExceeded) return;
		let entries: Dirent<string>[];
		try {
			entries = await fs.readdir(current, { withFileTypes: true });
		} catch {
			unreadable += 1;
			return;
		}
		for (const entry of entries) {
			if (limitExceeded) return;
			if (IGNORED_SEGMENTS.has(entry.name)) continue;
			const fullPath = path.join(current, entry.name);
			if (entry.isSymbolicLink()) {
				listedFiles += 1;
				symlinks += 1;
				if (listedFiles > MAX_FILES) limitExceeded = true;
				continue;
			}
			if (entry.isDirectory()) await visit(fullPath);
			else if (entry.isFile()) {
				listedFiles += 1;
				files.push(path.relative(repoRoot, fullPath));
			}
			if (listedFiles > MAX_FILES) limitExceeded = true;
		}
	}
	await visit(repoRoot);
	return {
		files: files.sort(),
		listedFiles,
		symlinks,
		unreadable,
		limitExceeded,
	};
}

async function isBinary(fullPath: string) {
	const handle = await fs.open(fullPath, "r");
	try {
		const buffer = Buffer.alloc(8192);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		return buffer.subarray(0, bytesRead).includes(0);
	} finally {
		await handle.close();
	}
}

export async function listProjectFileCandidates(
	repositoryRoot: string,
): Promise<ProjectFileInventory> {
	const repoRoot = path.resolve(repositoryRoot);
	const rootStat = await fs.stat(repoRoot).catch(() => null);
	if (!rootStat?.isDirectory()) {
		throw new ValidationError("Repository path is not a readable directory");
	}
	const fromGit = await gitFiles(repoRoot);
	const source = fromGit ? "git" : "filesystem";
	const filesystemInventory = fromGit ? null : await filesystemFiles(repoRoot);
	const files = fromGit ?? filesystemInventory?.files ?? [];
	const listedFiles = fromGit
		? files.length
		: (filesystemInventory?.listedFiles ?? 0);
	if (files.length > MAX_FILES || filesystemInventory?.limitExceeded) {
		throw new ValidationError("Project file limit exceeded", {
			limit: MAX_FILES,
			listedFiles,
		});
	}

	const skipped = emptySkipped();
	if (filesystemInventory) {
		skipped.symlink = filesystemInventory.symlinks;
		skipped.unreadable = filesystemInventory.unreadable;
	}
	const candidates: ProjectFileCandidate[] = [];
	for (const rawPath of files) {
		const relativePath = rawPath.replaceAll("\\", "/").replace(/^\.\//, "");
		if (isGeneratedPath(relativePath)) {
			skipped.generatedPath += 1;
			continue;
		}
		if (!isSupportedSourcePath(relativePath)) {
			skipped.unsupportedExtension += 1;
			continue;
		}
		const fullPath = path.resolve(repoRoot, relativePath);
		if (
			fullPath !== repoRoot &&
			!fullPath.startsWith(`${repoRoot}${path.sep}`)
		) {
			skipped.unreadable += 1;
			continue;
		}
		let stat: Stats;
		try {
			stat = await fs.lstat(fullPath);
		} catch {
			skipped.missing += 1;
			continue;
		}
		if (stat.isSymbolicLink()) {
			skipped.symlink += 1;
			continue;
		}
		if (!stat.isFile()) {
			skipped.missing += 1;
			continue;
		}
		if (stat.size > MAX_FILE_BYTES) {
			skipped.tooLarge += 1;
			continue;
		}
		try {
			if (await isBinary(fullPath)) {
				skipped.binary += 1;
				continue;
			}
		} catch {
			skipped.unreadable += 1;
			continue;
		}
		candidates.push({ relativePath, fullPath });
	}

	return { source, listedFiles, candidates, skipped };
}
