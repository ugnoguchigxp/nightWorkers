import { promises as fs } from "node:fs";
import path from "node:path";
import * as repo from "../nightworkers/nightworkers.repository";

type TaskMessage = Awaited<ReturnType<typeof repo.listTaskMessages>>[number];

export type AcceptanceCriterionMatch = {
	criterion: string;
	matched: boolean;
	bestScore: number;
	testNames: string[];
	candidates: Array<{
		testName: string;
		filePath: string;
		lineNumber: number;
		score: number;
	}>;
};

export type AcceptanceTestCoverageResult = {
	version: 1;
	taskId: string;
	repositoryPath: string | null;
	planFound: boolean;
	planMessageId: string | null;
	planTitle: string | null;
	criteria: string[];
	testFilesScanned: number;
	testNamesScanned: number;
	matches: AcceptanceCriterionMatch[];
};

const PLAN_INTENTS = new Set([
	"feature_plan",
	"implementation_plan",
	"draft_spec",
]);
const TEST_FILE_PATTERN =
	/(?:^|[/.])(?:[^/]*\.)?(?:test|spec|cases)\.[cm]?[jt]sx?$|(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$/;
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
const TEST_NAME_PATTERN =
	/\b(?:describe|it|test)(?:\.(?:only|skip|todo|concurrent))?\s*\(\s*(['"`])((?:\\.|(?!\1).){1,240})\1/g;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function messageMetadata(message: TaskMessage) {
	return isRecord(message.metadataJson) ? message.metadataJson : {};
}

function planContentFrom(message: TaskMessage) {
	const metadata = messageMetadata(message);
	const markdownDocumentData = isRecord(metadata.markdownDocumentData)
		? metadata.markdownDocumentData
		: {};
	return {
		title:
			typeof markdownDocumentData.title === "string"
				? markdownDocumentData.title
				: typeof metadata.title === "string"
					? metadata.title
					: null,
		content:
			typeof markdownDocumentData.content === "string"
				? markdownDocumentData.content
				: message.content,
	};
}

function isPlanMessage(message: TaskMessage) {
	const metadata = messageMetadata(message);
	return (
		message.messageType === "markdown_document" &&
		typeof metadata.intent === "string" &&
		PLAN_INTENTS.has(metadata.intent)
	);
}

function latestPlanMessage(messages: TaskMessage[]) {
	return [...messages].reverse().find(isPlanMessage) ?? null;
}

function headingLevel(line: string) {
	const match = /^(#{1,6})\s+\S/.exec(line.trim());
	return match?.[1]?.length ?? null;
}

function isAcceptanceHeading(line: string) {
	const normalized = line
		.replace(/^#+\s*/, "")
		.trim()
		.toLowerCase();
	return (
		normalized.includes("acceptance criteria") ||
		normalized.includes("acceptance_criteria") ||
		normalized.includes("受け入れ条件") ||
		normalized.includes("受入条件")
	);
}

export function extractAcceptanceCriteriaFromMarkdown(
	markdown: string,
): string[] {
	const lines = markdown.split(/\r?\n/);
	const criteria: string[] = [];
	let activeLevel: number | null = null;

	for (const line of lines) {
		const level = headingLevel(line);
		if (level !== null) {
			if (activeLevel !== null && level <= activeLevel) break;
			if (isAcceptanceHeading(line)) activeLevel = level;
			continue;
		}
		if (activeLevel === null) continue;
		const item = /^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/.exec(line);
		if (item?.[1]) criteria.push(cleanCriterion(item[1]));
	}

	return [...new Set(criteria.filter(Boolean))];
}

function cleanCriterion(value: string) {
	return value
		.replace(/\s+/g, " ")
		.replace(/[`*_~]/g, "")
		.trim();
}

function criteriaFromTaskField(value: string | null | undefined) {
	if (!value?.trim()) return [];
	return value
		.split(/\r?\n/)
		.map((line) => cleanCriterion(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")))
		.filter(Boolean);
}

async function walkTestFiles(root: string) {
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
			if (TEST_FILE_PATTERN.test(relative)) files.push(absolute);
		}
	}
	await walk(root);
	return files.sort();
}

type ExtractedTestName = {
	testName: string;
	filePath: string;
	lineNumber: number;
};

function lineNumberForIndex(content: string, index: number) {
	return content.slice(0, index).split(/\r?\n/).length;
}

async function extractTestNames(root: string) {
	const files = await walkTestFiles(root);
	const names: ExtractedTestName[] = [];
	for (const file of files) {
		let content = "";
		try {
			content = await fs.readFile(file, "utf8");
		} catch {
			continue;
		}
		for (const match of content.matchAll(TEST_NAME_PATTERN)) {
			if (match[2]?.trim()) {
				names.push({
					testName: match[2].replace(/\\(['"`])/g, "$1").trim(),
					filePath: path.relative(root, file).split(path.sep).join("/"),
					lineNumber: lineNumberForIndex(content, match.index ?? 0),
				});
			}
		}
	}
	const unique = new Map<string, ExtractedTestName>();
	for (const item of names) {
		unique.set(`${item.filePath}:${item.lineNumber}:${item.testName}`, item);
	}
	return {
		testFilesScanned: files.length,
		testNames: [...unique.values()],
	};
}

function normalizeText(value: string) {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function wordTokens(value: string) {
	return normalizeText(value)
		.split(" ")
		.filter((token) => token.length >= 2);
}

function characterNgrams(value: string, size = 3) {
	const compact = normalizeText(value).replace(/\s+/g, "");
	if (compact.length < size) return compact ? [compact] : [];
	const grams: string[] = [];
	for (let index = 0; index <= compact.length - size; index += 1) {
		grams.push(compact.slice(index, index + size));
	}
	return grams;
}

function diceScore(left: string[], right: string[]) {
	if (left.length === 0 || right.length === 0) return 0;
	const rightSet = new Set(right);
	const overlap = left.filter((token) => rightSet.has(token)).length;
	return (2 * overlap) / (left.length + right.length);
}

function similarity(left: string, right: string) {
	const normalizedLeft = normalizeText(left);
	const normalizedRight = normalizeText(right);
	if (!normalizedLeft || !normalizedRight) return 0;
	if (normalizedLeft === normalizedRight) return 1;
	if (
		Math.min(normalizedLeft.length, normalizedRight.length) >= 6 &&
		(normalizedLeft.includes(normalizedRight) ||
			normalizedRight.includes(normalizedLeft))
	) {
		return 0.92;
	}
	return Math.max(
		diceScore(wordTokens(left), wordTokens(right)),
		diceScore(characterNgrams(left), characterNgrams(right)),
	);
}

function matchCriteria(
	criteria: string[],
	testNames: ExtractedTestName[],
): AcceptanceCriterionMatch[] {
	return criteria.map((criterion) => {
		const scored = testNames
			.map((testName) => ({
				...testName,
				score: similarity(criterion, testName.testName),
			}))
			.filter((item) => item.score >= 0.34)
			.sort((a, b) => b.score - a.score)
			.slice(0, 5);
		return {
			criterion,
			matched: scored.length > 0,
			bestScore: scored[0]?.score ?? 0,
			testNames: scored.map((item) => item.testName),
			candidates: scored.map((item) => ({
				testName: item.testName,
				filePath: item.filePath,
				lineNumber: item.lineNumber,
				score: item.score,
			})),
		};
	});
}

export async function buildTestEvidencePrecheck(input: {
	taskId: string;
	repositoryId: string;
}): Promise<AcceptanceTestCoverageResult> {
	const [task, repository, messages] = await Promise.all([
		repo.getTask(input.taskId),
		repo.getRepository(input.repositoryId),
		repo.listTaskMessages(input.taskId),
	]);
	const planMessage = latestPlanMessage(messages);
	const plan = planMessage ? planContentFrom(planMessage) : null;
	const planCriteria = plan
		? extractAcceptanceCriteriaFromMarkdown(plan.content)
		: [];
	const criteria =
		planCriteria.length > 0
			? planCriteria
			: criteriaFromTaskField(task?.acceptanceCriteria);
	const repositoryPath = repository?.localPath ?? null;
	const scanned = repositoryPath
		? await extractTestNames(repositoryPath)
		: null;
	const testNames = scanned?.testNames ?? [];
	return {
		version: 1 as const,
		taskId: input.taskId,
		repositoryPath,
		planFound: Boolean(plan),
		planMessageId: planMessage?.id ?? null,
		planTitle: plan?.title ?? null,
		criteria,
		testFilesScanned: scanned?.testFilesScanned ?? 0,
		testNamesScanned: testNames.length,
		matches: matchCriteria(criteria, testNames),
	};
}
