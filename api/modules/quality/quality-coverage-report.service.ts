import fs from "node:fs";
import path from "node:path";
import sanitizeHtml from "sanitize-html";
import { NotFoundError, ValidationError } from "../../lib/errors";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as repo from "./quality.repository";
import { readCoverageArtifacts } from "./quality-artifacts";

const COVERAGE_REPORT_FRESHNESS_TOLERANCE_MS = 120_000;
const MAX_COVERAGE_REPORT_CHARS = 2_000_000;

const coverageReportStyles = `
:root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
body { margin: 0; background: #0b1120; color: #dbeafe; font-size: 13px; }
*, *::before, *::after { box-sizing: border-box; }
.wrapper { min-width: 760px; padding: 20px; }
.pad1 { padding: 12px; } .pad1y { padding: 8px 0; }
.clearfix::after { clear: both; content: ""; display: table; }
.fl { float: left; } .space-right2 { margin-right: 24px; }
.quiet { color: #94a3b8; } .strong { font-weight: 700; }
.fraction { color: #64748b; margin-left: 4px; }
a { color: #7dd3fc; text-decoration: none; }
table { border-collapse: collapse; width: 100%; }
table:not(.coverage) th, table:not(.coverage) td { border-bottom: 1px solid #263449; padding: 6px 8px; text-align: left; }
pre { margin: 0; padding: 0; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; tab-size: 2; }
table.coverage { margin: 10px 0 0; padding: 0; }
table.coverage td { border: 0; margin: 0; padding: 0; vertical-align: top; }
table.coverage td.line-count { background: #111827; color: #64748b; padding: 0 5px 0 20px; text-align: right; width: 1%; }
table.coverage td.line-coverage { background: #111827; color: #64748b; min-width: 20px; padding-right: 10px; text-align: right; width: 1%; }
table.coverage td.text { padding: 0; }
table.coverage td span.cline-any { display: inline-block; padding: 0 5px; width: 100%; }
.cline-yes { background: rgba(34, 197, 94, .18); color: #86efac; }
.cline-no { background: rgba(239, 68, 68, .24); color: #fca5a5; }
.cline-neutral { color: #475569; }
.cstat-no, .fstat-no, .branch-no, .cbranch-no { background: rgba(239, 68, 68, .35); color: #fecaca; }
.high { color: #86efac; } .medium { color: #fde68a; } .low { color: #fca5a5; }
`;

function unavailableCoverageReport(
	reason:
		| "not_single_report"
		| "report_missing"
		| "report_stale"
		| "file_report_missing",
) {
	return { available: false, html: null, reason, generatedAt: null } as const;
}

function coverageFileRelativePath(fileKey: string, repositoryRoot: string) {
	const normalizedKey = fileKey.replace(/\\/g, "/");
	const normalizedRoot = repositoryRoot.replace(/\\/g, "/").replace(/\/+$/, "");
	const relative = path.isAbsolute(normalizedKey)
		? path.relative(normalizedRoot, canonicalizePotentialPath(normalizedKey))
		: normalizedKey;
	const normalizedRelative = relative.replace(/\\/g, "/").replace(/^\.\//, "");
	if (
		!normalizedRelative ||
		normalizedRelative === ".." ||
		normalizedRelative.startsWith("../") ||
		path.isAbsolute(normalizedRelative)
	) {
		throw new ValidationError("Coverage file must stay inside the repository");
	}
	return normalizedRelative;
}

function canonicalizePotentialPath(input: string) {
	let existing = path.resolve(input);
	const suffix: string[] = [];
	while (!fs.existsSync(existing)) {
		const parent = path.dirname(existing);
		if (parent === existing) break;
		suffix.unshift(path.basename(existing));
		existing = parent;
	}
	const canonicalExisting = fs.realpathSync(existing);
	return path.join(canonicalExisting, ...suffix);
}

function assertPathInsideRoot(root: string, target: string) {
	if (target !== root && !target.startsWith(`${root}${path.sep}`))
		throw new ValidationError("Coverage report path must stay inside coverage");
}

function reportFilesAreFromSameGeneration(stats: fs.Stats[]) {
	const timestamps = stats.map((stat) => stat.mtimeMs);
	return (
		Math.max(...timestamps) - Math.min(...timestamps) <=
		COVERAGE_REPORT_FRESHNESS_TOLERANCE_MS
	);
}

async function hasFreshSplitCoverageReport(
	repositoryRoot: string,
	referenceStat: fs.Stats,
) {
	const candidates = ["coverage-backend", "coverage-frontend"].map(
		(directory) =>
			path.join(repositoryRoot, directory, "coverage-summary.json"),
	);
	for (const candidate of candidates) {
		if (!fs.existsSync(candidate)) continue;
		const stat = await fs.promises.stat(candidate).catch(() => null);
		if (!stat) continue;
		if (reportFilesAreFromSameGeneration([referenceStat, stat])) return true;
	}
	return false;
}

function sanitizeCoverageReportDocument(rawHtml: string) {
	const body = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? rawHtml;
	const safeBody = sanitizeHtml(body, {
		allowedTags: [
			"a",
			"b",
			"code",
			"div",
			"em",
			"h1",
			"h2",
			"h3",
			"p",
			"pre",
			"span",
			"strong",
			"table",
			"tbody",
			"td",
			"tfoot",
			"th",
			"thead",
			"tr",
		],
		allowedAttributes: {
			"*": ["class", "id", "title"],
			a: ["name"],
			td: ["colspan"],
			th: ["colspan"],
		},
	});
	return `<!doctype html><html><head><meta charset="utf-8"><style>${coverageReportStyles}</style></head><body>${safeBody}</body></html>`;
}

export async function getCoverageFileReport(input: {
	repositoryId: string;
	runId: string;
	fileKey: string;
}) {
	const repository = await nightworkersRepo.getRepository(input.repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	const run = await repo.getProjectQualityRun(input.runId);
	if (!run || run.repositoryId !== input.repositoryId)
		throw new NotFoundError("Project quality run not found");

	const repositoryRoot =
		repository.registeredRootCanonical ?? repository.localPath;
	const reportRoot = path.join(repositoryRoot, "coverage");
	const reportIndexPath = path.join(reportRoot, "index.html");
	const coverage = readCoverageArtifacts(repositoryRoot);
	if (
		!coverage.coverageSummary ||
		!coverage.artifactPath ||
		!fs.existsSync(reportIndexPath)
	)
		return unavailableCoverageReport("report_missing");
	const realRepositoryRoot = fs.realpathSync(repositoryRoot);
	const realReportRoot = fs.realpathSync(reportRoot);
	assertPathInsideRoot(realRepositoryRoot, realReportRoot);
	assertPathInsideRoot(realReportRoot, fs.realpathSync(coverage.artifactPath));
	assertPathInsideRoot(realReportRoot, fs.realpathSync(reportIndexPath));

	const [summaryStat, indexStat] = await Promise.all([
		fs.promises.stat(coverage.artifactPath),
		fs.promises.stat(reportIndexPath),
	]);
	if (await hasFreshSplitCoverageReport(repositoryRoot, summaryStat))
		return unavailableCoverageReport("not_single_report");
	if (!reportFilesAreFromSameGeneration([summaryStat, indexStat]))
		return unavailableCoverageReport("report_stale");

	if (
		typeof coverage.coverageSummary !== "object" ||
		Array.isArray(coverage.coverageSummary) ||
		!(input.fileKey in coverage.coverageSummary)
	) {
		return unavailableCoverageReport("file_report_missing");
	}
	const relativePath = coverageFileRelativePath(input.fileKey, repositoryRoot);
	const fileReportPath = path.resolve(reportRoot, `${relativePath}.html`);
	assertPathInsideRoot(path.resolve(reportRoot), fileReportPath);
	if (!fs.existsSync(fileReportPath))
		return unavailableCoverageReport("file_report_missing");
	assertPathInsideRoot(realReportRoot, fs.realpathSync(fileReportPath));
	const fileStat = await fs.promises.stat(fileReportPath);
	if (!reportFilesAreFromSameGeneration([summaryStat, indexStat, fileStat]))
		return unavailableCoverageReport("report_stale");
	const rawHtml = await fs.promises.readFile(fileReportPath, "utf8");
	if (Buffer.byteLength(rawHtml, "utf8") > MAX_COVERAGE_REPORT_CHARS)
		return unavailableCoverageReport("file_report_missing");
	return {
		available: true,
		html: sanitizeCoverageReportDocument(rawHtml),
		reason: null,
		generatedAt: indexStat.mtime.toISOString(),
	} as const;
}
