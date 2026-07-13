import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryCloseoutLocks = new Map<string, Promise<void>>();

export async function withRepositoryCloseoutLock<T>(
	repositoryId: string,
	fn: () => Promise<T>,
): Promise<T> {
	const previous =
		repositoryCloseoutLocks.get(repositoryId) ?? Promise.resolve();
	let releaseCurrent: () => void = () => {};
	const current = new Promise<void>((resolve) => {
		releaseCurrent = resolve;
	});
	const tail = previous.catch(() => undefined).then(() => current);
	repositoryCloseoutLocks.set(repositoryId, tail);
	await previous.catch(() => undefined);
	try {
		return await fn();
	} finally {
		releaseCurrent();
		if (repositoryCloseoutLocks.get(repositoryId) === tail)
			repositoryCloseoutLocks.delete(repositoryId);
	}
}

export function parseGitPorcelainZ(output: string) {
	const entries: Array<{ status: string; path: string }> = [];
	const tokens = output.split("\0").filter(Boolean);
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index] ?? "";
		const status = token.slice(0, 2);
		const filePath = token.slice(2).trimStart();
		if (!filePath) continue;
		entries.push({ status, path: filePath });
		if (status.includes("R") || status.includes("C")) {
			const nextPath = tokens[index + 1];
			if (nextPath) entries.push({ status, path: nextPath });
			index += 1;
		}
	}
	return entries;
}

export async function git(
	repoRoot: string,
	args: string[],
	options: { allowFailure?: boolean } = {},
) {
	try {
		const result = await execFileAsync("git", args, {
			cwd: repoRoot,
			maxBuffer: 1024 * 1024 * 8,
		});
		return result.stdout.trim();
	} catch (error) {
		if (options.allowFailure) return null;
		throw error;
	}
}

export async function readGitState(repoRoot: string) {
	const [head, branch, upstream, porcelain, staged] = await Promise.all([
		git(repoRoot, ["rev-parse", "--verify", "HEAD"], { allowFailure: true }),
		git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], {
			allowFailure: true,
		}),
		git(
			repoRoot,
			["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
			{ allowFailure: true },
		),
		git(repoRoot, ["status", "--porcelain=v1", "-z"], { allowFailure: true }),
		git(repoRoot, ["diff", "--cached", "--name-only"], { allowFailure: true }),
	]);
	return {
		head,
		branch,
		upstream,
		dirtyPaths: parseGitPorcelainZ(porcelain ?? "")
			.map((entry) => entry.path)
			.sort(),
		stagedPaths: (staged ?? "")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.sort(),
	};
}

export function list(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

export function exclusions(
	value: unknown,
): Array<{ path: string; reason: string }> {
	return Array.isArray(value)
		? value.filter((item): item is { path: string; reason: string } =>
				Boolean(
					item &&
						typeof item === "object" &&
						typeof (item as { path?: unknown }).path === "string" &&
						typeof (item as { reason?: unknown }).reason === "string",
				),
			)
		: [];
}

export function normalizePushStatus(
	record: { pushStatus?: unknown; status?: unknown } | null,
) {
	if (record?.pushStatus) return String(record.pushStatus);
	return record?.status === "committed" ? "not_pushed" : "blocked";
}

export function blocking(code: string, reason: string, state = "needs_human") {
	return { code, reason, state };
}

export function defaultCommitMessage(input: {
	taskTitle?: string | null;
	runId: string;
	message?: string;
}) {
	const message = input.message?.trim();
	if (message) return message;
	const title = input.taskTitle?.trim();
	if (title) return `Implement ${title}`;
	return `Complete NightWorkers run ${input.runId.slice(0, 8)}`;
}

export async function readOwnedDiff(input: {
	repoRoot: string;
	stageablePaths: string[];
}) {
	if (input.stageablePaths.length === 0) return "";
	const diff = await git(
		input.repoRoot,
		["diff", "--", ...input.stageablePaths],
		{ allowFailure: true },
	);
	return (diff ?? "").slice(0, 20_000);
}

export function pushBlockedByPolicy(safetyPolicy: unknown) {
	const blockedCommands = Array.isArray(
		(safetyPolicy as { blockedCommands?: unknown })?.blockedCommands,
	)
		? ((safetyPolicy as { blockedCommands: unknown[] }).blockedCommands.filter(
				(item): item is string => typeof item === "string",
			) ?? [])
		: [];
	const command = "git push";
	return blockedCommands.some((blocked) => {
		const normalized = blocked.trim();
		if (!normalized) return false;
		return (
			command.includes(normalized) ||
			new RegExp(`\\b${escapeRegExp(normalized)}\\b`).test(command)
		);
	});
}

export function resolveGitIntegrationCloseout(
	mergeRecord: {
		status: string;
		targetPushStatus?: string | null;
		lastErrorMessage?: string | null;
	} | null,
	decision: { state: string; reason: string | null },
) {
	const state = mergeRecord
		? ({
				decision_required: "integration_decision_required",
				previewing: "merge_preview_running",
				merging: "merge_running",
				deferred: "integration_deferred",
			}[mergeRecord.status] ?? mergeRecord.status)
		: decision.state;
	const targetPushStatus = mergeRecord?.targetPushStatus ?? "not_started";
	const mergedTarget = mergeRecord?.status === "merged";
	return {
		state,
		canPush: mergedTarget
			? !["pushed", "pushing", "blocked"].includes(targetPushStatus)
			: decision.state === "push_ready",
		blockingReason:
			mergedTarget && ["failed", "blocked"].includes(targetPushStatus)
				? mergeRecord.lastErrorMessage
				: decision.reason,
	};
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
