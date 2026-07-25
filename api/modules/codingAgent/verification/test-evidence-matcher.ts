import type {
	TestEvidenceReference,
	TestInventoryCase,
} from "../../../../shared/schemas/verification-checklist.schema";

export const TEST_EVIDENCE_MATCH_THRESHOLD = 0.9;

export type TestEvidenceMatch = {
	referenceIndex: number;
	reference: TestEvidenceReference;
	testCase: TestInventoryCase;
	score: number;
	nameScore: number;
	filePathScore?: number;
};

export type TestEvidenceMiss = {
	referenceIndex: number;
	reference: TestEvidenceReference;
};

export type TestEvidenceAmbiguity = {
	referenceIndex: number;
	reference: TestEvidenceReference;
	candidates: Array<{
		caseKey: string;
		score: number;
	}>;
};

export type TestEvidenceMatchResult = {
	matches: TestEvidenceMatch[];
	missing: TestEvidenceMiss[];
	ambiguous: TestEvidenceAmbiguity[];
};

export function matchTestEvidenceReferences(input: {
	references: TestEvidenceReference[];
	testCases: TestInventoryCase[];
	threshold?: number;
}): TestEvidenceMatchResult {
	const threshold = input.threshold ?? TEST_EVIDENCE_MATCH_THRESHOLD;
	if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1)
		throw new RangeError(
			"Test evidence match threshold must be within (0, 1].",
		);
	const activeCases = input.testCases
		.filter((testCase) => testCase.discoveryLevel === "active")
		.sort((left, right) => left.caseKey.localeCompare(right.caseKey))
		.map((testCase) => ({
			testCase,
			normalizedName: normalizeIdentity(testCase.name),
			normalizedFilePath: normalizeIdentity(testCase.filePath),
		}));
	const matches: TestEvidenceMatch[] = [];
	const missing: TestEvidenceMiss[] = [];
	const ambiguous: TestEvidenceAmbiguity[] = [];

	for (const [referenceIndex, reference] of input.references.entries()) {
		const normalizedReference = {
			reference,
			normalizedName: normalizeIdentity(reference.testName),
			normalizedFilePath: reference.filePath
				? normalizeIdentity(reference.filePath)
				: undefined,
		};
		const ranked = activeCases
			.filter(
				(candidate) =>
					reference.runner === undefined ||
					candidate.testCase.runner === reference.runner,
			)
			.flatMap((candidate) => {
				const score = scoreTestEvidenceReference(
					normalizedReference,
					candidate,
					threshold,
				);
				return score ? [score] : [];
			})
			.sort(
				(left, right) =>
					right.score - left.score ||
					left.testCase.caseKey.localeCompare(right.testCase.caseKey),
			);
		const best = ranked[0];
		if (!best) {
			missing.push({ referenceIndex, reference });
			continue;
		}
		if (ranked.length > 1) {
			ambiguous.push({
				referenceIndex,
				reference,
				candidates: ranked.map((candidate) => ({
					caseKey: candidate.testCase.caseKey,
					score: candidate.score,
				})),
			});
			continue;
		}
		matches.push({ referenceIndex, reference, ...best });
	}

	return { matches, missing, ambiguous };
}

export function stringSimilarity(left: string, right: string): number {
	const normalizedLeft = normalizeIdentity(left);
	const normalizedRight = normalizeIdentity(right);
	if (normalizedLeft === normalizedRight) return 1;
	if (!normalizedLeft.length || !normalizedRight.length) return 0;
	const distance = levenshteinDistance(normalizedLeft, normalizedRight);
	return (
		1 -
		distance /
			Math.max(
				Array.from(normalizedLeft).length,
				Array.from(normalizedRight).length,
			)
	);
}

function scoreTestEvidenceReference(
	reference: {
		reference: TestEvidenceReference;
		normalizedName: string;
		normalizedFilePath?: string;
	},
	testCase: {
		testCase: TestInventoryCase;
		normalizedName: string;
		normalizedFilePath: string;
	},
	threshold: number,
) {
	const nameScore = normalizedStringSimilarityAtThreshold(
		reference.normalizedName,
		testCase.normalizedName,
		threshold,
	);
	if (nameScore === null) return null;
	const filePathScore = reference.normalizedFilePath
		? normalizedStringSimilarityAtThreshold(
				reference.normalizedFilePath,
				testCase.normalizedFilePath,
				threshold,
			)
		: undefined;
	if (filePathScore === null) return null;
	const score =
		filePathScore === undefined ? nameScore : (nameScore + filePathScore) / 2;
	return { testCase: testCase.testCase, score, nameScore, filePathScore };
}

function normalizedStringSimilarityAtThreshold(
	normalizedLeft: string,
	normalizedRight: string,
	threshold: number,
) {
	if (normalizedLeft === normalizedRight) return 1;
	if (!normalizedLeft.length || !normalizedRight.length) return null;
	const leftLength = Array.from(normalizedLeft).length;
	const rightLength = Array.from(normalizedRight).length;
	const maximumLength = Math.max(leftLength, rightLength);
	const maximumDistance = Math.floor((1 - threshold) * maximumLength + 1e-9);
	if (Math.abs(leftLength - rightLength) > maximumDistance) return null;
	const distance = levenshteinDistance(
		normalizedLeft,
		normalizedRight,
		maximumDistance,
	);
	if (distance > maximumDistance) return null;
	const score = 1 - distance / maximumLength;
	return score + Number.EPSILON >= threshold ? score : null;
}

function normalizeIdentity(value: string): string {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase("en-US")
		.replaceAll("\\", "/")
		.replace(/^\.\//, "")
		.replace(/[\s\p{P}\p{S}]+/gu, " ")
		.trim();
}

function levenshteinDistance(
	left: string,
	right: string,
	maximumDistance = Number.POSITIVE_INFINITY,
): number {
	const leftPoints = Array.from(left);
	const rightPoints = Array.from(right);
	let previous = Array.from(
		{ length: rightPoints.length + 1 },
		(_, index) => index,
	);

	for (const [leftIndex, leftPoint] of leftPoints.entries()) {
		const current = [leftIndex + 1];
		let rowMinimum = leftIndex + 1;
		for (const [rightIndex, rightPoint] of rightPoints.entries()) {
			const insertion = (current[rightIndex] ?? 0) + 1;
			const deletion = (previous[rightIndex + 1] ?? 0) + 1;
			const substitution =
				(previous[rightIndex] ?? 0) + (leftPoint === rightPoint ? 0 : 1);
			const value = Math.min(insertion, deletion, substitution);
			current.push(value);
			rowMinimum = Math.min(rowMinimum, value);
		}
		if (rowMinimum > maximumDistance) return maximumDistance + 1;
		previous = current;
	}

	return previous[rightPoints.length] ?? leftPoints.length;
}
