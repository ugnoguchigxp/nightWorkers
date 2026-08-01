import crypto from "node:crypto";
import type {
	ExpectedEvidence,
	NormalizedTestCaseEvidence,
	NormalizedVerificationEvidence,
} from "../../../shared/schemas/verification-checklist.schema";

export type VerificationRunner = NormalizedVerificationEvidence["runner"];

export function inferVerificationRunner(input: {
	command: string;
	runnerHint?: string | null;
}): VerificationRunner {
	const hint = normalizeRunner(input.runnerHint);
	if (hint) return hint;
	const command = input.command.toLowerCase();
	if (command.includes("vitest")) return "vitest";
	if (command.includes("jest")) return "jest";
	if (command.includes("pytest")) return "pytest";
	if (command.includes("playwright")) return "playwright";
	if (command.includes("cargo nextest")) return "cargo-nextest";
	if (command.includes("cargo test")) return "cargo-test";
	if (/\bgo\s+test\b/.test(command)) return "go-test";
	return "unknown";
}

export function buildCommandLevelEvidence(input: {
	runId: string;
	taskId: string;
	command: string;
	cwd: string;
	startedAt: string;
	finishedAt: string;
	exitCode: number;
	runner: VerificationRunner;
	rawStdoutArtifactId: string;
	rawStderrArtifactId: string;
	conditionIds?: string[];
	cases?: NormalizedTestCaseEvidence[];
	evidenceKinds?: ExpectedEvidence[];
	parsedArtifactId?: string;
}): NormalizedVerificationEvidence {
	const cases = input.cases ?? [];
	const passed = cases.filter((item) => item.status === "passed").length;
	const failed = cases.filter((item) => item.status === "failed").length;
	const skipped = cases.filter((item) => item.status === "skipped").length;
	return {
		id: stableEvidenceId([
			input.runId,
			input.command,
			input.startedAt,
			input.finishedAt,
			String(input.exitCode),
		]),
		runId: input.runId,
		taskId: input.taskId,
		command: input.command,
		cwd: input.cwd,
		startedAt: input.startedAt,
		finishedAt: input.finishedAt,
		durationMs: Math.max(
			0,
			Date.parse(input.finishedAt) - Date.parse(input.startedAt),
		),
		exitCode: input.exitCode,
		runner: input.runner,
		rawStdoutArtifactId: input.rawStdoutArtifactId,
		rawStderrArtifactId: input.rawStderrArtifactId,
		parsedArtifactId: input.parsedArtifactId,
		summary:
			cases.length > 0
				? { passed, failed, skipped, total: cases.length }
				: {
						passed: input.exitCode === 0 ? null : 0,
						failed: input.exitCode === 0 ? 0 : null,
						skipped: null,
						total: null,
					},
		cases,
		evidenceKinds: Array.from(new Set(input.evidenceKinds ?? [])),
		commandLevelConditionIds: Array.from(new Set(input.conditionIds ?? [])),
	};
}

export function extractConditionIds(text: string): string[] {
	const ids = new Set<string>();
	for (const match of text.matchAll(/\bAC-\d{3}\b/g)) {
		ids.add(match[0]);
	}
	return Array.from(ids);
}

export function stableEvidenceId(parts: string[]): string {
	return crypto.createHash("sha256").update(parts.join("\n")).digest("hex");
}

function normalizeRunner(value: unknown): VerificationRunner | null {
	if (
		value === "vitest" ||
		value === "jest" ||
		value === "pytest" ||
		value === "cargo-test" ||
		value === "cargo-nextest" ||
		value === "go-test" ||
		value === "playwright" ||
		value === "junit" ||
		value === "unknown"
	) {
		return value;
	}
	return null;
}
