import { describe, expect, it } from "vitest";
import { buildWorkbenchPlanModeGatePrompt } from "../api/modules/nightworkers/nightworkers.workbench.service";

describe("workbench Plan Mode gate prompt", () => {
	it("keeps dedicated views proportional to the decisions they clarify", () => {
		const prompt = buildWorkbenchPlanModeGatePrompt("/tmp/project");

		expect(prompt).toContain("Dedicated View は Feature Plan の文章だけでは");
		expect(prompt).toContain("単純な CRUD が既存の API パターンに従い");
		expect(prompt).toContain("単一画面内で完結する一般的な CRUD 操作");
		expect(prompt).toContain("単一エンティティ、既存 actor への単純な外部キー");
		expect(prompt).toContain("時系列上の複雑さが要件または実行証跡で確認");
		expect(prompt).toContain(
			"操作フローを確認するという一般的な指示だけでは include の根拠にしない",
		);
	});
});
