import type { ReactElement, ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let copiedState: string | null = null;
const setCopied = vi.fn();

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return { ...actual, useState: () => [copiedState, setCopied] };
});
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) =>
			options ? `${key}:${Object.values(options).join(":")}` : key,
	}),
}));

let cards: typeof import("../src/modules/nightworkers/components/ThreadTimelineAgentCards");

beforeAll(async () => {
	cards = await import(
		"../src/modules/nightworkers/components/ThreadTimelineAgentCards"
	);
});

beforeEach(() => {
	copiedState = null;
	setCopied.mockReset();
	vi.useRealTimers();
	vi.stubGlobal("navigator", {
		clipboard: { writeText: vi.fn(async () => {}) },
	});
});

function event(overrides: Record<string, unknown> = {}) {
	return {
		id: "event-1",
		eventType: "custom.event",
		type: "fallback.type",
		message: "Event message",
		payloadJson: {},
		...overrides,
	} as never;
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
	if (
		node == null ||
		typeof node === "boolean" ||
		typeof node === "string" ||
		typeof node === "number"
	)
		return [];
	if (Array.isArray(node)) return node.flatMap(elements);
	const element = node as ReactElement<Record<string, unknown>>;
	return [element, ...elements(element.props.children as ReactNode)];
}

describe("timeline agent cards coverage", () => {
	it("recognizes every reviewer event type and renders loaded/started variants", () => {
		for (const type of [
			"review.rubric_loaded",
			"review.evaluation_started",
			"review.llm_started",
			"review.llm_finished",
			"review.evaluation_finished",
		])
			expect(cards.isReviewerEvaluationEvent(event({ eventType: type }))).toBe(
				true,
			);
		expect(cards.isReviewerEvaluationEvent(event({ eventType: "other" }))).toBe(
			false,
		);
		expect(
			cards.ReviewerEvaluationCard({ event: event({ eventType: "other" }) }),
		).toBeNull();

		const started = cards.ReviewerEvaluationCard({
			event: event({
				payloadJson: {
					runEvent: {
						type: "review.evaluation_started",
						data: {
							deterministicVerdict: "revise",
							blockingFindingCount: 2,
							degradedReasons: ["missing evidence"],
						},
					},
				},
			}),
		});
		expect(elements(started)).not.toHaveLength(0);
		const loaded = cards.ReviewerEvaluationCard({
			event: event({
				eventType: "review.rubric_loaded",
				payloadJson: {
					runEvent: {
						data: {
							finalReviewerVerdict: "approve",
							status: "complete",
							degradedReasons: "none",
						},
					},
				},
			}),
		});
		expect(elements(loaded)).not.toHaveLength(0);
	});

	it("summarizes unified diffs, apply_patch fallbacks, and replace_content variants", () => {
		const diff = cards.getAgentEditSummary(
			event({
				payloadJson: {
					code: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new",
				},
			}),
		);
		expect(diff).toMatchObject({
			toolName: "git_diff",
			sections: [{ path: "a.ts", added: 1, deleted: 1 }],
		});

		const changed = cards.getAgentEditSummary(
			event({
				payloadJson: {
					toolName: "apply_patch",
					arguments: {},
					result: { ok: true, changedFiles: ["a.ts"] },
				},
			}),
		);
		expect(changed).toMatchObject({
			toolName: "apply_patch",
			sections: [{ path: "a.ts", detail: "applied" }],
		});
		const failed = cards.getAgentEditSummary(
			event({
				payloadJson: {
					toolName: "apply_patch",
					arguments: {},
					status: "failed",
					result: { ok: false, changedFiles: ["b.ts"] },
				},
			}),
		);
		expect(failed).toMatchObject({
			sections: [{ path: "b.ts", detail: "failed" }],
		});
		expect(
			cards.getAgentEditSummary(
				event({ payloadJson: { toolName: "apply_patch" } }),
			),
		).toBeNull();

		const singular = cards.getAgentEditSummary(
			event({
				payloadJson: {
					iteration: 1,
					ok: true,
					toolName: "replace_content",
					arguments: { filePath: "a.ts", needle: "a", replacement: "b" },
					payload: { occurrences: 1, filePath: "a.ts" },
				},
			}),
		);
		expect(singular?.sections[0]?.detail).toBe("1 occurrence");
		const requested = cards.getAgentEditSummary(
			event({
				payloadJson: {
					toolName: "replace_content",
					arguments: { filePath: "a.ts" },
					payload: {},
				},
			}),
		);
		expect(requested?.sections[0]?.detail).toBe("replacement requested");
		expect(
			cards.getAgentEditSummary(
				event({ payloadJson: { toolName: "replace_content", arguments: {} } }),
			),
		).toBeNull();
		expect(
			cards.getAgentEditSummary(
				event({ payloadJson: { toolName: "run_command" } }),
			),
		).toBeNull();
		expect(
			cards.hasAgentEditSummary(
				event({ payloadJson: { toolName: "run_command" } }),
			),
		).toBe(false);
	});

	it("renders edit cards with counts, details, code blocks, and null fallback", () => {
		expect(
			cards.AgentEditSummaryCard({
				event: event({ payloadJson: { toolName: "unknown" } }),
			}),
		).toBeNull();
		const node = cards.AgentEditSummaryCard({
			event: event({
				payloadJson: {
					toolName: "replace_content",
					arguments: { filePath: "a.ts", needle: "old", replacement: "new" },
					payload: { occurrences: 2 },
				},
			}),
		});
		expect(elements(node)).not.toHaveLength(0);
		const diffNode = cards.AgentEditSummaryCard({
			event: event({
				payloadJson: {
					code: "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b",
				},
			}),
		});
		expect(elements(diffNode)).not.toHaveLength(0);
	});

	it("renders debug metadata, review result, patch lines, and copy lifecycle", async () => {
		vi.useFakeTimers();
		const debugEvent = event({
			actor: "mission_pilot",
			message: "Debug",
			payloadJson: {
				runEvent: { type: "runtime.decision" },
				toolCall: { name: "apply_patch" },
				correctionRequest: { instruction: "Revise the plan" },
				reviewResult: {
					action: "review",
					verdict: "approve",
					statusAfter: "done",
					note: "looks good",
					outcome: { summary: "accepted" },
				},
				round: 2,
				phase: "review",
				patchContent: "+added\n-removed\n\ncontext",
			},
		});
		const node = cards.AgentDebugEventCard({
			event: debugEvent,
			variant: "dock",
			timestamp: "12:00",
		});
		const all = elements(node);
		expect(
			all.some((element) => element.type === cards.ReviewResultSummary),
		).toBe(true);
		const button = all.find((element) => element.type === "button");
		if (!button || typeof button.props.onClick !== "function") {
			throw new Error("Expected debug copy button");
		}
		await (button.props.onClick as () => Promise<void>)();
		expect(navigator.clipboard.writeText).toHaveBeenCalled();
		expect(setCopied).toHaveBeenCalledWith("event-1");
		vi.runAllTimers();
		const updater = setCopied.mock.calls.at(-1)?.[0] as (
			current: string | null,
		) => string | null;
		expect(updater("event-1")).toBeNull();
		expect(updater("other")).toBe("other");

		copiedState = "event-1";
		const copied = cards.AgentDebugEventCard({ event: debugEvent });
		expect(elements(copied)).not.toHaveLength(0);
	});

	it("renders minimal debug and optional review-result fields", () => {
		const minimal = cards.AgentDebugEventCard({
			event: event({ eventType: null, type: null, payloadJson: null }),
		});
		expect(elements(minimal)).not.toHaveLength(0);
		const invalidReview = cards.AgentDebugEventCard({
			event: event({
				payloadJson: {
					reviewResult: [],
					round: "2",
					phase: 4,
					toolName: "run",
				},
			}),
		});
		expect(elements(invalidReview)).not.toHaveLength(0);

		const full = cards.ReviewResultSummary({
			reviewResult: {
				action: "a",
				verdict: "v",
				statusAfter: "s",
				note: "note",
				outcome: { summary: "summary" },
			} as never,
		});
		const sparse = cards.ReviewResultSummary({
			reviewResult: { action: "a", verdict: "v", statusAfter: "s" } as never,
		});
		expect(elements(full).length).toBeGreaterThan(elements(sparse).length);
	});
});
