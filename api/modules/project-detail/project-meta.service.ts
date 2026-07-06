import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	type ProjectFileScale,
	type ProjectMeta,
	projectMetaSchema,
} from "../../../shared/schemas/project-detail.schema";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";

const execFileAsync = promisify(execFile);

const IGNORED_SEGMENTS = new Set([
	".git",
	"node_modules",
	"coverage",
	"dist",
	"dist-web",
	"build",
	".next",
	".turbo",
	".cache",
	"playwright-report",
	"test-results",
	"vendor",
]);

const SOURCE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
	".py",
	".rs",
	".go",
	".java",
	".kt",
	".swift",
	".php",
	".rb",
	".cs",
	".c",
	".cc",
	".cpp",
	".h",
	".hpp",
	".css",
	".scss",
	".html",
	".svelte",
	".vue",
]);

const TEST_PATH_PATTERN =
	/(^|\/)(__tests__|tests?|spec|e2e)(\/|$)|\.(test|spec)\.[^.]+$/i;

type RepositoryWithProjectMeta = {
	id: string;
	localPath: string;
	projectMeta?: unknown;
};

type GitHeadSnapshot = {
	head: string | null;
	shortHead: string | null;
	displayHead: string | null;
	committedAt: string | null;
	status: "available" | "unavailable";
};

export async function getFreshProjectMeta(
	repository: RepositoryWithProjectMeta,
): Promise<ProjectMeta | null> {
	const currentGit = await readGitHead(repository.localPath);
	const cached = parseStoredProjectMeta(repository.projectMeta);
	if (
		cached &&
		currentGit.status === "available" &&
		cached.git.status === "available" &&
		cached.git.head === currentGit.head
	) {
		return cached;
	}
	if (cached && currentGit.status === "unavailable") return cached;

	const scanned = await scanProjectMeta(repository.localPath, currentGit);
	await nightworkersRepo.updateRepositoryProjectMeta(repository.id, scanned);
	return scanned;
}

function parseStoredProjectMeta(value: unknown) {
	const parsed = projectMetaSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

async function scanProjectMeta(
	repoRoot: string,
	git: GitHeadSnapshot,
): Promise<ProjectMeta> {
	const startedAt = Date.now();
	const files = await listProjectFiles(repoRoot, git.status === "available");
	const sourceFiles = files.filter(isSourceFile);
	const tests = sourceFiles.filter((filePath) =>
		TEST_PATH_PATTERN.test(filePath),
	);
	const [sourceLoc, ontologyModuleCount] = await Promise.all([
		countSourceLines(repoRoot, sourceFiles),
		countOntologyModules(repoRoot),
	]);
	const score = calculateFileScore({
		totalFiles: files.length,
		sourceFiles: sourceFiles.length,
		sourceLoc,
	});
	return {
		version: 1,
		scannedAt: new Date().toISOString(),
		scanDurationMs: Date.now() - startedAt,
		git,
		files: {
			total: files.length,
			source: sourceFiles.length,
			tests: tests.length,
			sourceLoc,
		},
		ontology: {
			moduleCount: ontologyModuleCount,
			available: ontologyModuleCount > 0,
		},
		fileScale: {
			value: classifyFileScale(score),
			score,
		},
	};
}

async function readGitHead(repoRoot: string): Promise<GitHeadSnapshot> {
	const head = await git(repoRoot, ["rev-parse", "HEAD"]);
	if (!head) {
		return {
			head: null,
			shortHead: null,
			displayHead: null,
			committedAt: null,
			status: "unavailable",
		};
	}
	const committedAt = await git(repoRoot, [
		"show",
		"-s",
		"--format=%cI",
		"HEAD",
	]);
	const shortHead = head.slice(0, 10);
	return {
		head,
		shortHead,
		displayHead: `${shortHead}...`,
		committedAt: committedAt || null,
		status: "available",
	};
}

async function listProjectFiles(repoRoot: string, useGit: boolean) {
	if (useGit) {
		const output = await git(repoRoot, ["ls-files", "-z"]);
		if (output) {
			return output
				.split("\0")
				.map((filePath) => filePath.trim())
				.filter(Boolean)
				.filter((filePath) => !isIgnoredPath(filePath))
				.sort();
		}
	}
	return listFilesystemFiles(repoRoot);
}

async function listFilesystemFiles(repoRoot: string) {
	const files: string[] = [];
	async function visit(current: string, depth: number) {
		if (depth > 8 || files.length >= 20_000) return;
		let entries: Dirent<string>[];
		try {
			entries = await fs.readdir(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (IGNORED_SEGMENTS.has(entry.name)) continue;
			const fullPath = path.join(current, entry.name);
			const relativePath = path.relative(repoRoot, fullPath);
			if (entry.isDirectory()) {
				await visit(fullPath, depth + 1);
				continue;
			}
			if (entry.isFile() && !isIgnoredPath(relativePath))
				files.push(relativePath);
		}
	}
	await visit(repoRoot, 0);
	return files.sort();
}

async function countSourceLines(repoRoot: string, sourceFiles: string[]) {
	let total = 0;
	for (const filePath of sourceFiles) {
		try {
			const fullPath = path.join(repoRoot, filePath);
			const stat = await fs.stat(fullPath);
			if (!stat.isFile() || stat.size > 1_000_000) continue;
			const text = await fs.readFile(fullPath, "utf8");
			total += text.length === 0 ? 0 : text.split("\n").length;
		} catch {
		}
	}
	return total;
}

async function countOntologyModules(repoRoot: string) {
	const indexPath = path.join(repoRoot, ".agent-ontology", "modules.yaml");
	try {
		const parsed = JSON.parse(await fs.readFile(indexPath, "utf8")) as {
			modules?: unknown;
		};
		if (Array.isArray(parsed.modules)) return parsed.modules.length;
	} catch {
		// Fall through to file-count fallback for non-JSON YAML.
	}
	try {
		const entries = await fs.readdir(
			path.join(repoRoot, ".agent-ontology", "modules"),
		);
		return entries.filter((entry) => /\.(ya?ml|json)$/i.test(entry)).length;
	} catch {
		return 0;
	}
}

function isSourceFile(filePath: string) {
	return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isIgnoredPath(filePath: string) {
	return filePath
		.split(/[\\/]/)
		.some((segment) => IGNORED_SEGMENTS.has(segment));
}

function calculateFileScore(input: {
	totalFiles: number;
	sourceFiles: number;
	sourceLoc: number;
}) {
	return Math.max(
		input.totalFiles,
		input.sourceFiles * 2,
		Math.ceil(input.sourceLoc / 100),
	);
}

function classifyFileScale(score: number): ProjectFileScale {
	if (score >= 4_000) return "huge";
	if (score >= 1_600) return "large";
	if (score >= 500) return "medium";
	if (score >= 120) return "small";
	return "tiny";
}

async function git(repoRoot: string, args: string[]) {
	try {
		const result = await execFileAsync("git", ["-C", repoRoot, ...args], {
			encoding: "utf8",
			timeout: 3000,
			maxBuffer: 8_000_000,
		});
		return String(result.stdout).trim();
	} catch {
		return "";
	}
}
