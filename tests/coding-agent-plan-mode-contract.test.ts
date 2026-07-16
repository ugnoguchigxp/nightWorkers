import { describe, expect, it } from "vitest";
import { nightWorkersCodexToolManifest } from "../api/mcp/nightworkers-tool-manifest";
import { missionPilotActionToolDefinitions } from "../api/modules/missionPilot/agent/mission-pilot-task-action.registry";
import { nativeApiToolRegistrations } from "../api/services/agent-runtime/native-api-runner/native-api-tool-manifest";
import {
	CODING_AGENT_TODO_REQUIREMENT_JA,
	CODING_AGENT_TOOL_CONTRACT_JA,
} from "../api/services/coding-agent-context/system-context";

describe("Coding Agent Plan Mode responsibility contract", () => {
	it("exposes the same Plan Mode application tool to Codex and native runtimes", () => {
		expect(nightWorkersCodexToolManifest.plan_mode).toBeDefined();
		expect(
			nativeApiToolRegistrations.some(
				(registration) =>
					registration.name === "plan_mode" &&
					registration.workerToolName === "plan_mode",
			),
		).toBe(true);
	});

	it("assigns artifact selection and user input requests to Coding Agent", () => {
		expect(CODING_AGENT_TODO_REQUIREMENT_JA).toContain(
			"必要な設計Artifactを提案・選択",
		);
		expect(CODING_AGENT_TODO_REQUIREMENT_JA).toContain("request_input");
		expect(CODING_AGENT_TOOL_CONTRACT_JA).toContain(
			"設計専用runtimeやMission Pilotの設計権限があると仮定せず",
		);
	});

	it("does not expose Plan Mode design mutations to Mission Pilot", () => {
		const names = missionPilotActionToolDefinitions().map((tool) => tool.name);
		expect(names.some((name) => name.startsWith("questionnaire_"))).toBe(false);
		expect(names.some((name) => name.startsWith("plan_artifact_"))).toBe(false);
		expect(names).not.toContain("plan_routing_update");
	});
});
