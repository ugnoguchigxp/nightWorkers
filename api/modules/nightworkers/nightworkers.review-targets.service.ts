import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NotFoundError } from "../../lib/errors";
import { changedFilesFromDiff } from "../../services/agent-runtime/codex-runtime-support";
import { canonicalizeTaskEvent } from "../../services/run-events/canonicalize";
import * as repo from "./nightworkers.repository";
import type {
	ReviewTarget,
	ReviewTargetFile,
	ReviewTargetWarning,
} from "./nightworkers.review-mode.model";
import { parseChangedPathsFromDiff } from "./run-orchestration/git-ownership";
import { toErrorMessage } from "./run-orchestration/utils";

const execFileAsync = promisify(execFile);
const TARGET_FILE_LIMIT = 80;

type TargetAccumulator = {
	path: string;
	sources: Set<ReviewTargetFile["sources"][number]>;
	eventIds: Set<string>;
};

export async function buildReviewTarget(input: {
	runId: string;
}): Promise<ReviewTarget> {
	const run = await repo.getTaskRun(input.runId);
	if (!run) throw new NotFoundError("Run not found");
	const task = await repo.getTask(run.taskId);
	const repositoryId = run.repositoryId || task?.repositoryId;
	if (!repositoryId) throw new NotFoundError("Repository not found for run");
	const repository = await repo.getRepository(repositoryId);
	if (!repository?.localPath) throw new NotFoundError("Repository not found");
	const repoRoot = path.resolve(repository.localPath);
	const events = await repo.listTaskEventsForRun(input.runId);
	const accumulators = new Map<string, TargetAccumulator>();
	const warnings: ReviewTargetWarning[] = [];

	for (const row of events) {
		const event = canonicalizeTaskEvent(row, run);
		if (event.type !== "git.diff_collected") continue;
		const data = isRecord(event.data) ? event.data : {};
		for (const filePath of extractPathsFromDiffEvent(data)) {
			const normalized = normalizeRepoRelativePath(repoRoot, filePath);
			if (!normalized) continue;
			const source = resolveDiffEventSource(data);
			const item = ensureAccumulator(accumulators, normalized);
			item.sources.add(source);
			if (event.id) item.eventIds.add(event.id);
		}
	}

	for (const filePath of parseChangedPathsFromDiff(run.diffPatch)) {
		const normalized = normalizeRepoRelativePath(repoRoot, filePath);
		if (!normalized) continue;
		ensureAccumulator(accumulators, normalized).sources.add("run_diff_patch");
	}

	if (accumulators.size === 0) {
		warnings.push({
			code: "no_edit_signals",
			severity: "warning",
			message:
				"No run edit signals were found for Review Run target extraction.",
		});
	}
	if (accumulators.size > TARGET_FILE_LIMIT) {
		warnings.push({
			code: "target_file_limit_exceeded",
			severity: "blocking",
			message: `Review target extraction found more than ${TARGET_FILE_LIMIT} files.`,
			paths: [...accumulators.keys()].slice(TARGET_FILE_LIMIT),
		});
	}

	let dirtyFiles: Array<{ path: string; status: ReviewTargetFile["status"] }> =
		[];
	try {
		dirtyFiles = await readCurrentDirtyFiles(repoRoot);
	} catch (error) {
		warnings.push({
			code: "diff_read_failed",
			severity: "blocking",
			message: `Could not read current git status: ${toErrorMessage(error)}`,
		});
	}
	const dirtyByPath = new Map(dirtyFiles.map((file) => [file.path, file]));
	const targetFiles: ReviewTargetFile[] = [];
	const signalOnlyFiles: string[] = [];

	for (const item of [...accumulators.values()].sort((a, b) =>
		a.path.localeCompare(b.path),
	)) {
		const dirty = dirtyByPath.get(item.path);
		if (!dirty) {
			signalOnlyFiles.push(item.path);
			continue;
		}
		let diff = "";
		try {
			diff = await readCurrentDiffForPath(repoRoot, item.path, dirty.status);
		} catch (error) {
			warnings.push({
				code: "diff_read_failed",
				severity: "warning",
				message: `Could not read current diff for ${item.path}: ${toErrorMessage(error)}`,
				paths: [item.path],
			});
		}
		item.sources.add("current_git_diff");
		targetFiles.push({
			path: item.path,
			status: dirty.status,
			sources: [...item.sources],
			eventIds: [...item.eventIds],
			diff,
			diffBytes: Buffer.byteLength(diff, "utf8"),
		});
	}

	const signalPaths = new Set(accumulators.keys());
	const diffOnlyFiles = dirtyFiles
		.map((file) => file.path)
		.filter((filePath) => !signalPaths.has(filePath))
		.sort();
	if (signalOnlyFiles.length > 0) {
		warnings.push({
			code: "edit_signal_without_current_diff",
			severity: "info",
			message: "Some run edit signals no longer have current dirty diffs.",
			paths: signalOnlyFiles,
		});
	}
	if (diffOnlyFiles.length > 0) {
		warnings.push({
			code: "current_diff_without_edit_signal",
			severity: "warning",
			message: "Current dirty files without run edit signals were excluded.",
			paths: diffOnlyFiles,
		});
	}

	const planArtifact = await findLatestPlanArtifact(run.taskId);
	if (!planArtifact) {
		warnings.push({
			code: "plan_artifact_missing",
			severity: "warning",
			message: "Plan specification was not found for review.",
		});
	}

	return {
		runId: run.id,
		taskId: run.taskId,
		repositoryId,
		repoRoot,
		planArtifact: planArtifact
			? {
					messageId: planArtifact.id,
					title: planArtifact.title,
					source: "plan_artifact",
				}
			: { messageId: null, title: null, source: "missing" },
		targetFiles,
		excludedDirtyFiles: diffOnlyFiles,
		signalOnlyFiles,
		diffOnlyFiles,
		warnings,
	};
}

export async function findLatestPlanArtifact(taskId: string): Promise<{
	id: string;
	title: string | null;
	body: string;
} | null> {
	const messages = await repo.listTaskMessages(taskId);
	for (const message of [...messages].reverse()) {
		if (message.messageType !== "markdown_document") continue;
		const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
		const intent = metadata.intent;
		if (intent !== "implementation_plan" && intent !== "feature_plan") continue;
		return {
			id: message.id,
			title:
				typeof metadata.title === "string"
					? metadata.title
					: firstMarkdownHeading(message.content),
			body: message.content,
		};
	}
	return null;
}

function extractPathsFromDiffEvent(data: Record<string, unknown>) {
	const paths = new Set<string>();
	for (const pathValue of readStringArray(data.changedFiles))
		paths.add(pathValue);
	if (Array.isArray(data.changes)) {
		for (const change of data.changes) {
			if (!isRecord(change)) continue;
			if (typeof change.path === "string") paths.add(change.path);
			if (typeof change.file === "string") paths.add(change.file);
		}
	}
	if (typeof data.diff === "string") {
		for (const pathValue of changedFilesFromDiff(data.diff))
			paths.add(pathValue);
	}
	return [...paths];
}

function resolveDiffEventSource(
	data: Record<string, unknown>,
): ReviewTargetFile["sources"][number] {
	const provider = typeof data.provider === "string" ? data.provider : "";
	const source = typeof data.source === "string" ? data.source : "";
	if (provider === "codex" || source.includes("codex")) {
		return "codex_file_change";
	}
	if (source.includes("tool")) return "native_tool_edit";
	return "post_run_git_diff";
}

function ensureAccumulator(
	map: Map<string, TargetAccumulator>,
	filePath: string,
) {
	let item = map.get(filePath);
	if (!item) {
		item = { path: filePath, sources: new Set(), eventIds: new Set() };
		map.set(filePath, item);
	}
	return item;
}

function normalizeRepoRelativePath(repoRoot: string, value: string) {
	const raw = value.trim().replaceAll("\\", "/");
	if (!raw || raw.includes("\0")) return null;
	const withoutPrefixes = raw
		.replace(/^a\//, "")
		.replace(/^b\//, "")
		.replace(/^"\s*/, "")
		.replace(/\s*"$/, "");
	const absolute = path.isAbsolute(withoutPrefixes)
		? path.resolve(withoutPrefixes)
		: path.resolve(repoRoot, withoutPrefixes);
	if (absolute !== repoRoot && !absolute.startsWith(`${repoRoot}${path.sep}`)) {
		return null;
	}
	return path.relative(repoRoot, absolute).split(path.sep).join("/");
}

async function readCurrentDirtyFiles(repoRoot: string) {
	const result = await execFileAsync(
		"git",
		["status", "--porcelain=v1", "--untracked-files=all", "-z"],
		{
			cwd: repoRoot,
			maxBuffer: 10 * 1024 * 1024,
		},
	);
	const files: Array<{ path: string; status: ReviewTargetFile["status"] }> = [];
	const tokens = result.stdout.split("\0").filter(Boolean);
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index] ?? "";
		const statusCode = token.slice(0, 2);
		const filePath = token.slice(3);
		if (!filePath) continue;
		const status = mapGitStatus(statusCode);
		files.push({ path: filePath, status });
		if (statusCode.includes("R") || statusCode.includes("C")) {
			const nextPath = tokens[index + 1];
			if (nextPath) files.push({ path: nextPath, status: "renamed" });
			index += 1;
		}
	}
	return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function readCurrentDiffForPath(
	repoRoot: string,
	filePath: string,
	status: ReviewTargetFile["status"],
) {
	if (status === "added") {
		const untrackedDiff = await readUntrackedDiffForPath(repoRoot, filePath);
		if (untrackedDiff) return untrackedDiff;
	}
	const unstaged = await execFileAsync("git", ["diff", "--", filePath], {
		cwd: repoRoot,
		maxBuffer: 20 * 1024 * 1024,
	});
	const staged = await execFileAsync(
		"git",
		["diff", "--cached", "--", filePath],
		{
			cwd: repoRoot,
			maxBuffer: 20 * 1024 * 1024,
		},
	);
	return [staged.stdout, unstaged.stdout].filter(Boolean).join("\n");
}

async function readUntrackedDiffForPath(repoRoot: string, filePath: string) {
	try {
		const result = await execFileAsync(
			"git",
			["diff", "--no-index", "--", "/dev/null", filePath],
			{
				cwd: repoRoot,
				maxBuffer: 20 * 1024 * 1024,
			},
		);
		return result.stdout;
	} catch (error) {
		const result = error as { stdout?: string; stderr?: string };
		return result.stdout || result.stderr || "";
	}
}

function mapGitStatus(status: string): ReviewTargetFile["status"] {
	if (status === "??") return "added";
	if (status.includes("A")) return "added";
	if (status.includes("D")) return "deleted";
	if (status.includes("R")) return "renamed";
	if (status.trim()) return "modified";
	return "unknown";
}

function readStringArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstMarkdownHeading(text: string) {
	return (
		text
			.split("\n")
			.map((line) => line.match(/^#\s+(.+)$/)?.[1]?.trim())
			.find((line): line is string => Boolean(line)) ?? null
	);
}
