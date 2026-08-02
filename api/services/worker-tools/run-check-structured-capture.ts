import crypto from "node:crypto";
import type {
	NormalizedTestCaseEvidence,
	VerificationRunner,
} from "../../../shared/schemas/verification-checklist.schema";
import { AppError } from "../../lib/errors";
import { parseJUnitXmlArtifact } from "../verification/adapters/junit";
import { parseVitestJsonArtifact } from "../verification/adapters/vitest-json";

export function createParsedArtifactDigest(input: {
	command: string;
	format: "vitest-json" | "junit";
	stdout: string;
	stderr: string;
}) {
	return `sha256:${crypto
		.createHash("sha256")
		.update(
			[input.format, input.command, input.stdout, input.stderr].join("\n"),
		)
		.digest("hex")}`;
}

export function addStructuredReporter(
	command: string,
	runner: VerificationRunner,
) {
	if (runner !== "vitest") return command;
	const reporters = readExplicitVitestReporters(command);
	const structuredReporter = explicitStructuredVitestReporter(command);
	if (/(?:^|\s)--outputFile(?:\.[\w-]+)?(?:=|\s+|$)/i.test(command)) {
		throw captureFailure(
			"Structured reporter output files are not available to managed stdout/stderr capture.",
		);
	}
	if (reporters.length === 1 && structuredReporter !== null) {
		return command;
	}
	if (reporters.length > 0 || /(?:^|\s)--reporter(?:=|\s+)/i.test(command)) {
		throw captureFailure(
			"An explicit non-structured Vitest reporter cannot be combined safely with managed capture.",
		);
	}
	if (/[\n;&|]/.test(command)) {
		throw captureFailure(
			"Structured reporter cannot be added safely to a compound Vitest command.",
		);
	}
	if (/^npm\s+run\s+[^\s]+(?:\s+.*)?$/i.test(command)) {
		return /(?:^|\s)--(?:\s|$)/.test(command)
			? `${command} --reporter=json`
			: `${command} -- --reporter=json`;
	}
	if (/^(?:bun|pnpm|yarn)\s+run\s+[^\s]+(?:\s+.*)?$/i.test(command)) {
		return `${command} --reporter=json`;
	}
	if (
		/^(?:(?:bunx|npx)\s+(?:--no-install\s+)?vitest|vitest)(?:\s|$)/i.test(
			command,
		)
	) {
		return `${command} --reporter=json`;
	}
	throw captureFailure(
		"Structured reporter cannot be added safely to the resolved Vitest command.",
	);
}

export function resolveManagedTestRunner(
	inferredRunner: VerificationRunner,
	inventoryRunner: VerificationRunner,
) {
	if (inventoryRunner !== "junit") return inventoryRunner;
	if (inferredRunner !== "unknown" && inferredRunner !== "junit") {
		return inferredRunner;
	}
	throw captureFailure(
		"The actual runner for a legacy JUnit inventory could not be resolved from the command.",
	);
}

export function selectStructuredTestArtifactFormat(input: {
	command: string;
	runner: VerificationRunner;
	junitRecognized: boolean;
	vitestRecognized: boolean;
}): "junit" | "vitest-json" | null {
	if (input.runner === "vitest") {
		const reporter = explicitStructuredVitestReporter(input.command);
		if (reporter === "junit") {
			return input.junitRecognized ? "junit" : null;
		}
		if (reporter === "json") {
			return input.vitestRecognized ? "vitest-json" : null;
		}
	}
	if (input.junitRecognized) return "junit";
	if (input.vitestRecognized) return "vitest-json";
	return null;
}

export function parseStructuredTestArtifact(input: {
	command: string;
	runner: VerificationRunner;
	stdout: string;
	stderr: string;
	evidenceKind?: NormalizedTestCaseEvidence["evidenceKind"];
}) {
	const junit = parseJUnitXmlArtifact(`${input.stdout}\n${input.stderr}`);
	const stdoutVitest = parseVitestJsonArtifact({
		text: input.stdout,
		evidenceKind: input.evidenceKind,
	});
	const vitest = stdoutVitest.recognized
		? stdoutVitest
		: parseVitestJsonArtifact({
				text: input.stderr,
				evidenceKind: input.evidenceKind,
			});
	const format = selectStructuredTestArtifactFormat({
		command: input.command,
		runner: input.runner,
		junitRecognized: junit.recognized,
		vitestRecognized: vitest.recognized,
	});
	const runner =
		format === "vitest-json" && input.runner === "unknown"
			? ("vitest" as const)
			: input.runner;
	const cases =
		format === "junit"
			? junit.cases.map((testCase) => ({
					...testCase,
					runner,
					...(input.evidenceKind ? { evidenceKind: input.evidenceKind } : {}),
				}))
			: format === "vitest-json"
				? vitest.cases
				: [];
	return { recognized: format !== null, format, cases, runner };
}

function explicitStructuredVitestReporter(command: string) {
	const reporters = readExplicitVitestReporters(command);
	if (reporters.length !== 1) return null;
	if (reporters[0]?.toLowerCase() === "json") {
		return "json" as const;
	}
	if (reporters[0]?.toLowerCase() === "junit") {
		return "junit" as const;
	}
	return null;
}

function readExplicitVitestReporters(command: string) {
	return Array.from(
		command.matchAll(/(?:^|\s)--reporter(?:=|\s+)([^\s]+)/gi),
		(match) => match[1] ?? "",
	);
}

export function evaluateStructuredTestCapture(input: {
	managedTest: boolean;
	commandExitCode: number;
	recognized: boolean;
	mappedCaseKeys: string[];
	resolvedCases: Array<{
		caseKey?: string;
		status: "passed" | "failed" | "skipped" | "unknown";
	}>;
	ambiguousMappedCaseKeys: string[];
	mismatchedMappedCaseKeys: string[];
}):
	| {
			status: "failed" | "evidence_error";
			reason: string;
			message: string;
			suggestedAction: string;
	  }
	| undefined {
	if (!input.managedTest) return undefined;
	if (input.commandExitCode !== 0) {
		return failedCapture(
			"MAPPED_TEST_FAILED",
			"The managed test command failed.",
			"fix_test_failure",
		);
	}
	if (!input.recognized) {
		return failedCapture(
			"TEST_EVIDENCE_CAPTURE_FAILED",
			"The test command completed without a recognized structured test artifact.",
			"report_test_evidence_failure",
			"evidence_error",
		);
	}
	if (input.ambiguousMappedCaseKeys.length > 0) {
		return failedCapture(
			"TEST_IDENTITY_AMBIGUOUS",
			"Structured test identity matched more than one current inventory case.",
			"report_test_evidence_failure",
			"evidence_error",
		);
	}
	if (input.mismatchedMappedCaseKeys.length > 0) {
		return failedCapture(
			"TEST_EVIDENCE_CAPTURE_FAILED",
			"Structured test identity did not match the mapped testcase file identity.",
			"report_test_evidence_failure",
			"evidence_error",
		);
	}
	const casesByKey = new Map<
		string,
		Array<(typeof input.resolvedCases)[number]>
	>();
	for (const testCase of input.resolvedCases) {
		if (!testCase.caseKey) continue;
		const cases = casesByKey.get(testCase.caseKey) ?? [];
		cases.push(testCase);
		casesByKey.set(testCase.caseKey, cases);
	}
	if (input.mappedCaseKeys.some((caseKey) => !casesByKey.has(caseKey))) {
		return failedCapture(
			"MAPPED_TEST_NOT_RUN",
			"One or more mapped testcases were not present in the structured execution.",
			"run_check",
		);
	}
	if (
		input.mappedCaseKeys.some((caseKey) =>
			casesByKey.get(caseKey)?.some((testCase) => testCase.status !== "passed"),
		)
	) {
		return failedCapture(
			"MAPPED_TEST_FAILED",
			"One or more mapped testcases failed or did not pass.",
			"fix_test_failure",
		);
	}
	return undefined;
}

function captureFailure(message: string) {
	return new AppError(409, "TEST_EVIDENCE_CAPTURE_FAILED", message, {
		retryable: false,
		suggestedAction: "report_test_evidence_failure",
	});
}

function failedCapture(
	reason: string,
	message: string,
	suggestedAction: string,
	status: "failed" | "evidence_error" = "failed",
) {
	return { status, reason, message, suggestedAction };
}
