import { describe, expect, it, vi } from "vitest";

function schema(values: string[]) {
	return {
		safeParse: (value: unknown) =>
			typeof value === "string" && values.includes(value)
				? { success: true, data: value }
				: { success: false },
	};
}

vi.mock("../shared/modules/codingAgent", () => ({
	evidenceCheckConfirmationStatusSchema: schema([
		"settled",
		"confirmed",
		"awaiting_confirmation",
		"awaiting_initial_verify",
	]),
	evidenceCheckMappingStatusSchema: schema(["matched", "partial", "unmatched"]),
	evidenceCheckReadinessSnapshotSchema: {
		shape: {
			suggestedAction: schema([
				"write_final_report",
				"fix_verify",
				"confirm_evidence",
				"run_initial_verify",
				"inspect",
			]),
		},
	},
	evidenceCheckVerifyStatusSchema: schema(["passed", "failed", "not_run"]),
}));

vi.mock("../src/modules/agentsShare", () => ({
	sanitizeTerminalText: (value: string) => value.replaceAll("\u001B[31m", ""),
}));

import {
	buildCommandVerificationEvidenceSummary,
	buildManagedVerificationEvidenceSummary,
	isCompletedVerificationEvidence,
} from "../src/modules/codingAgent/verificationEvidenceCardModel";

function managed(
	payload: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
) {
	return buildManagedVerificationEvidenceSummary({
		args: {},
		result: { payload, ...overrides },
		lifecycle: "result",
	});
}

function completion(
	completionResult: Record<string, unknown>,
	lifecycle: "started" | "progress" | "result" | "failed" = "result",
) {
	return buildManagedVerificationEvidenceSummary({
		args: {},
		result: {
			payload: {
				checkKind: "completion_check",
				result: completionResult,
			},
		},
		lifecycle,
	});
}

describe("verificationEvidenceCardModel extra coverage", () => {
	it("classifies every lifecycle completion boundary", () => {
		expect(isCompletedVerificationEvidence("started")).toBe(false);
		expect(isCompletedVerificationEvidence("progress")).toBe(false);
		expect(isCompletedVerificationEvidence("result")).toBe(true);
		expect(isCompletedVerificationEvidence("failed")).toBe(true);
	});

	it("builds all managed labels, state labels, commands, evidence, and output states", () => {
		const labels = {
			lint: "Lintチェック",
			format_check: "フォーマットチェック",
			typecheck: "型チェック",
			test: "テスト",
			coverage: "カバレッジチェック",
			build: "ビルドチェック",
			verify: "総合検証",
			other: "検証チェック",
		};
		for (const [checkKind, label] of Object.entries(labels)) {
			const summary = managed({ checkKind, exitCode: 0 });
			expect(summary).toMatchObject({ checkKind, label, state: "passed" });
			expect(summary.headline).toContain("完了しました");
			expect(summary.resultText).toContain(`OK ${checkKind}`);
		}

		const running = buildManagedVerificationEvidenceSummary({
			args: { checkKind: "lint", command: "args command" },
			result: { payload: { stdout: "\u001B[31mrunning" } },
			lifecycle: "started",
		});
		expect(running).toMatchObject({
			state: "running",
			command: "args command",
			evidence: "unknown",
		});
		expect(running.headline).toContain("実行中です");
		expect(running.resultText).toContain("RUNNING lint");
		expect(running.resultText).toContain("running");
		expect(running.resultText).not.toContain("\u001B[31m");

		const failed = buildManagedVerificationEvidenceSummary({
			args: {},
			defaultCheckKind: "test",
			result: {
				ok: false,
				payload: {
					command: "payload command",
					exitCode: null,
					managedEvidence: false,
					llmSummary: "\u001B[31msummary",
					stderr: "failure details",
				},
			},
			lifecycle: "failed",
		});
		expect(failed).toMatchObject({
			checkKind: "test",
			state: "failed",
			command: "payload command",
			exitCode: null,
			evidence: "not_saved",
		});
		expect(failed.resultText).toContain("ERROR test");
		expect(failed.resultText).toContain("exitCode=pending");
		expect(failed.resultText).toContain("stderr\nfailure details");

		const unknown = managed({});
		expect(unknown).toMatchObject({
			checkKind: "other",
			state: "unknown",
		});
		expect(unknown.headline).toContain("結果を受け取りました");
		expect(unknown.resultText).toBe("RESULT other");
	});

	it("normalizes checklist, quality gate, condition ids, and all saved-evidence signals", () => {
		const detailed = managed({
			checkKind: "coverage",
			exitCode: 1,
			command: "coverage command",
			conditionIds: ["AC-1", 2, "AC-2"],
			managedEvidence: true,
			checklist: {
				complete: false,
				failedRequired: 2,
				unknownRequired: Number.NaN,
			},
			result: {
				qualityGate: {
					passed: false,
					inventory: { status: "passed" },
					testExecution: {},
					fullVerify: { status: "failed" },
				},
			},
		});
		expect(detailed).toMatchObject({
			state: "failed",
			evidence: "saved",
			conditionIds: ["AC-1", "AC-2"],
			checklist: {
				complete: false,
				failedRequired: 2,
				unknownRequired: 0,
			},
			qualityGate: {
				passed: false,
				inventory: "passed",
				testExecution: "unknown",
				fullVerify: "failed",
			},
		});

		const fromArgs = buildManagedVerificationEvidenceSummary({
			args: {
				checkKind: "build",
				conditionIds: ["ARG-1", null],
			},
			result: {
				payload: {
					evidenceRunId: "run-evidence",
					checklist: { complete: "invalid" },
					result: { qualityGate: { passed: "invalid" } },
				},
			},
			lifecycle: "result",
		});
		expect(fromArgs).toMatchObject({
			evidence: "saved",
			conditionIds: ["ARG-1"],
			checklist: null,
			qualityGate: undefined,
		});
	});

	it("builds command summaries for supported classes and every command lifecycle state", () => {
		expect(
			buildCommandVerificationEvidenceSummary({
				data: {},
				command: "echo",
				commandClass: "other",
				lifecycle: "result",
			}),
		).toBeUndefined();

		const broad = buildCommandVerificationEvidenceSummary({
			data: {
				exitCode: 0,
				conditionIds: ["AC-1", false],
				aggregatedOutput: "all good",
			},
			command: "npm verify",
			commandClass: "broad_verification",
			lifecycle: "result",
		});
		expect(broad).toMatchObject({
			checkKind: "verify",
			state: "passed",
			conditionIds: ["AC-1"],
		});
		expect(broad?.resultText).toContain("all good");

		const cases = [
			["started", {}, "running"],
			["progress", { exitCode: 1 }, "running"],
			["result", { exitCode: 2 }, "failed"],
			["failed", {}, "failed"],
			["result", {}, "unknown"],
		] as const;
		for (const [lifecycle, data, state] of cases) {
			expect(
				buildCommandVerificationEvidenceSummary({
					data: { checkKind: "", ...data },
					command: "command",
					commandClass: "verification",
					lifecycle,
				}),
			).toMatchObject({ checkKind: "other", state });
		}
	});

	it("parses structured, snake-case, text, fallback payload, and outcome precedence", () => {
		const structured = buildManagedVerificationEvidenceSummary({
			args: {},
			result: {
				structuredContent: {
					payload: { checkKind: "lint", exitCode: 0 },
					outcome: { domainOutcome: "failed" },
				},
				payload: { checkKind: "ignored" },
			},
			lifecycle: "result",
		});
		expect(structured).toMatchObject({ checkKind: "lint", state: "failed" });

		const snake = buildManagedVerificationEvidenceSummary({
			args: {},
			result: {
				structured_content: {
					payload: { checkKind: "format_check", exitCode: 0 },
				},
				ok: true,
			},
			lifecycle: "result",
		});
		expect(snake).toMatchObject({ checkKind: "format_check", state: "passed" });

		const text = buildManagedVerificationEvidenceSummary({
			args: {},
			result: {
				content: [
					{ text: "" },
					{ text: "not json" },
					{ text: "[]" },
					{
						text: JSON.stringify({
							ok: false,
							payload: { checkKind: "typecheck", exitCode: 0 },
						}),
					},
				],
				payload: { checkKind: "ignored" },
				ok: true,
			},
			lifecycle: "result",
		});
		expect(text).toMatchObject({ checkKind: "typecheck", state: "failed" });

		const noContent = buildManagedVerificationEvidenceSummary({
			args: {},
			result: { content: "invalid", payload: { checkKind: "build" }, ok: true },
			lifecycle: "result",
		});
		expect(noContent).toMatchObject({ checkKind: "build", state: "passed" });
	});

	it("maps running and successful completion checks including mapping and reason", () => {
		for (const lifecycle of ["started", "progress"] as const) {
			const summary = completion({}, lifecycle);
			expect(summary).toMatchObject({
				state: "running",
				headline: "Evidence Checkを確認しています",
				evidenceCheck: {
					confirmation: "checking",
					verify: "unknown",
					suggestedAction: "wait",
				},
			});
		}

		const settled = completion({
			confirmation: { status: "settled" },
			verify: { status: "passed" },
			suggestedAction: "inspect",
			reason: "all evidence present",
			mapping: { status: "matched", matched: 3, total: 3 },
		});
		expect(settled).toMatchObject({
			state: "passed",
			headline: "Evidence Checkが完了しました",
			evidence: "saved",
			evidenceCheck: {
				reason: "all evidence present",
				mapping: { status: "matched", matched: 3, total: 3 },
			},
		});

		const writeFinal = completion({
			confirmation: { status: "awaiting_confirmation" },
			verify: { status: "passed" },
			suggestedAction: "write_final_report",
		});
		expect(writeFinal).toMatchObject({ state: "passed" });
	});

	it("maps every completion action headline and invalid legacy status fallback", () => {
		const cases = [
			[
				{
					confirmation: { status: "confirmed" },
					verify: { status: "passed" },
					suggestedAction: "confirm_evidence",
				},
				"Evidence Checkを確認しました",
				"needs_action",
			],
			[
				{
					confirmation: { status: "awaiting_confirmation" },
					verify: { status: "not_run" },
					suggestedAction: "confirm_evidence",
				},
				"Evidence Checkの確認が必要です",
				"needs_action",
			],
			[
				{
					confirmation: { status: "awaiting_initial_verify" },
					verify: { status: "not_run" },
					suggestedAction: "run_initial_verify",
				},
				"初回Verifyが必要です",
				"needs_action",
			],
			[
				{
					confirmation: { status: "awaiting_confirmation" },
					verify: { status: "failed" },
					suggestedAction: "fix_verify",
				},
				"Follow-up Verifyの修正が必要です",
				"failed",
			],
			[
				{
					confirmation: { status: "invalid" },
					verify: { status: "passed" },
					suggestedAction: "inspect",
					mapping: { status: "invalid", matched: 1, total: 1 },
				},
				"Evidence Checkの確認結果を受け取りました",
				"needs_action",
			],
		] as const;

		for (const [result, headline, state] of cases) {
			const summary = completion(result as never);
			expect(summary).toMatchObject({ headline, state });
		}

		const missing = completion({
			confirmation: { status: "invalid" },
			verify: { status: "invalid" },
			suggestedAction: "invalid",
		});
		expect(missing.evidenceCheck).toBeUndefined();
		expect(missing).toMatchObject({ state: "unknown", evidence: "unknown" });
	});

	it("omits incomplete mapping and normalizes invalid numeric and array values", () => {
		const summary = completion({
			confirmation: { status: "confirmed" },
			verify: { status: "passed" },
			suggestedAction: "confirm_evidence",
			mapping: {
				status: "partial",
				matched: Number.POSITIVE_INFINITY,
				total: "2",
			},
		});
		expect(summary.evidenceCheck).not.toHaveProperty("mapping");

		const invalid = buildManagedVerificationEvidenceSummary({
			args: { conditionIds: "not-array", command: 42 },
			result: {
				payload: {
					exitCode: "1",
					stdout: 1,
					stderr: null,
					llmSummary: {},
				},
			},
			lifecycle: "result",
		});
		expect(invalid).toMatchObject({
			command: undefined,
			exitCode: undefined,
			conditionIds: [],
			resultText: "RESULT other",
		});
	});
});
