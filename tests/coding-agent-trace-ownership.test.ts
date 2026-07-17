import { describe, expect, it } from "vitest";
import {
	isCodingAgentChatMessage,
	isCodingAgentChatTrace,
} from "../src/modules/codingAgent";

describe("Coding Agent chat trace ownership", () => {
	it("accepts only Coding Agent activity in chat", () => {
		expect(
			isCodingAgentChatTrace({
				traceOwner: "coding_agent",
				traceChannel: "chat",
			}),
		).toBe(true);
		expect(
			isCodingAgentChatTrace({
				traceOwner: "mission_pilot",
				traceChannel: "chat",
			}),
		).toBe(false);
		expect(
			isCodingAgentChatTrace({
				traceOwner: "coding_agent",
				traceChannel: "pilot_thought",
			}),
		).toBe(false);
	});

	it("keeps user prompts while rejecting Mission Pilot messages", () => {
		expect(
			isCodingAgentChatMessage({
				role: "user",
				traceOwner: "user",
				traceChannel: "chat",
			}),
		).toBe(true);
		expect(
			isCodingAgentChatMessage({
				role: "assistant",
				traceOwner: "coding_agent",
				traceChannel: "chat",
			}),
		).toBe(true);
		expect(
			isCodingAgentChatMessage({
				role: "assistant",
				traceOwner: "mission_pilot",
				traceChannel: "artifact",
			}),
		).toBe(false);
	});
});
