import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	callStructuredJsonLLM: vi.fn(),
}));

vi.mock("../api/services/structured-llm", () => ({
	callStructuredJsonLLM: mocks.callStructuredJsonLLM,
}));

import { buildReviewEvidencePackFromRun } from "../api/modules/review/rubrics/evidence-pack";
import {
	runReviewerEvaluationFromPack,
	runReviewReplayEvaluationFromJsonl,
} from "../api/modules/review/rubrics/replay-evaluation";
import { parseRunJsonl } from "../api/services/run-events/jsonl-parse";
import { replayRunJsonl } from "../api/services/run-events/replay";

const runId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";

function fixture(name: string): string {
	return readFileSync(
		new URL(`./fixtures/reviewer-rubrics/${name}`, import.meta.url),
		"utf8",
	);
}

function buildJsonl(options: {
	verification?: boolean;
	policy?: boolean;
	diffBytes?: number;
	finalReport?: string | null;
	finalJudgmentEvent?: boolean;
}) {
	const lines: unknown[] = [
		{
			type: "nightworkers_run",
			version: 1,
			runId,
			taskId,
			createdAt: "2026-06-02T00:00:00.000Z",
			exportedAt: "2026-06-02T00:00:10.000Z",
		},
	];
	if (options.finalJudgmentEvent !== false) {
		lines.push({
			type: "run_event",
			version: 1,
			runId,
			seq: 1,
			event: {
				version: 1,
				runId,
				taskId,
				seq: 1,
				timestamp: "2026-06-02T00:00:01.000Z",
				type: "run.final_judgment_created",
				severity: "checkpoint",
				actor: "system",
				message: "Final judgment created",
			},
		});
	}
	if (options.verification) {
		lines.push({
			type: "run_event",
			version: 1,
			runId,
			seq: 2,
			event: {
				version: 1,
				runId,
				taskId,
				seq: 2,
				timestamp: "2026-06-02T00:00:02.000Z",
				type: "verification.finished",
				severity: "checkpoint",
				actor: "verifier",
				message: "Verification passed",
				data: { passed: true, command: "pnpm test" },
			},
		});
	}
	if (options.policy) {
		lines.push({
			type: "run_event",
			version: 1,
			runId,
			seq: 3,
			event: {
				version: 1,
				runId,
				taskId,
				seq: 3,
				timestamp: "2026-06-02T00:00:03.000Z",
				type: "tool.policy_blocked",
				severity: "error",
				actor: "tool",
				message: "blocked",
				data: { code: "DENY", message: "blocked" },
			},
		});
	}
	lines.push({
		type: "run_summary",
		version: 1,
		runId,
		status: "needs_review",
		summary: "Task finished",
		finalReport:
			options.finalReport === undefined ? "Task finished" : options.finalReport,
		diffBytes: options.diffBytes ?? 42,
		eventCount: lines.length - 1,
	});
	return lines.map((line) => JSON.stringify(line)).join("\n");
}

describe("review rubric replay evaluation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("keeps JSONL regression fixtures wired into deterministic replay", async () => {
		const approved = await runReviewReplayEvaluationFromJsonl({
			jsonl: fixture("basic-approved.jsonl"),
			rubricId: "basic-coding-run",
			mode: "deterministic_only",
		});
		expect(approved.finalReviewerVerdict).toBe("approved");

		const missingVerification = await runReviewReplayEvaluationFromJsonl({
			jsonl: fixture("missing-verification.jsonl"),
			rubricId: "basic-coding-run",
			mode: "deterministic_only",
		});
		expect(missingVerification.finalReviewerVerdict).toBe("changes_requested");
		expect(
			missingVerification.reviewResult.findings.map((finding) => finding.title),
		).toContain("Verification result is present");

		const policyViolation = await runReviewReplayEvaluationFromJsonl({
			jsonl: fixture("policy-violation.jsonl"),
			rubricId: "basic-coding-run",
			mode: "deterministic_only",
		});
		expect(
			policyViolation.reviewResult.findings.map((finding) => finding.title),
		).toContain("No policy violation is present");

		const reviewFollowup = await runReviewReplayEvaluationFromJsonl({
			jsonl: fixture("review-followup-needed.jsonl"),
			rubricId: "review-ready-run",
			mode: "deterministic_only",
		});
		expect(reviewFollowup.finalReviewerVerdict).toBe("approved");
		expect(reviewFollowup.evidencePack.reviewResults.length).toBeGreaterThan(0);
	});

	it("builds a reviewer result from JSONL without provider credentials", async () => {
		const result = await runReviewReplayEvaluationFromJsonl({
			jsonl: buildJsonl({ verification: true, diffBytes: 42 }),
			rubricId: "basic-coding-run",
			mode: "deterministic_only",
		});

		expect(result.reviewResult.reviewer.type).toBe("agent");
		expect(result.reviewResult.statusBefore).toBe("needs_review");
		expect(result.reviewResult.statusAfter).toBe("needs_review");
		expect(result.finalReviewerVerdict).toBe("approved");
		expect(result.events.map((event) => event.type)).toContain(
			"review.evaluation_finished",
		);
	});

	it("blocks missing verification and policy violation regardless of LLM availability", async () => {
		mocks.callStructuredJsonLLM.mockRejectedValueOnce(
			new Error("No structured LLM route candidates were available."),
		);

		const result = await runReviewReplayEvaluationFromJsonl({
			jsonl: buildJsonl({ verification: false, policy: true, diffBytes: 42 }),
			rubricId: "basic-coding-run",
			mode: "llm_assisted",
		});

		expect(result.status).toBe("degraded");
		expect(result.finalReviewerVerdict).toBe("changes_requested");
		expect(
			result.reviewResult.findings.map((finding) => finding.title),
		).toEqual(
			expect.arrayContaining([
				"Verification result is present",
				"No policy violation is present",
			]),
		);
		expect(result.degradedReasons).toContain(
			"llm_reviewer_provider_not_configured",
		);
	});

	it("does not use run summary as final report evidence during replay", async () => {
		const result = await runReviewReplayEvaluationFromJsonl({
			jsonl: buildJsonl({
				verification: true,
				diffBytes: 42,
				finalReport: null,
				finalJudgmentEvent: false,
			}),
			rubricId: "basic-coding-run",
			mode: "deterministic_only",
		});

		expect(result.finalReviewerVerdict).toBe("changes_requested");
		expect(
			result.reviewResult.findings.map((finding) => finding.title),
		).toContain("Final report is present");
	});

	it("replays reviewer events without diagnostics", async () => {
		const evaluation = await runReviewReplayEvaluationFromJsonl({
			jsonl: buildJsonl({ verification: true, diffBytes: 42 }),
			rubricId: "basic-coding-run",
			mode: "deterministic_only",
		});
		const reviewerEvent = evaluation.events.at(-1);
		const jsonl = [
			JSON.stringify({
				type: "nightworkers_run",
				version: 1,
				runId,
				taskId,
				createdAt: "2026-06-02T00:00:00.000Z",
				exportedAt: "2026-06-02T00:00:10.000Z",
			}),
			JSON.stringify({
				type: "run_event",
				version: 1,
				runId,
				seq: 1,
				event: { ...reviewerEvent, seq: 1 },
				reviewResult: evaluation.reviewResult,
			}),
		].join("\n");

		const parsed = parseRunJsonl(jsonl);
		const replay = replayRunJsonl(parsed);

		expect(parsed.diagnostics).toHaveLength(0);
		expect(replay.evidence.hasReviewResult).toBe(true);
		expect(replay.reviewResults).toHaveLength(1);
	});

	it("treats managed Test Mode checks as in-run reviewer evidence", async () => {
		const run = {
			id: runId,
			taskId,
			status: "running",
			diffPatch: "",
			finalReport: null,
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
		};
		const events = [
			buildEventRow(1, {
				type: "tool.call_finished",
				severity: "info",
				message: "run_check finished",
				data: {
					mcpTool: "run_check",
					status: "completed",
					result: {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: true,
									toolName: "run_check",
									payload: {
										checkKind: "verify",
										llmSummary: "OK verify",
									},
								}),
							},
						],
					},
				},
			}),
			buildEventRow(2, {
				type: "tool.call_finished",
				severity: "info",
				message: "completion_check finished",
				data: {
					mcpTool: "completion_check",
					status: "completed",
					result: {
						structured_content: {
							payload: {
								llmSummary: "OK completion_check",
							},
						},
					},
				},
			}),
		];
		const pack = buildReviewEvidencePackFromRun(run as never, events as never);
		const result = await runReviewerEvaluationFromPack({
			pack,
			rubricId: "basic-coding-run",
			mode: "deterministic_only",
			run,
		});

		expect(pack.context).toMatchObject({
			executionMode: "test",
			inRunReview: true,
		});
		expect(pack.verification.map((item) => item.command)).toEqual([
			"verify",
			"completion_check",
		]);
		expect(result.finalReviewerVerdict).toBe("approved");
		expect(
			result.reviewResult.findings.map((finding) => finding.title),
		).not.toEqual(
			expect.arrayContaining([
				"Diff evidence is present",
				"Final report is present",
				"Verification result is present",
			]),
		);
	});

	it("keeps final report and diff requirements outside in-run Test Mode review", async () => {
		const run = {
			id: runId,
			taskId,
			status: "running",
			diffPatch: "",
			finalReport: null,
			contextSnapshot: {
				executionMode: "implementation",
			},
		};
		const pack = buildReviewEvidencePackFromRun(run as never, []);
		const result = await runReviewerEvaluationFromPack({
			pack,
			rubricId: "basic-coding-run",
			mode: "deterministic_only",
			run,
		});

		expect(result.finalReviewerVerdict).toBe("changes_requested");
		expect(
			result.reviewResult.findings.map((finding) => finding.title),
		).toEqual(
			expect.arrayContaining([
				"Diff evidence is present",
				"Final report is present",
				"Verification result is present",
			]),
		);
	});
});

function buildEventRow(seq: number, event: Record<string, unknown>) {
	return {
		id: `event-${seq}`,
		taskRunId: runId,
		type: "info",
		message: event.message || "",
		timestamp: new Date("2026-06-02T00:00:00.000Z"),
		seq,
		actor: "worker",
		eventType: "tool_result",
		payloadJson: {
			runEvent: {
				version: 1,
				id: `run-event-${seq}`,
				runId,
				taskId,
				seq,
				timestamp: "2026-06-02T00:00:00.000Z",
				actor: "worker",
				...event,
			},
		},
	};
}
