import { describe, expect, it } from "vitest";
import { buildWorkbenchPlanModeGatePrompt } from "../api/modules/nightworkers/nightworkers.workbench.service";

describe("workbench Plan Mode gate prompt", () => {
	it("limits intake to the Plan Mode entry decision", () => {
		const prompt = buildWorkbenchPlanModeGatePrompt("/tmp/project");

		expect(prompt).toContain(
			"このintake gateはPlan Modeへ入るかだけを判断します",
		);
		expect(prompt).toContain("dedicatedViewsとspecificationLensesは必ず空配列");
		expect(prompt).toContain(
			"設計Artifactのroutingと入力要求は、Plan Modeへ入った後にMission Pilot",
		);
	});
});
