export type CoverageDisplayValue = number | null;

export type CoverageFileRow = {
	key: string;
	file: string;
	statements: CoverageDisplayValue;
	branches: CoverageDisplayValue;
	functions: CoverageDisplayValue;
	lines: CoverageDisplayValue;
	uncovered: string;
	summary?: boolean;
};

const coverageMetrics = [
	"statements",
	"branches",
	"functions",
	"lines",
] as const;

export function coverageRowsFromSummary(
	summary: unknown,
	projectRoot?: string,
): CoverageFileRow[] {
	if (!summary || typeof summary !== "object" || Array.isArray(summary))
		return [];
	const record = summary as Record<string, unknown>;
	return Object.entries(record)
		.filter(([, entry]) => isCoverageEntry(entry))
		.sort(([left], [right]) => {
			if (left === "total") return -1;
			if (right === "total") return 1;
			return left.localeCompare(right);
		})
		.map(([file, entry]) => ({
			key: file,
			file: displayCoverageFilePath(file, projectRoot),
			statements: percentFromCoverageEntry(entry, "statements"),
			branches: percentFromCoverageEntry(entry, "branches"),
			functions: percentFromCoverageEntry(entry, "functions"),
			lines: percentFromCoverageEntry(entry, "lines"),
			uncovered: uncoveredFromCoverageEntry(entry),
			summary: file === "total",
		}));
}

function isCoverageEntry(entry: unknown) {
	return coverageMetrics.some(
		(metric) => percentFromCoverageEntry(entry, metric) !== null,
	);
}

function displayCoverageFilePath(file: string, projectRoot?: string) {
	if (file === "total" || !projectRoot) return file;
	const normalizedFile = normalizePathSeparators(file);
	const normalizedRoot = trimTrailingSlash(
		normalizePathSeparators(projectRoot),
	);
	if (!normalizedRoot) return file;
	if (normalizedFile === normalizedRoot) return ".";
	const rootPrefix = `${normalizedRoot}/`;
	return normalizedFile.startsWith(rootPrefix)
		? normalizedFile.slice(rootPrefix.length)
		: file;
}

function normalizePathSeparators(value: string) {
	return value.replace(/\\/g, "/");
}

function trimTrailingSlash(value: string) {
	return value.replace(/\/+$/, "");
}

function percentFromCoverageEntry(
	entry: unknown,
	metric: (typeof coverageMetrics)[number],
) {
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
	const metricValue = (entry as Record<string, unknown>)[metric];
	if (
		!metricValue ||
		typeof metricValue !== "object" ||
		Array.isArray(metricValue)
	)
		return null;
	const pct = (metricValue as Record<string, unknown>).pct;
	return typeof pct === "number" && Number.isFinite(pct) ? pct : null;
}

function uncoveredFromCoverageEntry(entry: unknown) {
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "—";
	const value = (entry as Record<string, unknown>).uncoveredLines;
	if (!Array.isArray(value) || value.length === 0) return "—";
	const lines = value
		.filter((line) => typeof line === "string" || typeof line === "number")
		.map(String);
	return lines.length > 0 ? lines.join(", ") : "—";
}
