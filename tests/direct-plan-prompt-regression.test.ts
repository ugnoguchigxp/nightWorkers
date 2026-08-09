import { describe, expect, it } from "vitest";
import {
	buildLatestRuntimeUserMessage,
	IMPLEMENTATION_PHASE_PREAMBLE,
} from "../api/modules/nightworkers/run-orchestration/runtime-routing";

describe("direct Plan runtime prompt", () => {
	it("does not inject the Implementation phase preamble", () => {
		const result = buildLatestRuntimeUserMessage({
			fallback: "APIレーンの改善計画を作成してください。",
			planModeRequested: true,
		});

		expect(result).toBe("APIレーンの改善計画を作成してください。");
		expect(result).not.toContain(IMPLEMENTATION_PHASE_PREAMBLE);
		expect(result).not.toContain("plan mode はこの時点で終了です");
	});

	it("keeps a handoff as planning context without implementation instructions", () => {
		const result = buildLatestRuntimeUserMessage({
			fallback: "計画を見直してください。",
			planModeRequested: true,
			implementationHandoffMessage: {
				content: "既存計画",
			} as never,
		});

		expect(result).toContain("<PLANNING_CONTEXT>");
		expect(result).toContain("既存計画");
		expect(result).not.toContain("実装してください");
	});
});
