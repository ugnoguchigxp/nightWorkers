export type ParsedWorktreeRecord = {
	path: string;
	head: string | null;
	branch: string | null;
	detached: boolean;
	bare: boolean;
	locked: boolean;
	lockReason: string | null;
	prunable: boolean;
	pruneReason: string | null;
};

export type ParsedWorktreeStatus = {
	upstream: string | null;
	ahead: number;
	behind: number;
	stagedCount: number;
	modifiedCount: number;
	untrackedCount: number;
	conflictedCount: number;
};

function fieldValue(token: string, name: string) {
	return token === name ? "" : token.slice(name.length + 1);
}

export function parseWorktreeListPorcelain(output: string) {
	const records: ParsedWorktreeRecord[] = [];
	let current: ParsedWorktreeRecord | null = null;
	const flush = () => {
		if (current?.path) records.push(current);
		current = null;
	};

	for (const token of output.split("\0")) {
		if (!token) {
			flush();
			continue;
		}
		if (token.startsWith("worktree ")) {
			flush();
			current = {
				path: fieldValue(token, "worktree"),
				head: null,
				branch: null,
				detached: false,
				bare: false,
				locked: false,
				lockReason: null,
				prunable: false,
				pruneReason: null,
			};
			continue;
		}
		if (!current) continue;
		if (token.startsWith("HEAD ")) current.head = fieldValue(token, "HEAD");
		else if (token.startsWith("branch ")) {
			const ref = fieldValue(token, "branch");
			current.branch = ref.startsWith("refs/heads/")
				? ref.slice("refs/heads/".length)
				: ref;
		} else if (token === "detached") current.detached = true;
		else if (token === "bare") current.bare = true;
		else if (token === "locked" || token.startsWith("locked ")) {
			current.locked = true;
			current.lockReason = fieldValue(token, "locked") || null;
		} else if (token === "prunable" || token.startsWith("prunable ")) {
			current.prunable = true;
			current.pruneReason = fieldValue(token, "prunable") || null;
		}
	}
	flush();
	return records;
}

export function parseWorktreeStatusPorcelain(
	output: string,
): ParsedWorktreeStatus {
	const result: ParsedWorktreeStatus = {
		upstream: null,
		ahead: 0,
		behind: 0,
		stagedCount: 0,
		modifiedCount: 0,
		untrackedCount: 0,
		conflictedCount: 0,
	};
	for (const token of output.split("\0")) {
		if (!token) continue;
		if (token.startsWith("# branch.upstream ")) {
			result.upstream = token.slice("# branch.upstream ".length) || null;
			continue;
		}
		if (token.startsWith("# branch.ab ")) {
			const match = token.match(/\+([0-9]+)\s+-([0-9]+)/);
			if (match) {
				result.ahead = Number(match[1]);
				result.behind = Number(match[2]);
			}
			continue;
		}
		if (token.startsWith("? ")) {
			result.untrackedCount += 1;
			continue;
		}
		if (token.startsWith("u ")) {
			result.conflictedCount += 1;
			continue;
		}
		if (token.startsWith("1 ") || token.startsWith("2 ")) {
			const status = token.slice(2, 4);
			if (status[0] && status[0] !== ".") result.stagedCount += 1;
			if (status[1] && status[1] !== ".") result.modifiedCount += 1;
		}
	}
	return result;
}
