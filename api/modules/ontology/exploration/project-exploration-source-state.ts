import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ProjectSourceState = { head: string | null; dirty: boolean };
export type ProjectSourceStateReader = (
	projectPath: string,
) => Promise<ProjectSourceState>;

export async function readGitProjectSourceState(
	projectPath: string,
): Promise<ProjectSourceState> {
	const [head, status] = await Promise.all([
		execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
			cwd: projectPath,
		}),
		execFileAsync("git", ["status", "--porcelain=v1", "-z"], {
			cwd: projectPath,
		}),
	]);
	return {
		head: head.stdout.trim() || null,
		dirty: status.stdout.length > 0,
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
