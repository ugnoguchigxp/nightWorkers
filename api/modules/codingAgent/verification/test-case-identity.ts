import { realpathSync } from "node:fs";
import path from "node:path";
import type { TestInventoryCase } from "../../../../shared/schemas/verification-checklist.schema";

export function normalizeTestCaseName(value: string) {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/\s*>\s*/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function normalizeTestCasePath(value: string) {
	return value.normalize("NFKC").replaceAll("\\", "/");
}

export function resolveAbsoluteTestCasePath(input: {
	filePath: string;
	cwd: string;
}) {
	const absolutePath = path.isAbsolute(input.filePath)
		? path.resolve(input.filePath)
		: path.resolve(input.cwd, input.filePath);
	let canonicalPath = absolutePath;
	try {
		canonicalPath = realpathSync.native(absolutePath);
	} catch {
		// Preserve the lexical path when a reporter references a removed file.
	}
	return normalizeTestCasePath(canonicalPath);
}

export function resolveInventoryRelativeTestCasePath(input: {
	filePath: string;
	cwd: string;
}) {
	const absoluteFile = path.isAbsolute(input.filePath)
		? path.resolve(input.filePath)
		: path.resolve(input.cwd, input.filePath);
	return normalizeTestCasePath(path.relative(input.cwd, absoluteFile));
}

export function assignShortTestCaseKeys(cases: TestInventoryCase[]) {
	return [...cases].sort(compareTestInventoryCases).map((testCase, index) => ({
		...testCase,
		caseKey: `T${index + 1}`,
	}));
}

export function compareTestInventoryCases(
	left: TestInventoryCase,
	right: TestInventoryCase,
) {
	return (
		compareCodeUnits(left.runner, right.runner) ||
		compareCodeUnits(
			normalizeTestCasePath(left.filePath),
			normalizeTestCasePath(right.filePath),
		) ||
		compareCodeUnits(
			normalizeTestCaseName(left.name),
			normalizeTestCaseName(right.name),
		) ||
		compareCodeUnits(left.caseKey, right.caseKey)
	);
}

function compareCodeUnits(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function isLegacyStaticCaseKey(caseKey: string) {
	return caseKey.startsWith("static:");
}
