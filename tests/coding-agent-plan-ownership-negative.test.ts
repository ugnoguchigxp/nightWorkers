import { describe, expect, it } from "vitest";
import { codingAgentForbiddenPlanTools } from "../api/modules/codingAgent";
import {
	CODING_AGENT_TODO_REQUIREMENT_JA,
	CODING_AGENT_TOOL_CONTRACT_JA,
} from "../api/modules/codingAgent/context/system-context";
import { nativeApiToolRegistrations } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-manifest";

describe("Coding Agent Plan ownership negative contract", () => {
	it("does not expose Plan mutation tools in the native runtime", () => {
		expect(
			nativeApiToolRegistrations.some((registration) =>
				codingAgentForbiddenPlanTools.includes(registration.name),
			),
		).toBe(false);
	});

	it("keeps Questionnaire, routing, and Artifact ownership out of Coding Agent context", () => {
		expect(CODING_AGENT_TODO_REQUIREMENT_JA).not.toContain(
			"Questionnaireを必ず作成",
		);
		expect(CODING_AGENT_TODO_REQUIREMENT_JA).not.toContain("request_input");
		expect(CODING_AGENT_TOOL_CONTRACT_JA).toContain(
			"Questionnaire、routing、Artifactのmutation toolはありません",
		);
	});
});
