import { describe, expect, it } from "vitest";
import { parseRunJsonl } from "../api/services/run-events/jsonl-parse";
import { replayRunJsonl } from "../api/services/run-events/replay";

describe("run-events replay evaluator", () => {
	it("replays terminal outcome, policy evidence, verification evidence, and review results", () => {
		const runId = "11111111-1111-4111-8111-111111111113";
		const taskId = "22222222-2222-4222-8222-222222222224";
		const jsonl = [
			{
				type: "nightworkers_run",
				version: 1,
				runId,
				taskId,
				createdAt: "2026-06-02T00:00:00.000Z",
				exportedAt: "2026-06-02T00:00:10.000Z",
			},
			{
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
					type: "verification.finished",
					severity: "checkpoint",
					actor: "verifier",
					message: "ok",
				},
			},
			{
				type: "run_event",
				version: 1,
				runId,
				seq: 2,
				reviewResult: { verdict: "approved" },
				event: {
					version: 1,
					runId,
					taskId,
					seq: 2,
					timestamp: "2026-06-02T00:00:02.000Z",
					type: "human.review_submitted",
					severity: "checkpoint",
					actor: "human",
					message: "approved",
				},
			},
			{
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
				},
			},
			{
				type: "run_event",
				version: 1,
				runId,
				seq: 4,
				event: {
					version: 1,
					runId,
					taskId,
					seq: 4,
					timestamp: "2026-06-02T00:00:04.000Z",
					type: "run.outcome_decided",
					severity: "checkpoint",
					actor: "supervisor",
					message: "completed",
					data: {
						status: "completed",
						reason: "human_review",
						summary: "done",
					},
				},
			},
		]
			.map((line) => JSON.stringify(line))
			.join("\n");

		const replay = replayRunJsonl(parseRunJsonl(jsonl));

		expect(replay.terminal).toEqual({
			status: "completed",
			reason: "human_review",
			summary: "done",
		});
		expect(replay.evidence).toEqual(
			expect.objectContaining({
				hasOutcomeDecided: true,
				hasPolicyBlock: true,
				hasReviewResult: true,
				hasVerification: true,
			}),
		);
		expect(replay.policyEvents).toHaveLength(1);
		expect(replay.verificationEvents).toHaveLength(1);
		expect(replay.reviewResults).toHaveLength(1);
	});

	it("uses run summary status as fallback without treating recovery as terminal quality decision", () => {
		const runId = "11111111-1111-4111-8111-111111111115";
		const taskId = "22222222-2222-4222-8222-222222222226";
		const jsonl = [
			{
				type: "nightworkers_run",
				version: 1,
				runId,
				taskId,
				createdAt: "2026-06-02T00:00:00.000Z",
				exportedAt: "2026-06-02T00:00:10.000Z",
			},
			{
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
					type: "run.recovered",
					severity: "warning",
					actor: "system",
					message: "retryable recovery",
					data: { status: "completed" },
				},
			},
			{
				type: "run_summary",
				version: 1,
				runId,
				status: "needs_review",
				summary: "still needs review",
				diffBytes: 0,
				eventCount: 1,
			},
		]
			.map((line) => JSON.stringify(line))
			.join("\n");

		const replay = replayRunJsonl(parseRunJsonl(jsonl));

		expect(replay.terminal.status).toBe("needs_review");
		expect(replay.evidence.hasOutcomeDecided).toBe(false);
	});

	it("warns when run summary status conflicts with outcome event and keeps the event outcome", () => {
		const runId = "11111111-1111-4111-8111-111111111117";
		const taskId = "22222222-2222-4222-8222-222222222228";
		const jsonl = [
			{
				type: "nightworkers_run",
				version: 1,
				runId,
				taskId,
				createdAt: "2026-06-02T00:00:00.000Z",
				exportedAt: "2026-06-02T00:00:10.000Z",
			},
			{
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
					type: "run.outcome_decided",
					severity: "checkpoint",
					actor: "supervisor",
					message: "completed",
					data: { status: "completed", reason: "supervisor_completed" },
				},
			},
			{
				type: "run_summary",
				version: 1,
				runId,
				status: "failed",
				summary: "stale summary",
				diffBytes: 0,
				eventCount: 1,
			},
		]
			.map((line) => JSON.stringify(line))
			.join("\n");

		const replay = replayRunJsonl(parseRunJsonl(jsonl));

		expect(replay.terminal.status).toBe("completed");
		expect(replay.diagnostics).toEqual([
			expect.objectContaining({
				level: "warning",
				code: "invalid_schema",
				message: expect.stringContaining("outcome event takes precedence"),
			}),
		]);
	});
});
