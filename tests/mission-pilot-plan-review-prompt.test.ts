import { describe, expect, it } from "vitest";
import { buildMissionPilotPlanReviewSystemPrompt } from "../api/modules/missionPilot/prompts/mission-pilot-plan-review";
import type { StructuredOutputContract } from "../api/services/structured-llm/contract";

describe("Mission Pilot plan review prompt", () => {
	it("regenerates artifacts only for clear blockers", () => {
		const contract = {
			renderOutputRequirements: () => "JSONだけを返してください。",
		} as StructuredOutputContract<unknown>;
		const prompt = buildMissionPilotPlanReviewSystemPrompt(contract);

		expect(prompt).toContain("Plan Reviewは完成度を競う校閲ではなく");
		expect(prompt).toContain("明白な事実誤認");
		expect(prompt).toContain("中核契約が欠けて実装を開始できない");
		expect(prompt).toContain("E2Eの記載不足");
		expect(prompt).toContain("warningまたはinfoに留め、verdictはpass");
		expect(prompt).toContain("すべてのfindingがwarningまたはinfo");
	});
});
