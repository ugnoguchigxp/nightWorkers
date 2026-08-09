import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunEventBase } from "../api/services/run-events/types";

const canonicalize = vi.hoisted(() => ({
	canonicalizeTaskEvent: vi.fn(
		(row: { canonical?: RunEventBase }) => row.canonical as RunEventBase,
	),
}));

vi.mock("../api/services/run-events/canonicalize", () => canonicalize);

import {
	buildEvidenceRefExistenceSet,
	buildReviewEvidencePackFromReplay,
	buildReviewEvidencePackFromRun,
	buildReviewEvidencePackFromRuns,
	redactSecretLikeValues,
	refKey,
} from "../api/modules/review/rubrics/evidence-pack";

function run(overrides: Record<string, unknown> = {}) {
	return {
		id: "run-1",
		taskId: "task-1",
		status: "completed",
		diffPatch: "",
		finalReport: null,
		contextSnapshot: null,
		...overrides,
	} as never;
}

function event(
	type: string,
	overrides: Record<string, unknown> = {},
): RunEventBase {
	return {
		version: 1,
		id: `${type}-${Math.random()}`,
		runId: "run-1",
		taskId: "task-1",
		seq: 1,
		timestamp: "2026-08-09T00:00:00.000Z",
		type,
		severity: "info",
		actor: "system",
		message: type,
		...overrides,
	} as RunEventBase;
}

function row(canonical: RunEventBase, payloadJson: unknown = null) {
	return { canonical, payloadJson } as never;
}

function replay(overrides: Record<string, unknown> = {}) {
	return {
		sourceRunId: "replay-run",
		eventCount: 0,
		events: [],
		todos: [],
		terminal: {},
		evidence: {
			hasRuntimeStarted: false,
			hasRuntimeFinished: false,
			hasOutcomeDecided: false,
			hasDiff: false,
			hasVerification: false,
			hasPolicyBlock: false,
			hasReviewResult: false,
			hasTodos: false,
		},
		reviewResults: [],
		policyEvents: [],
		verificationEvents: [],
		diagnostics: [],
		...overrides,
	} as never;
}

beforeEach(() => {
	canonicalize.canonicalizeTaskEvent.mockClear();
});

describe("review evidence pack extra coverage", () => {
	it("redacts every supported secret shape and leaves ordinary text intact", () => {
		const input = [
			"sk-abcdefghijklmnopqrstuvwxyz",
			"api_key=plain-secret",
			"my.password: hidden-value",
			"AKIAABCDEFGHIJKLMNOP",
			"ordinary value",
		].join(" ");
		const output = redactSecretLikeValues(input);
		expect(output.match(/\[REDACTED\]/g)).toHaveLength(4);
		expect(output).toContain("ordinary value");
	});

	it("builds all run evidence kinds, redacts nested values, limits events, and sorts files", () => {
		const manySelected = Array.from({ length: 52 }, (_, index) =>
			event("system.error", {
				id: `selected-${index}`,
				seq: index,
				message: `error ${index} token=secret-${index}`,
				data: index === 0 ? null : {},
			}),
		);
		const evidenceEvents = [
			event("verification.finished", {
				id: "canonical-verification",
				data: {
					command: "bun test password=raw",
					passed: true,
					summary: "passed token=raw",
				},
			}),
			event("tool.call_finished", {
				id: "managed-run-check",
				data: {
					toolName: "nightworkers.run_check",
					arguments: { checkKind: "fallback-kind" },
					result: {
						content: [
							null,
							{ type: "image", text: "ignored" },
							{
								type: "text",
								text: JSON.stringify({
									ok: true,
									payload: {
										checkKind: "unit",
										llmSummary: "ok api-key=raw",
									},
								}),
							},
						],
					},
					status: "failed",
				},
			}),
			event("tool.call_finished", {
				id: "managed-completion-check",
				message: "completed",
				data: {
					mcpTool: "completion_check",
					toolResult: {
						ok: false,
						structured_content: {
							payload: { status: "completed", llmSummary: "quality gate" },
						},
					},
					status: "completed",
				},
			}),
			event("tool.call_started"),
			event("tool.call_finished", { data: { toolName: "other" } }),
			event("tool.policy_blocked", {
				id: "policy-block",
				severity: "error",
				message: "blocked",
				data: { code: "DENY", message: "password=blocked" },
			}),
			event("safety.policy_violation", {
				id: "policy-default",
				severity: "warning",
				message: "",
				data: { message: 42 },
			}),
			event("human.review_submitted", {
				id: "human-review",
				data: {
					note: "token=human-secret",
					nested: ["api_key=nested-secret", null, 4],
				},
			}),
			event("review.evaluation_finished", {
				id: "evaluation-review",
				data: { reviewResult: { verdict: "approved" } },
			}),
			event("run.outcome_decided", {
				id: "outcome-old",
				data: { status: "failed" },
			}),
			event("run.outcome_decided", {
				id: "outcome-latest",
				data: {
					outcome: {
						status: "completed",
						reason: "done token=secret",
						summary: "summary api_key=secret",
					},
				},
			}),
		];
		const eventRows = [...manySelected, ...evidenceEvents].map((item) =>
			row(item),
		);
		eventRows.push(
			row(event("system.info"), {
				reviewResult: {
					verdict: "approved",
					note: "secret=from-row",
				},
			}),
			row(event("system.info"), { reviewResult: null }),
		);

		const pack = buildReviewEvidencePackFromRun(
			run({
				status: "running",
				contextSnapshot: { executionMode: "implementation" },
				diffPatch: [
					"diff --git a/z.ts b/z.ts",
					"diff --git a/a.ts b/a.ts",
					"diff --git a/z.ts b/z.ts",
					"+token=diff-secret",
				].join("\n"),
				finalReport: `${"x".repeat(4_100)} token=report-secret`,
			}),
			eventRows,
		);

		expect(pack.context).toEqual({
			executionMode: "implementation",
			inRunReview: true,
		});
		expect(pack.diff.changedFiles).toEqual(["a.ts", "z.ts"]);
		expect(pack.diff.hasChanges).toBe(true);
		expect(pack.finalReport).toHaveLength(4_003);
		expect(pack.finalReport?.endsWith("...")).toBe(true);
		expect(pack.outcome).toEqual({
			status: "completed",
			reason: "done [REDACTED]",
			summary: "summary [REDACTED]",
		});
		expect(pack.verification).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					eventId: "canonical-verification",
					passed: true,
				}),
				expect.objectContaining({
					eventId: "managed-run-check",
					command: "unit",
					passed: true,
				}),
				expect.objectContaining({
					eventId: "managed-completion-check",
					command: "completion_check",
					passed: false,
				}),
			]),
		);
		expect(pack.policy).toContainEqual({
			eventId: "policy-default",
			code: undefined,
			message: "Policy violation",
		});
		expect(JSON.stringify(pack)).not.toContain("human-secret");
		expect(JSON.stringify(pack)).not.toContain("from-row");
		expect(pack.reviewResults).toHaveLength(3);
		expect(pack.selectedEvents).toHaveLength(50);
		expect(pack.selectedEvents[0]?.id).not.toBe("selected-0");
		expect(pack.selectedEvents.at(-1)?.id).toBe("outcome-latest");
	});

	it("uses event diff bytes and covers invalid, negative, patch, and fallback values", () => {
		const negative = buildReviewEvidencePackFromRun(run(), [
			row(event("git.diff_collected", { data: { bytes: -10 } })),
		]);
		expect(negative.diff).toMatchObject({ hasChanges: false, bytes: 0 });

		const patch = buildReviewEvidencePackFromRun(run(), [
			row(
				event("git.diff_collected", {
					data: { bytes: Number.POSITIVE_INFINITY, patch: "+api_key=raw" },
				}),
			),
		]);
		expect(patch.diff.bytes).toBe(Buffer.byteLength("+[REDACTED]"));

		const alternate = buildReviewEvidencePackFromRun(run(), [
			row(event("git.diff_collected", { data: { diffBytes: 8 } })),
		]);
		expect(alternate.diff.bytes).toBe(8);

		const none = buildReviewEvidencePackFromRun(run(), [
			row(event("system.info", { data: undefined })),
		]);
		expect(none.diff.bytes).toBe(0);
	});

	it("falls through malformed managed tool result shapes and status defaults", () => {
		const malformed = [
			event("tool.call_finished", {
				id: "not-array",
				data: {
					mcpTool: "run_check",
					arguments: { checkKind: "argument-kind" },
					result: { content: "not-an-array" },
					status: "completed",
				},
			}),
			event("tool.call_finished", {
				id: "no-text",
				data: {
					mcpTool: "run_check",
					result: { content: [null, { type: "image", text: "ignored" }] },
					status: "completed",
				},
			}),
			event("tool.call_finished", {
				id: "bad-json",
				data: {
					mcpTool: "run_check",
					arguments: [],
					result: { content: [{ type: "text", text: "{" }] },
					status: "failed",
				},
			}),
			event("tool.call_finished", {
				id: "nested-structured",
				data: {
					mcpTool: "run_check",
					result: {
						result: {
							structuredContent: {
								payload: { checkKind: "nested", status: "completed" },
							},
						},
					},
				},
			}),
		];
		const pack = buildReviewEvidencePackFromRun(
			run(),
			malformed.map((item) => row(item)),
		);
		expect(pack.verification).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					eventId: "not-array",
					command: "argument-kind",
					passed: true,
				}),
				expect.objectContaining({
					eventId: "bad-json",
					command: "run_check",
					passed: false,
				}),
				expect.objectContaining({
					eventId: "nested-structured",
					command: "nested",
					passed: true,
				}),
			]),
		);
	});

	it("indexes every evidence reference kind and its optional fallback key", () => {
		const pack = {
			version: 1,
			runId: "run-refs",
			taskId: "task-refs",
			status: "completed",
			finalReport: "done",
			diff: {
				hasChanges: true,
				bytes: 2,
				changedFiles: ["src/a.ts", "src/b.ts"],
			},
			verification: [
				{ eventId: "verify-event", command: "bun test" },
				{ command: "bun lint" },
				{},
			],
			policy: [
				{ eventId: "policy-event", code: "DENY", message: "blocked" },
				{ code: "WARN", message: "warning" },
				{ message: "message-only" },
				{},
			],
			reviewResults: [],
			selectedEvents: [
				{
					id: "selected-event",
					type: "system.error",
					severity: "error",
					message: "error",
				},
				{ type: "system.info", severity: "info", message: "without id" },
			],
			eventTypes: [],
			diagnostics: [],
		} as never;

		const keys = buildEvidenceRefExistenceSet(pack);
		expect([...keys]).toEqual(
			expect.arrayContaining([
				"diff:run-refs",
				"final_report:run-refs",
				"run_event:selected-event",
				"verification:verify-event",
				"verification:bun lint",
				"verification:unknown",
				"policy:policy-event",
				"policy:WARN",
				"policy:message-only",
				"policy:unknown",
				"changed_file:src/a.ts",
				"changed_file:src/b.ts",
			]),
		);
		expect(refKey({ kind: "artifact", artifactId: "artifact-1" })).toBe(
			"artifact:artifact-1",
		);

		const withoutFinal = buildEvidenceRefExistenceSet({
			...pack,
			finalReport: undefined,
		});
		expect(withoutFinal.has("final_report:run-refs")).toBe(false);
	});

	it("handles missing and invalid terminal and final judgment evidence", () => {
		const noTerminal = buildReviewEvidencePackFromRun(run(), [
			row(event("run.outcome_decided", { data: { status: 5 } })),
			row(
				event("run.final_judgment_created", {
					data: { finalReport: 4, finalJudgment: "invalid" },
				}),
			),
		]);
		expect(noTerminal.outcome).toBeUndefined();
		expect(noTerminal.finalReport).toBeUndefined();

		const conclusion = buildReviewEvidencePackFromRun(run(), [
			row(
				event("run.final_judgment_created", {
					data: { finalJudgment: { conclusion: "concluded token=secret" } },
				}),
			),
		]);
		expect(conclusion.finalReport).toBe("concluded [REDACTED]");

		const direct = buildReviewEvidencePackFromRun(run(), [
			row(
				event("run.final_judgment_created", {
					data: { finalReport: "direct report" },
				}),
			),
		]);
		expect(direct.finalReport).toBe("direct report");
	});

	it("combines multiple source runs and an optional verification snapshot", () => {
		const sourceOne = run({
			id: "source-1",
			finalReport: "first",
			status: "completed",
		});
		const sourceTwo = run({
			id: "source-2",
			finalReport: "second",
			status: "completed",
		});
		const pack = buildReviewEvidencePackFromRuns({
			reviewRun: run({
				id: "review-run",
				status: "running",
				contextSnapshot: { executionMode: "custom-review" },
			}),
			sources: [
				{
					run: sourceOne,
					events: [
						row(event("verification.finished", { data: { passed: true } })),
					],
				},
				{
					run: sourceTwo,
					events: [
						row(
							event("run.outcome_decided", {
								data: { status: "completed" },
							}),
						),
					],
				},
			],
			manifest: {
				version: 3,
				digest: "manifest-digest",
				taskId: "task-1",
				contextDigest: null,
				verificationSnapshotId: "snapshot-1",
				verificationSnapshotDigest: "snapshot-digest",
				sourceRuns: [{ runId: "source-1" }, { runId: "source-2" }],
				targetFiles: [
					{ path: "b.ts", diffDigest: "b", diffBytes: 5 },
					{ path: "a.ts", diffDigest: "a", diffBytes: 3 },
				],
			} as never,
		});
		expect(pack).toMatchObject({
			runId: "review-run",
			manifestDigest: "manifest-digest",
			sourceRunIds: ["source-1", "source-2"],
			verificationSnapshotId: "snapshot-1",
			context: { executionMode: "custom-review", inRunReview: true },
			outcome: { status: "completed" },
			finalReport: "first\n\nsecond",
			diff: {
				hasChanges: true,
				bytes: 8,
				changedFiles: ["b.ts", "a.ts"],
			},
		});
		expect(pack.verification).toHaveLength(1);
	});

	it("uses review defaults when source runs and optional manifest data are absent", () => {
		const pack = buildReviewEvidencePackFromRuns({
			reviewRun: run({
				id: "review-run",
				contextSnapshot: [],
			}),
			sources: [],
			manifest: {
				version: 3,
				digest: "empty-manifest",
				taskId: "task-1",
				contextDigest: null,
				verificationSnapshotId: null,
				verificationSnapshotDigest: null,
				sourceRuns: [],
				targetFiles: [],
			},
		});
		expect(pack.context).toEqual({
			executionMode: "review",
			inRunReview: false,
		});
		expect(pack.outcome).toBeUndefined();
		expect(pack.finalReport).toBe("");
		expect(pack.diff).toEqual({
			hasChanges: false,
			bytes: 0,
			changedFiles: [],
		});
		expect(pack).not.toHaveProperty("verificationSnapshotId");
	});

	it("builds replay evidence from JSONL events, summary, and diagnostics", () => {
		const runEvents = [
			event("git.diff_collected", {
				runId: "replay-run",
				taskId: "replay-task",
				data: { bytes: 12 },
			}),
			event("verification.finished", {
				runId: "replay-run",
				taskId: "replay-task",
				data: { passed: true },
			}),
			event("tool.policy_blocked", {
				runId: "replay-run",
				taskId: "replay-task",
				message: "blocked",
			}),
		];
		const pack = buildReviewEvidencePackFromReplay(
			replay({
				terminal: {
					status: "failed",
					reason: "reason",
					summary: "summary",
				},
				evidence: { hasDiff: true },
				reviewResults: [{ approved: false }],
				diagnostics: [
					{ level: "warning", code: "invalid_json", message: "bad json" },
				],
			}),
			runEvents.map((item, index) => ({
				type: "run_event",
				version: 1,
				runId: "replay-run",
				seq: index + 1,
				event: item,
			})),
			{
				type: "run_summary",
				version: 1,
				runId: "replay-run",
				status: "failed",
				finalReport: "summary report token=secret",
				diffBytes: 12,
				eventCount: 3,
			},
		);
		expect(pack).toMatchObject({
			runId: "replay-run",
			taskId: "replay-task",
			status: "failed",
			outcome: { status: "failed", reason: "reason", summary: "summary" },
			finalReport: "summary report [REDACTED]",
			diff: { hasChanges: true, bytes: 12 },
			diagnostics: ["warning:invalid_json:bad json"],
		});
		expect(pack.verification).toHaveLength(1);
		expect(pack.policy).toHaveLength(1);
	});

	it("falls back to replay evidence and default status when JSONL events are absent", () => {
		const verificationEvent = event("verification.finished", {
			data: { passed: false },
		});
		const policyEvent = event("safety.policy_violation", {
			message: "violation",
		});
		const pack = buildReviewEvidencePackFromReplay(
			replay({
				evidence: { hasDiff: true },
				verificationEvents: [verificationEvent],
				policyEvents: [policyEvent],
			}),
		);
		expect(pack.taskId).toBe("");
		expect(pack.status).toBe("unknown");
		expect(pack.outcome).toBeUndefined();
		expect(pack.diff).toEqual({
			hasChanges: true,
			bytes: 1,
			changedFiles: [],
		});
		expect(pack.verification).toHaveLength(1);
		expect(pack.policy).toHaveLength(1);
	});

	it("falls back from an invalid summary report to final judgment replay evidence", () => {
		const finalEvent = event("run.final_judgment_created", {
			data: { finalReport: "event final" },
		});
		const pack = buildReviewEvidencePackFromReplay(
			replay(),
			[
				{
					type: "run_event",
					version: 1,
					runId: "replay-run",
					seq: 1,
					event: finalEvent,
				},
			],
			{
				type: "run_summary",
				version: 1,
				runId: "replay-run",
				status: "unknown",
				finalReport: null,
				diffBytes: 0,
				eventCount: 1,
			},
		);
		expect(pack.finalReport).toBe("event final");
	});
});
