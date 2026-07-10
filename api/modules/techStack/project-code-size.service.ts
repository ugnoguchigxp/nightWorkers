import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
	ProjectCodeSizeClassificationSource,
	ProjectCodeSizeRootSummary,
	ProjectCodeSizeSkipSummary,
	ProjectCodeSizeSourceBucket,
	ProjectCodeSizeSourceCategory,
	ProjectCodeSizeTestBucket,
	ProjectCodeSizeTestKind,
} from "../../../shared/schemas/tech-stack.schema";
import { ValidationError } from "../../lib/errors";
import { countEffectiveLines } from "./effective-line-counter";
import { createProjectCodeSizeClassifier } from "./project-code-size-classifier";
import { listProjectFileCandidates } from "./project-file-inventory";

const execFileAsync = promisify(execFile);

export const SOURCE_CATEGORY_ORDER = [
	"frontend",
	"backend",
	"batch",
	"script",
	"shared",
	"database",
	"desktop",
	"other",
] as const;
export const TEST_KIND_ORDER = ["unit", "e2e", "other"] as const;

export type MeasuredProjectCodeSize = {
	schemaVersion: 1;
	algorithmVersion: "effective-lines-v1";
	measuredAt: Date;
	scanDurationMs: number;
	inventory: {
		source: "git" | "filesystem";
		listedFiles: number;
		skipped: ProjectCodeSizeSkipSummary;
	};
	git: {
		status: "available" | "unavailable";
		head: string | null;
		shortHead: string | null;
		dirty: boolean | null;
	};
	totals: {
		totalFiles: number;
		sourceFiles: number;
		testFiles: number;
		totalEffectiveLines: number;
		sourceEffectiveLines: number;
		testEffectiveLines: number;
	};
	sourceBuckets: ProjectCodeSizeSourceBucket[];
	testBuckets: ProjectCodeSizeTestBucket[];
	warnings: Array<{ code: "classification_conflict"; count: number }>;
};

async function readGitSnapshot(
	repoRoot: string,
): Promise<MeasuredProjectCodeSize["git"]> {
	try {
		const [headResult, statusResult] = await Promise.all([
			execFileAsync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
				encoding: "utf8",
				timeout: 5000,
			}),
			execFileAsync(
				"git",
				["-C", repoRoot, "status", "--porcelain", "--untracked-files=normal"],
				{
					encoding: "utf8",
					timeout: 5000,
				},
			),
		]);
		const head = String(headResult.stdout).trim();
		return {
			status: "available",
			head,
			shortHead: head.slice(0, 10),
			dirty: String(statusResult.stdout).trim().length > 0,
		};
	} catch {
		return { status: "unavailable", head: null, shortHead: null, dirty: null };
	}
}

type MutableRoot = {
	files: number;
	effectiveLines: number;
	classificationSource: ProjectCodeSizeClassificationSource;
};

function rootsFromMap(
	roots: Map<string, MutableRoot>,
): ProjectCodeSizeRootSummary[] {
	return [...roots.entries()]
		.sort(([left], [right]) => left.localeCompare(right, "en"))
		.map(([path, value]) => ({ path, ...value }));
}

export async function measureProjectCodeSize(
	repoRoot: string,
): Promise<MeasuredProjectCodeSize> {
	const startedAt = Date.now();
	const [inventory, git] = await Promise.all([
		listProjectFileCandidates(repoRoot),
		readGitSnapshot(repoRoot),
	]);
	const topLevelSegments = new Set(
		inventory.candidates
			.map((candidate) => candidate.relativePath.split("/")[0])
			.filter(Boolean),
	);
	const sourceRoots = new Map<
		ProjectCodeSizeSourceCategory,
		Map<string, MutableRoot>
	>(SOURCE_CATEGORY_ORDER.map((category) => [category, new Map()]));
	const testRoots = new Map<ProjectCodeSizeTestKind, Map<string, MutableRoot>>(
		TEST_KIND_ORDER.map((kind) => [kind, new Map()]),
	);
	const classify = createProjectCodeSizeClassifier({
		repoRoot,
		topLevelSegments,
	});

	for (const candidate of inventory.candidates) {
		let effectiveLines: number;
		try {
			effectiveLines = await countEffectiveLines(
				candidate.fullPath,
				candidate.relativePath,
			);
		} catch {
			inventory.skipped.unreadable += 1;
			continue;
		}
		const classification = classify(candidate.relativePath);
		const roots =
			classification.target.type === "source"
				? sourceRoots.get(classification.target.category)
				: testRoots.get(classification.target.kind);
		if (!roots) throw new ValidationError("Unknown code size bucket");
		const current = roots.get(classification.root) ?? {
			files: 0,
			effectiveLines: 0,
			classificationSource: classification.source,
		};
		current.files += 1;
		current.effectiveLines += effectiveLines;
		roots.set(classification.root, current);
	}

	const sourceBuckets = SOURCE_CATEGORY_ORDER.map((category) => {
		const roots = rootsFromMap(sourceRoots.get(category) ?? new Map());
		return {
			category,
			files: roots.reduce((sum, root) => sum + root.files, 0),
			effectiveLines: roots.reduce((sum, root) => sum + root.effectiveLines, 0),
			roots,
		};
	});
	const testBuckets = TEST_KIND_ORDER.map((kind) => {
		const roots = rootsFromMap(testRoots.get(kind) ?? new Map());
		return {
			kind,
			files: roots.reduce((sum, root) => sum + root.files, 0),
			effectiveLines: roots.reduce((sum, root) => sum + root.effectiveLines, 0),
			roots,
		};
	});
	const sourceFiles = sourceBuckets.reduce(
		(sum, bucket) => sum + bucket.files,
		0,
	);
	const testFiles = testBuckets.reduce((sum, bucket) => sum + bucket.files, 0);
	const sourceEffectiveLines = sourceBuckets.reduce(
		(sum, bucket) => sum + bucket.effectiveLines,
		0,
	);
	const testEffectiveLines = testBuckets.reduce(
		(sum, bucket) => sum + bucket.effectiveLines,
		0,
	);
	const totals = {
		totalFiles: sourceFiles + testFiles,
		sourceFiles,
		testFiles,
		totalEffectiveLines: sourceEffectiveLines + testEffectiveLines,
		sourceEffectiveLines,
		testEffectiveLines,
	};
	if (
		totals.totalFiles !== sourceFiles + testFiles ||
		totals.totalEffectiveLines !== sourceEffectiveLines + testEffectiveLines
	) {
		throw new ValidationError("Project code size totals are inconsistent");
	}
	return {
		schemaVersion: 1,
		algorithmVersion: "effective-lines-v1",
		measuredAt: new Date(),
		scanDurationMs: Date.now() - startedAt,
		inventory: {
			source: inventory.source,
			listedFiles: inventory.listedFiles,
			skipped: inventory.skipped,
		},
		git,
		totals,
		sourceBuckets,
		testBuckets,
		warnings: [],
	};
}
