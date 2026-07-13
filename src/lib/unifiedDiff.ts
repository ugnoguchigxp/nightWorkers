export type ChangedFileSummary = {
	path: string;
	added: number;
	deleted: number;
};

export type ChangedFileDiff = ChangedFileSummary & {
	diff: string;
};

function normalizeDiffPath(value: string) {
	let normalized = value.trim();
	if (normalized.startsWith('"') && normalized.endsWith('"')) {
		try {
			normalized = JSON.parse(normalized) as string;
		} catch {
			normalized = normalized.slice(1, -1);
		}
	}
	return normalized.replace(/^[ab]\//, "");
}

export function getChangedFileDiffs(diff?: string | null): ChangedFileDiff[] {
	if (!diff) return [];
	const files: ChangedFileDiff[] = [];
	let current:
		| (ChangedFileSummary & { oldPath: string | null; lines: string[] })
		| null = null;

	const flush = () => {
		if (!current) return;
		files.push({
			path: current.path || current.oldPath || "unknown",
			added: current.added,
			deleted: current.deleted,
			diff: current.lines.join("\n"),
		});
		current = null;
	};

	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git ")) {
			flush();
			const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
			current = {
				path: match?.[2] ? normalizeDiffPath(match[2]) : "",
				oldPath: match?.[1] ? normalizeDiffPath(match[1]) : null,
				added: 0,
				deleted: 0,
				lines: [line],
			};
			continue;
		}
		if (!current) continue;
		current.lines.push(line);
		if (line.startsWith("+++ ") && line.slice(4).trim() !== "/dev/null") {
			current.path = normalizeDiffPath(line.slice(4));
			continue;
		}
		if (line.startsWith("--- ") && line.slice(4).trim() !== "/dev/null") {
			current.oldPath = normalizeDiffPath(line.slice(4));
			continue;
		}
		if (line.startsWith("+") && !line.startsWith("+++")) current.added += 1;
		if (line.startsWith("-") && !line.startsWith("---")) current.deleted += 1;
	}
	flush();
	return files;
}

export const getDiffStats = (diff?: string | null) => {
	if (!diff) return { added: 0, deleted: 0 };
	let added = 0;
	let deleted = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added++;
		if (line.startsWith("-") && !line.startsWith("---")) deleted++;
	}
	return { added, deleted };
};

export const getChangedFiles = (diff?: string | null): ChangedFileSummary[] =>
	getChangedFileDiffs(diff).map(({ path, added, deleted }) => ({
		path,
		added,
		deleted,
	}));
