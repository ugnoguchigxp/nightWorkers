import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { buildChildProcessEnvironment } from "../execution/child-process-environment";

const execFileAsync = promisify(execFile);

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
