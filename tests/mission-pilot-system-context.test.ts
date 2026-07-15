import { describe, expect, it } from "vitest";
import {
	buildMissionPilotSystemContext,
	MISSION_PILOT_TOOL_GUIDANCE,
} from "../api/services/structured-generation/prompts/mission-pilot-system-context";

describe("Mission Pilot system context", () => {
	it("treats the initial prompt as an execution request instead of a chat prompt", () => {
		const context = buildMissionPilotSystemContext({
			authorization: null,
			pushPolicy: null,
		});

		expect(context).toContain(
			"Taskの初回プロンプトはMission Pilotへの実行依頼です",
		);
		expect(context).toContain(
			"初回プロンプトを言い換えたり、これから行うことを説明したりするだけで待機してはいけません",
		);
		expect(MISSION_PILOT_TOOL_GUIDANCE).toContain(
			"安全に実行できるactionがあるのに、予定や説明だけをassistant本文へ書いてturnを終了しない",
		);
		expect(MISSION_PILOT_TOOL_GUIDANCE).not.toContain(
			"assistant本文だけでturnを終了してよい",
		);
	});

	it("answers an actionable Questionnaire on the user's behalf", () => {
		const context = buildMissionPilotSystemContext({
			authorization: { scopes: { plan: true } },
			pushPolicy: "allowed",
		});

		expect(context).toContain("ユーザーの代わりに回答してください");
		expect(context).toContain("questionnaireの回答・確定actionを実行します");
		expect(context).toContain(
			"設問のrecommended answerがあれば採用してください",
		);
		expect(context).toContain("未確認のmutationを完了扱いにしないでください");
	});
});
