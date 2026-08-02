import type {
	ExpectedEvidence,
	NormalizedTestCaseEvidence,
	VerificationRunner,
} from "../../../../shared/schemas/verification-checklist.schema";
import { stableEvidenceId } from "../normalized-evidence";

type VitestJsonResult = {
	testResults?: Array<{
		name?: unknown;
		assertionResults?: Array<{
			ancestorTitles?: unknown;
			title?: unknown;
			fullName?: unknown;
			status?: unknown;
			duration?: unknown;
			failureMessages?: unknown;
		}>;
	}>;
};

export function parseVitestJsonCases(input: {
	text: string;
	evidenceKind?: ExpectedEvidence;
}): NormalizedTestCaseEvidence[] {
	return parseVitestJsonArtifact(input).cases;
}

export function parseVitestJsonArtifact(input: {
	text: string;
	evidenceKind?: ExpectedEvidence;
}): { recognized: boolean; cases: NormalizedTestCaseEvidence[] } {
	const parsed = parseJsonObject(input.text);
	if (!parsed) return { recognized: false, cases: [] };
	const result = parsed as VitestJsonResult;
	if (!Array.isArray(result.testResults)) {
		return { recognized: false, cases: [] };
	}
	if (
		result.testResults.some(
			(fileResult) =>
				!isRecord(fileResult) ||
				!Array.isArray(fileResult.assertionResults) ||
				fileResult.assertionResults.some(
					(assertion) => !isRecord(assertion) || !readAssertionName(assertion),
				),
		)
	) {
		return { recognized: false, cases: [] };
	}
	const cases = result.testResults.flatMap((fileResult) => {
		const filePath =
			typeof fileResult.name === "string" && fileResult.name.trim()
				? fileResult.name.trim()
				: undefined;
		if (!Array.isArray(fileResult.assertionResults)) return [];
		return fileResult.assertionResults.flatMap((assertion) => {
			const name = readAssertionName(assertion);
			if (!name) return [];
			const status = normalizeStatus(assertion.status);
			const failureMessage = Array.isArray(assertion.failureMessages)
				? assertion.failureMessages
						.filter((item): item is string => typeof item === "string")
						.join("\n")
						.trim()
				: "";
			return [
				{
					id: stableEvidenceId([filePath ?? "", name, status]),
					name,
					...(filePath ? { filePath } : {}),
					runner: "vitest" as VerificationRunner,
					...(isAutomatedEvidenceKind(input.evidenceKind)
						? { evidenceKind: input.evidenceKind }
						: {}),
					status,
					...(typeof assertion.duration === "number" && assertion.duration >= 0
						? { durationMs: assertion.duration }
						: {}),
					conditionIds: [],
					...(failureMessage ? { failureMessage } : {}),
				},
			];
		});
	});
	return { recognized: true, cases };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
	try {
		const parsed = JSON.parse(trimmed);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readAssertionName(
	assertion: NonNullable<
		NonNullable<VitestJsonResult["testResults"]>[number]["assertionResults"]
	>[number],
) {
	if (typeof assertion.fullName === "string" && assertion.fullName.trim()) {
		return assertion.fullName.trim();
	}
	const ancestors = Array.isArray(assertion.ancestorTitles)
		? assertion.ancestorTitles.filter(
				(item): item is string =>
					typeof item === "string" && Boolean(item.trim()),
			)
		: [];
	const title =
		typeof assertion.title === "string" ? assertion.title.trim() : "";
	return [...ancestors, title].filter(Boolean).join(" ");
}

function normalizeStatus(value: unknown): NormalizedTestCaseEvidence["status"] {
	if (value === "passed") return "passed";
	if (value === "failed") return "failed";
	if (value === "pending" || value === "skipped" || value === "todo") {
		return "skipped";
	}
	return "unknown";
}

function isAutomatedEvidenceKind(
	value: ExpectedEvidence | undefined,
): value is "automated_test" | "unit_test" | "integration_test" | "e2e_test" {
	return (
		value === "automated_test" ||
		value === "unit_test" ||
		value === "integration_test" ||
		value === "e2e_test"
	);
}
