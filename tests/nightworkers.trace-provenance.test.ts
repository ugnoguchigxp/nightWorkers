import { describe, expect, it } from "vitest";
import {
	codingAgentChatTrace,
	missionPilotThoughtTrace,
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
		).toMatchObject({ owner: "system", channel: "internal" });
	});

	it("preserves non-record payloads while adding authoritative provenance", () => {
		const trace = codingAgentChatTrace({ runId: "run-1" });

		expect(withTraceProvenance(["one", "two"], trace)).toEqual({
			rawPayload: ["one", "two"],
			traceProvenance: trace,
		});
	});

	it("accepts explicit provenance supplied through the trusted call contract", () => {
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
	});
});
