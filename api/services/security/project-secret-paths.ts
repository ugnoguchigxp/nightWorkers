import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildChildProcessEnvironment } from "../execution/child-process-environment";

const execFileAsync = promisify(execFile);
const MAX_PROJECT_SECRET_PATH_SCAN_ENTRIES = 100_000;

export const PROJECT_SECRET_FILE_PATTERNS = [
	".env",
	".env.*",
	"*.pem",
	"*.key",
	".npmrc",
	".pypirc",
	"credentials.json",
] as const;

function matchesSecretSegment(segment: string) {
	const value = segment.toLowerCase();
	if (value === ".env" || value === ".npmrc" || value === ".pypirc") {
		return true;
	}
	if (value.startsWith(".env.") && value !== ".env.example") return true;
	if (value === "credentials.json") return true;
	return value.endsWith(".pem") || value.endsWith(".key");
}

export function isProjectSecretPath(input: string, repositoryRoot?: string) {
	const relative = repositoryRoot
		? path.relative(path.resolve(repositoryRoot), path.resolve(input))
		: input;
	if (
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		return false;
	}
	return relative
		.split(/[\\/]+/)
		.filter(Boolean)
		.some(matchesSecretSegment);
}

export function assertProjectPathIsNotSecret(
	input: string,
	repositoryRoot?: string,
) {
	if (isProjectSecretPath(input, repositoryRoot)) {
		throw new Error("PROJECT_SECRET_PATH_DENIED");
	}
}

function isWithinProjectRoot(targetPath: string, repositoryRoot: string) {
	const relative = path.relative(repositoryRoot, targetPath);
	return (
		relative === "" ||
		(!relative.startsWith(`..${path.sep}`) &&
			relative !== ".." &&
			!path.isAbsolute(relative))
	);
}

function pathCandidatesFromArgument(argument: string) {
	const candidates = [argument];
	const equalsIndex = argument.indexOf("=");
	if (equalsIndex >= 0 && equalsIndex < argument.length - 1) {
		candidates.push(argument.slice(equalsIndex + 1));
	}
	return candidates;
}

/**
 * Checks argv paths without reading file contents. A symlink from the workspace
 * to a secret file (or outside the workspace) is denied as well.
 */
export async function commandArgumentsReferenceProjectSecret(input: {
	args: readonly string[];
	repositoryRoot: string;
	cwd: string;
}): Promise<boolean> {
	const repositoryRoot = await fs
		.realpath(path.resolve(input.repositoryRoot))
		.catch(() => path.resolve(input.repositoryRoot));
	const cwd = await fs
		.realpath(path.resolve(input.cwd))
		.catch(() => path.resolve(input.cwd));
	for (const argument of input.args) {
		for (const candidate of pathCandidatesFromArgument(argument)) {
			const unresolvedTarget = path.isAbsolute(candidate)
				? path.resolve(candidate)
				: path.resolve(cwd, candidate);
			const canonicalParent = await fs
				.realpath(path.dirname(unresolvedTarget))
				.catch(() => path.dirname(unresolvedTarget));
			const targetPath = path.join(
				canonicalParent,
				path.basename(unresolvedTarget),
			);
			if (isProjectSecretPath(targetPath, repositoryRoot)) return true;

			const canonicalTarget = await fs.realpath(targetPath).catch(() => null);
			if (!canonicalTarget) continue;
			if (isProjectSecretPath(canonicalTarget, repositoryRoot)) return true;
			if (
				isWithinProjectRoot(targetPath, repositoryRoot) &&
				!isWithinProjectRoot(canonicalTarget, repositoryRoot)
			) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Lists existing catalog-matched secret paths and symlinks that escape the
 * workspace. Both logical and canonical paths are returned so OS confinement
 * can deny reads before path resolution.
 */
export async function listExistingProjectSecretPaths(repositoryRoot: string) {
	const root = await fs
		.realpath(path.resolve(repositoryRoot))
		.catch(() => path.resolve(repositoryRoot));
	const secretPaths = new Set<string>();
	let scannedEntries = 0;

	const visit = async (directory: string): Promise<void> => {
		const entries = await fs.readdir(directory, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name === ".git") continue;
			scannedEntries += 1;
			if (scannedEntries > MAX_PROJECT_SECRET_PATH_SCAN_ENTRIES) {
				throw new Error("PROJECT_SECRET_PATH_SCAN_LIMIT_EXCEEDED");
			}

			const entryPath = path.join(directory, entry.name);
			const canonicalPath = await fs.realpath(entryPath).catch(() => null);
			const isCatalogMatch = isProjectSecretPath(entryPath, root);
			const targetIsCatalogMatch =
				canonicalPath !== null && isProjectSecretPath(canonicalPath, root);
			const escapesWorkspace =
				canonicalPath !== null && !isWithinProjectRoot(canonicalPath, root);
			if (isCatalogMatch || targetIsCatalogMatch || escapesWorkspace) {
				secretPaths.add(entryPath);
				if (canonicalPath) secretPaths.add(canonicalPath);
				continue;
			}
			if (entry.isDirectory()) await visit(entryPath);
		}
	};

	await visit(root);
	return [...secretPaths].sort();
}

export async function listTrackedProjectSecretPaths(repositoryRoot: string) {
	const result = await execFileAsync(
		"git",
		["-C", repositoryRoot, "ls-files", "-z"],
		{
			env: buildChildProcessEnvironment({ purpose: "git" }),
			timeout: 10_000,
			maxBuffer: 4 * 1024 * 1024,
		},
	);
	return result.stdout
		.split("\0")
		.filter(Boolean)
		.filter((relativePath) => isProjectSecretPath(relativePath))
		.sort();
}
