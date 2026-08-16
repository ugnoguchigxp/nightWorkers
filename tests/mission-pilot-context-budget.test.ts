import { describe, expect, it } from "vitest";
import { resolveMissionPilotContextBudgets } from "../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-context-budget";
import {
	estimateMissionPilotCompactionGateTokens,
	MISSION_PILOT_COMPACTION_GATE_ALGORITHM_VERSION,
} from "../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-context-envelope";
import {
	estimateMissionPilotUsageTokens,
	MISSION_PILOT_USAGE_ESTIMATE_ALGORITHM_VERSION,
} from "../packages/mission-pilot/src/services/conversation-context/token-budget";

describe("Mission Pilot context budget contract", () => {
	it("rejects a hard budget below the soft compaction budget before runtime work", () => {
		expect(() =>
			resolveMissionPilotContextBudgets({
				softTokenBudget: 32_001,
				hardTokenBudget: 32_000,
			}),
		).toThrow("MISSION_PILOT_CONTEXT_TOKEN_BUDGET_INVALID");
	});

	it("keeps purpose-specific estimates explainable for ASCII, Japanese, emoji, and tools", () => {
		const messages = [{ role: "user" as const, content: "ASCII と日本語😀" }];
		const tools = [
			{
				name: "read_status",
				description: "状態を読む",
				inputSchema: {
					type: "object",
					properties: { id: { type: "string" } },
					required: ["id"],
					additionalProperties: false,
				},
			},
		];
		expect(
			estimateMissionPilotUsageTokens(messages[0].content),
		).toBeGreaterThan(0);
		expect(
			estimateMissionPilotCompactionGateTokens({
				systemContext: "system",
				messages,
				tools,
			}),
		).toBeGreaterThanOrEqual(2_000);
		expect({
			usage: MISSION_PILOT_USAGE_ESTIMATE_ALGORITHM_VERSION,
			compaction: MISSION_PILOT_COMPACTION_GATE_ALGORITHM_VERSION,
		}).toEqual({
			usage: "characters_div_4_v1",
			compaction: "utf8_bytes_div_4_plus_2000_v1",
		});
	});
});
