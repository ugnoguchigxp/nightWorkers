import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROJECT_SOURCE_GIT_TIMEOUT_MS = 10_000;
const PROJECT_SOURCE_GIT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export type ProjectSourceState = { head: string | null; dirty: boolean };
export type ProjectSourceStateReader = (
	projectPath: string,
) => Promise<ProjectSourceState>;

export async function readGitProjectSourceState(
	projectPath: string,
): Promise<ProjectSourceState> {
	const before = await readGitHead(projectPath);
	const status = await execFileAsync(
		"git",
		["status", "--porcelain=v1", "-z"],
		gitExecOptions(projectPath),
	);
	const after = await readGitHead(projectPath);
	return {
		head: after,
		dirty: status.stdout.length > 0 || before !== after,
	};
}

async function readGitHead(projectPath: string) {
	const head = await execFileAsync(
		"git",
		["rev-parse", "--verify", "HEAD"],
		gitExecOptions(projectPath),
	);
	return head.stdout.trim() || null;
}

function gitExecOptions(projectPath: string) {
	return {
		cwd: projectPath,
		timeout: PROJECT_SOURCE_GIT_TIMEOUT_MS,
		maxBuffer: PROJECT_SOURCE_GIT_MAX_BUFFER_BYTES,
	};
}

export async function projectSourceMatchesRevision(input: {
	projectPaths: string[];
	expectedHead: string;
	readSourceState?: ProjectSourceStateReader;
}) {
	const readSourceState = input.readSourceState ?? readGitProjectSourceState;
	try {
		const paths = [...new Set(input.projectPaths)];
		const states = await Promise.all(paths.map(readSourceState));
		return states.every(
			(source) => source.head === input.expectedHead && !source.dirty,
		);
	} catch {
		return false;
	}
}
