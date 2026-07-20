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
		expect(prompt).toContain("選択外のtest種別の追加");
		expect(prompt).toContain("選択済みtestの欠落");
		expect(prompt).toContain(
			"選択外のE2E等をFeature Planへ追加する根拠になりません",
		);
		expect(prompt).toContain("E2Eは明示的なopt-in");
		expect(prompt).toContain(
			"確定QuestionnaireにE2Eを実施する回答がある場合だけ",
		);
		expect(prompt).toContain(
			"Questionnaireがない、検証方針の質問がない、未回答、またはE2E以外が選択されている",
		);
		expect(prompt).toContain("requiresDataMigrationがfalse");
		expect(prompt).toContain("migration作業が実装stepに無い");
		expect(prompt).toContain("新規domainと既存domain拡張を区別");
		expect(prompt).toContain("modules/[domain]の対象moduleが実装stepに無い");
		expect(prompt).toContain("中核境界が欠けたblocking finding");
		expect(prompt).toContain("既存domainの拡張、composition root、route登録");
		expect(prompt).toContain("warningまたはinfoに留め、verdictはpass");
		expect(prompt).toContain("すべてのfindingがwarningまたはinfo");
	});
});
