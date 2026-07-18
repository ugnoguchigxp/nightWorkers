import { describe, expect, it } from "vitest";
import {
	formatUsageBadge,
	formatUsageTitle,
} from "../src/modules/nightworkers/components/ThreadWorkspaceBanner";
import type { TaskLlmUsageSummary } from "../src/modules/nightworkers/types";

function breakdown(
	overrides: Partial<TaskLlmUsageSummary["byOwner"]["codingAgent"]> = {},
) {
	return {
		promptInputTokens: 0,
		inputTokens: 0,
		outputTokens: 0,
		stateCardTokens: 0,
		cachedInputTokens: 0,
		nonCachedInputTokens: 0,
		reasoningOutputTokens: 0,
		totalTokens: 0,
		totalDurationMs: 0,
		averageDurationMs: null,
		usageMode: "unavailable" as const,
		callCount: 0,
		measuredCallCount: 0,
		estimatedCallCount: 0,
		lastUpdatedAt: null,
		...overrides,
	};
}

describe("Thread workspace token usage", () => {
	it("shows mutually exclusive billing token categories for each owner", () => {
		const codingAgent = breakdown({
			inputTokens: 4_600,
			nonCachedInputTokens: 1_200,
			cachedInputTokens: 3_400,
			outputTokens: 56,
			reasoningOutputTokens: 7,
			callCount: 2,
		});
		const missionPilot = breakdown({
			inputTokens: 1_700,
			nonCachedInputTokens: 800,
			cachedInputTokens: 900,
			outputTokens: 12,
			reasoningOutputTokens: 3,
			callCount: 1,
		});
		const summary: TaskLlmUsageSummary = {
			taskId: "11111111-1111-4111-8111-111111111111",
			...breakdown(),
			byOwner: { codingAgent, missionPilot },
		};

		expect(formatUsageBadge(summary)).toBe(
			"CA i:1.2k cr:3.4k o:56 | MP i:800 cr:900 o:12",
		);
		expect(formatUsageTitle(summary)).toContain(
			"Coding Agent: uncached input 1,200 / cached read 3,400 / output 56 (reasoning subset 7)",
		);
		expect(formatUsageTitle(summary)).toContain(
			"Mission Pilot: uncached input 800 / cached read 900 / output 12 (reasoning subset 3)",
		);
	});
});
