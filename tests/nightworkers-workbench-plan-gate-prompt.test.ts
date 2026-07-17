import { describe, expect, it } from "vitest";
import {
	buildCodingAgentPlanModeGatePrompt,
	buildCodingAgentPlanModeGateUserPrompt,
} from "../api/modules/codingAgent";

describe("Coding Agent Plan Mode gate prompt", () => {
	it("lets the LLM decide whether material decisions require a plan first", () => {
		const prompt = buildCodingAgentPlanModeGatePrompt("/tmp/project");

		expect(prompt).toContain("同じCoding Agent runtimeを直ちに開始できるか");
		expect(prompt).toContain(
			"実装前の計画作成を求めている場合はPlan Modeを選んでください",
		);
		expect(prompt).toContain("実装開始前に整合させるべき重要な判断");
		expect(prompt).toContain("公開契約、既存利用者、データ、運用");
		expect(prompt).toContain("『リファクタ』");
		expect(prompt).toContain("keywordや固定の規模閾値ではなく");
		expect(prompt).toContain("通常のrepository調査で解消できる未知だけなら");
		expect(prompt).not.toContain("リファクタは shouldStartPlanMode=false");
		expect(prompt).not.toContain("判断に迷う場合は");
	});

	it("keeps the gate to a plan-or-coding-agent decision", () => {
		const prompt = buildCodingAgentPlanModeGatePrompt("/tmp/project");

		expect(prompt).toContain("action=plan_mode");
		expect(prompt).toContain("action=coding_agent");
		expect(prompt).toContain("Artifact routingは判断せず、出力にも含めない");
		expect(prompt).not.toContain("dedicatedViews");
		expect(prompt).not.toContain("specificationLenses");
		expect(prompt).not.toContain('action="general_answer"');
		expect(prompt).not.toContain('action="review"');
	});

	it("provides the initial message, task history, and structural run provenance", () => {
		const prompt = buildCodingAgentPlanModeGateUserPrompt({
			prompt: "Mission PilotとCoding Agentを分離する大きなリファクタを行う",
			task: {
				status: "draft",
				title: "Agent境界を再設計する",
				objective: "Coding Agentを単独で完結可能にする",
				description: "初期Promptの要件を保持する",
				acceptanceCriteria: "Mission Pilot停止中も実装できる",
				createdBy: "user",
			},
			messages: [
				{
					role: "user",
					content: "Mission Pilotを停止しても動作させたい",
					metadataJson: { intent: "intake" },
				},
				{
					role: "assistant",
					content: "# Implementation Plan\n\n旧境界を段階的に分離する",
					metadataJson: { intent: "implementation_plan" },
				},
			],
			runs: [
				{
					status: "completed",
					summary: "前回の計画を作成した",
					contextSnapshot: { planModeRequested: true },
				},
			],
		});

		expect(prompt).toContain("[Task Context]");
		expect(prompt).toContain("Task acceptance criteria");
		expect(prompt).toContain("[Existing Plan Evidence]");
		expect(prompt).toContain("intent=implementation_plan");
		expect(prompt).toContain("[Latest Runs]");
		expect(prompt).toContain("planModeRequested=true");
		expect(prompt).toContain("[Recent Conversation]");
		expect(prompt).toContain("[Current User Message]");
		expect(prompt).toContain("Mission PilotとCoding Agentを分離");
	});
});
