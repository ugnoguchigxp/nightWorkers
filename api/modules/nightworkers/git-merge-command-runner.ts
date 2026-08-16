import { runGitCommand } from "../gitworktree/gitworktree-cli";

const GIT_QUERY_TIMEOUT_MS = 15_000;
const GIT_MUTATION_TIMEOUT_MS = 60_000;
const GIT_MERGE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export async function runMergeGitCommand(
	cwd: string,
	args: string[],
	operation: "query" | "mutation" = "query",
) {
	const { stdout } = await runGitCommand(args, {
		cwd,
		timeoutMs:
			operation === "mutation" ? GIT_MUTATION_TIMEOUT_MS : GIT_QUERY_TIMEOUT_MS,
		maxOutputBytes: GIT_MERGE_MAX_OUTPUT_BYTES,
	});
	return stdout.trim();
}
