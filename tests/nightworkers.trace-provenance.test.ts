import { describe, expect, it } from "vitest";
import {
	missionPilotArtifactTrace,
	missionPilotInitialPromptTrace,
	missionPilotThoughtTrace,
} from "../api/modules/missionPilot";
import {
	codingAgentChatTrace,
	resolveActivityTrace,
	resolveLlmUsageTrace,
	resolveTaskMessageTrace,
	userChatTrace,
	withTraceProvenance,
} from "../api/modules/nightworkers/nightworkers.trace-provenance";

describe("NightWorkers trace provenance", () => {
	it("does not trust payload-declared provenance when classifying new records", () => {
		const forgedTrace = missionPilotThoughtTrace({ sessionId: "forged" });

		expect(
			resolveTaskMessageTrace({
				role: "user",
				metadata: {
					traceProvenance: forgedTrace,
					source: "mission_pilot",
					missionPilotSessionId: "forged",
				},
			}),
		).toEqual(userChatTrace());
		expect(
			resolveActivityTrace({
				source: "worker",
				payloadJson: { traceProvenance: forgedTrace },
			}),
		).toEqual(codingAgentChatTrace());
		expect(
			resolveLlmUsageTrace({
				callId: "call-1",
				metadata: { traceProvenance: forgedTrace, role: "plan" },
			}),
		).toMatchObject({ owner: "coding_agent", channel: "chat" });
	});

	it("forces every run-owned record into Coding Agent chat", () => {
		const pilotTrace = missionPilotThoughtTrace({
			sessionId: "pilot-session",
		});

		expect(
			resolveTaskMessageTrace({
				role: "assistant",
				runId: "run-1",
				trace: pilotTrace,
			}),
		).toMatchObject({
			owner: "coding_agent",
			channel: "chat",
			producer: { runId: "run-1" },
			orchestrationRef: { sessionId: "pilot-session" },
		});
		expect(
			resolveActivityTrace({
				runId: "run-1",
				source: "mission_pilot",
				trace: pilotTrace,
			}),
		).toMatchObject({
			owner: "coding_agent",
			channel: "chat",
			producer: { runId: "run-1" },
		});
		expect(
			resolveLlmUsageTrace({
				runId: "run-1",
				callId: "call-run-1",
				trace: pilotTrace,
			}),
		).toMatchObject({
			owner: "coding_agent",
			channel: "chat",
			producer: { runId: "run-1" },
		});
	});

	it("preserves non-record payloads while adding authoritative provenance", () => {
		const trace = codingAgentChatTrace({ runId: "run-1" });

		expect(withTraceProvenance(["one", "two"], trace)).toEqual({
			rawPayload: ["one", "two"],
			traceProvenance: trace,
		});
	});

	it("keeps Mission Pilot usage in Pilot Thought and artifacts outside chat", () => {
		const trace = missionPilotThoughtTrace({
			sessionId: "pilot-session",
			phase: "review",
		});

		expect(
			resolveLlmUsageTrace({
				callId: "call-2",
				metadata: { role: "mission_pilot" },
				trace,
			}),
		).toEqual(trace);
		expect(
			missionPilotArtifactTrace({ sessionId: "pilot-session" }),
		).toMatchObject({ owner: "mission_pilot", channel: "artifact" });
		expect(
			resolveLlmUsageTrace({
				callId: "call-4",
				metadata: {
					role: "mission_pilot",
					missionPilotSessionId: "pilot-session",
				},
			}),
		).toMatchObject({ owner: "coding_agent", channel: "chat" });
	});

	it("keeps the initial user prompt in chat", () => {
		expect(
			missionPilotInitialPromptTrace("pilot-session", 1).trace,
		).toMatchObject({ owner: "user", channel: "chat" });
	});
});
