import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { callStructuredJsonLLM } from "../../services/structured-llm";
import { parseRepairedJsonWithSchema } from "../../services/structured-llm/json";
import type {
	ReviewPlanSpec,
	ReviewTarget,
} from "./nightworkers.review-mode.model";
import * as reviewRepo from "./nightworkers.review-mode.repository";
import { buildTestEvidencePrecheck } from "./nightworkers.review-mode.test-evidence-precheck";

const UNIT_TEST_FILE_PATTERN =
	/(?:^|[/.])(?:[^/]*\.)?(?:test|spec|cases)\.[cm]?[jt]sx?$|(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$/;
const TEST_NAME_PATTERN =
	/\b(?:describe|it|test)(?:\.(?:only|skip|todo|concurrent))?\s*\(\s*(['"`])((?:\\.|(?!\1).){1,240})\1/g;
const SKIP_DIRS = new Set([
	".git",
	".next",
	".turbo",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"out",
]);
const EXCLUDED_UNIT_TEST_PATH_PARTS = [
	"e2e/",
	"tests/live/",
	"__fixtures__/",
	"fixtures/",
];
const MAX_TEST_CANDIDATES = 120;
const MAX_EXCERPT_LINES = 28;

const coverageStatusSchema = z.enum(["covered", "missing", "unclear"]);
const unitTestCoverageReviewSchema = z.object({
	version: z.literal(1),
	summary: z.string(),
	criteria: z.array(
		z.object({
			criterion: z.string(),
			status: coverageStatusSchema,
			viewpoint: z.string(),
			reason: z.string(),
			matchedTests: z.array(
				z.object({
					filePath: z.string(),
					lineNumber: z.number().int().positive(),
					testName: z.string(),
					evidenceKind: z.enum(["test_name", "test_body", "file_path"]),
					coveredViewpoint: z.string(),
				}),
			),
		}),
	),
});

const unitTestCoverageJsonSchema = {
	type: "object",
	additionalProperties: false,
	required: ["version", "summary", "criteria"],
	properties: {
		version: { const: 1 },
		summary: { type: "string" },
		criteria: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"criterion",
					"status",
					"viewpoint",
					"reason",
					"matchedTests",
				],
				properties: {
					criterion: { type: "string" },
					status: { enum: ["covered", "missing", "unclear"] },
					viewpoint: { type: "string" },
					reason: { type: "string" },
					matchedTests: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							required: [
								"filePath",
								"lineNumber",
								"testName",
								"evidenceKind",
								"coveredViewpoint",
							],
							properties: {
								filePath: { type: "string" },
								lineNumber: { type: "integer", minimum: 1 },
								testName: { type: "string" },
								evidenceKind: {
									enum: ["test_name", "test_body", "file_path"],
								},
								coveredViewpoint: { type: "string" },
							},
						},
					},
				},
			},
		},
	},
};

export type UnitTestCoverageReview = z.infer<
	typeof unitTestCoverageReviewSchema
>;
type UnitTestCaseCandidate = {
	filePath: string;
	lineNumber: number;
	testName: string;
	excerpt: string;
};

export async function runReviewRunUnitTestCoverageCheck(input: {
	reviewSessionId: string;
	taskId: string;
	repositoryId: string;
	target: ReviewTarget;
	planSpec: ReviewPlanSpec;
	llm?: typeof callStructuredJsonLLM;
}) {
	const criteria = input.planSpec.acceptanceCriteria;
	const candidates = await collectUnitTestCandidates(input.target.repoRoot);
	const precheck = await buildTestEvidencePrecheck({
		taskId: input.taskId,
		repositoryId: input.repositoryId,
	});
	const review =
		criteria.length > 0
			? await reviewCoverageWithLlm({
					repoRoot: input.target.repoRoot,
					criteria,
					candidates,
					fallback: () => fallbackCoverageReview(precheck.matches),
					llm: input.llm ?? callStructuredJsonLLM,
				})
			: emptyCoverageReview();
	const missing = review.criteria.filter(
		(item) => item.status === "missing" || item.status === "unclear",
	);

	await reviewRepo.upsertReviewArtifact({
		reviewSessionId: input.reviewSessionId,
		runId: input.target.runId,
		taskId: input.taskId,
		kind: "test_coverage",
		status: missing.length > 0 ? "needs_human" : "done",
		artifactJson: {
			version: 1,
			kind: "unit_test_coverage_review",
			mode: "semantic_unit_test_coverage",
			planTitle: input.planSpec.title,
			precheck,
			unitTestFilesScanned: new Set(candidates.map((item) => item.filePath))
				.size,
			unitTestCandidatesScanned: candidates.length,
			review,
		},
		sourceEvidenceRefsJson: review.criteria.flatMap((criterion) =>
			criterion.matchedTests.map((match) => ({
				kind: "test_file",
				path: match.filePath,
				lineNumber: match.lineNumber,
			})),
		),
	});

	await reviewRepo.createReviewFindings(
		missing.map((item) => ({
			reviewSessionId: input.reviewSessionId,
			runId: input.target.runId,
			taskId: input.taskId,
			severity: item.status === "missing" ? "warning" : "info",
			title: `Unit test coverage ${item.status} for completion condition: ${item.criterion}`,
			body: [
				`観点: ${item.viewpoint}`,
				`判定理由: ${item.reason}`,
				"",
				"対応テスト:",
				...(item.matchedTests.length
					? item.matchedTests.map(
							(match) =>
								`- ${match.filePath}:${match.lineNumber} ${match.testName} (${match.evidenceKind}) ${match.coveredViewpoint}`,
						)
					: ["- なし"]),
				"",
				"修正方針:",
				"- 既存テストが同じ観点を検証している場合は、完了条件との対応が分かるように test / it / describe 名を寄せる。",
				"- テスト観点が不足している場合は、該当する focused unit test を追加し、対象テストが通ることを確認する。",
			].join("\n"),
			evidenceRefsJson: item.matchedTests.map((match) => ({
				kind: "test_file",
				path: match.filePath,
				lineNumber: match.lineNumber,
			})),
			sourceSection: "review_run",
		})),
	);

	return review;
}

async function collectUnitTestCandidates(
	repoRoot: string,
): Promise<UnitTestCaseCandidate[]> {
	const files = await walkUnitTestFiles(repoRoot);
	const candidates: UnitTestCaseCandidate[] = [];
	for (const file of files) {
		let content = "";
		try {
			content = await fs.readFile(file, "utf8");
		} catch {
			continue;
		}
		const lines = content.split(/\r?\n/);
		for (const match of content.matchAll(TEST_NAME_PATTERN)) {
			if (!match[2]?.trim()) continue;
			const lineNumber = lineNumberForIndex(content, match.index ?? 0);
			candidates.push({
				filePath: path.relative(repoRoot, file).split(path.sep).join("/"),
				lineNumber,
				testName: match[2].replace(/\\(['"`])/g, "$1").trim(),
				excerpt: lines
					.slice(lineNumber - 1, lineNumber - 1 + MAX_EXCERPT_LINES)
					.join("\n")
					.slice(0, 3000),
			});
			if (candidates.length >= MAX_TEST_CANDIDATES) return candidates;
		}
	}
	return candidates;
}

async function walkUnitTestFiles(root: string) {
	const files: string[] = [];
	async function walk(dir: string) {
		let entries: Array<{
			name: string;
			isDirectory: () => boolean;
			isFile: () => boolean;
		}>;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) await walk(path.join(dir, entry.name));
				continue;
			}
			if (!entry.isFile()) continue;
			const absolute = path.join(dir, entry.name);
			const relative = path.relative(root, absolute).split(path.sep).join("/");
			if (!UNIT_TEST_FILE_PATTERN.test(relative)) continue;
			if (
				EXCLUDED_UNIT_TEST_PATH_PARTS.some((part) => relative.includes(part))
			) {
				continue;
			}
			files.push(absolute);
		}
	}
	await walk(root);
	return files.sort();
}

function lineNumberForIndex(content: string, index: number) {
	return content.slice(0, index).split(/\r?\n/).length;
}

async function reviewCoverageWithLlm(input: {
	repoRoot: string;
	criteria: string[];
	candidates: UnitTestCaseCandidate[];
	fallback: () => UnitTestCoverageReview;
	llm: typeof callStructuredJsonLLM;
}) {
	try {
		const raw = await input.llm(
			[
				"あなたは ReviewRun の単体テスト証跡確認ツールです。",
				"Plan の完了条件ごとに、unit test が同じ観点を検証しているかを判定してください。",
				"文言の完全一致は必須ではありません。test name、test body excerpt、file path から同じ振る舞い・制約・境界条件を検証していると判断できれば covered にしてください。",
				"単に関連ファイルにテストがあるだけでは covered にしないでください。",
				"JSON だけを返してください。",
			].join("\n"),
			JSON.stringify(
				{
					criteria: input.criteria,
					unitTestCandidates: input.candidates,
				},
				null,
				2,
			),
			{
				schemaName: "review_run_unit_test_coverage",
				schema: unitTestCoverageJsonSchema,
				role: "review",
				workingDirectory: input.repoRoot,
				timeoutMs: 45_000,
			},
		);
		const parsed = parseRepairedJsonWithSchema(
			raw,
			unitTestCoverageReviewSchema,
		);
		if (parsed.ok) return normalizeCoverageReview(input.criteria, parsed.value);
		return input.fallback();
	} catch {
		return input.fallback();
	}
}

function normalizeCoverageReview(
	criteria: string[],
	review: UnitTestCoverageReview,
): UnitTestCoverageReview {
	const byCriterion = new Map(
		review.criteria.map((item) => [item.criterion, item]),
	);
	return {
		version: 1,
		summary: review.summary,
		criteria: criteria.map(
			(criterion) =>
				byCriterion.get(criterion) ?? {
					criterion,
					status: "unclear" as const,
					viewpoint: criterion,
					reason: "LLM result did not include this completion condition.",
					matchedTests: [],
				},
		),
	};
}

function fallbackCoverageReview(
	matches: Awaited<ReturnType<typeof buildTestEvidencePrecheck>>["matches"],
): UnitTestCoverageReview {
	return {
		version: 1,
		summary:
			"LLM semantic review was unavailable; used test-name similarity fallback.",
		criteria: matches.map((match) => ({
			criterion: match.criterion,
			status: match.matched ? "covered" : "missing",
			viewpoint: match.criterion,
			reason: match.matched
				? `Test-name similarity fallback matched with score ${match.bestScore.toFixed(2)}.`
				: "No unit test name candidate was close enough in fallback matching.",
			matchedTests: match.candidates.map((candidate) => ({
				filePath: candidate.filePath,
				lineNumber: candidate.lineNumber,
				testName: candidate.testName,
				evidenceKind: "test_name" as const,
				coveredViewpoint: `Similarity score ${candidate.score.toFixed(2)}`,
			})),
		})),
	};
}

function emptyCoverageReview(): UnitTestCoverageReview {
	return {
		version: 1,
		summary: "No completion conditions were found in the plan.",
		criteria: [],
	};
}
