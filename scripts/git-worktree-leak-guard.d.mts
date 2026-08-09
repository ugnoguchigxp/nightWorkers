export function parseGitWorktreePaths(output: string): string[];

export function readGitWorktreePaths(
	repositoryRoot: string,
	options?: {
			execFileSync?: (
			command: string,
			args: string[],
			options: {
				encoding: "utf8";
				timeout: number;
				maxBuffer: number;
			},
		) => string;
	},
): string[];

export function readNightWorkersBranchRefs(
	repositoryRoot: string,
	options?: {
			execFileSync?: (
			command: string,
			args: string[],
			options: {
				encoding: "utf8";
				timeout: number;
				maxBuffer: number;
			},
		) => string;
	},
): string[];

export function findAddedGitEntries(
	before: readonly string[],
	after: readonly string[],
): string[];

export function findRemovedGitEntries(
	before: readonly string[],
	after: readonly string[],
): string[];
