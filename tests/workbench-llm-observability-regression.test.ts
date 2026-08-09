import { describe, expect, it } from "vitest";
import {
	runEventToActivityStatus,
	runEventToActivityTurnId,
} from "../api/modules/nightworkers/nightworkers.activity.repository";
import { workbenchLlmActivityProjection } from "../api/modules/nightworkers/nightworkers.workbench.service";

describe("Workbench LLM observability", () => {
	it("projects non-stream request lifecycle events without waiting for deltas", () => {
		expect(
			workbenchLlmActivityProjection({
				type: "model.request_started",
				severity: "info",
				message: "started",
			}),
		).toEqual({ kind: "llm.request", status: "started" });
		expect(
			workbenchLlmActivityProjection({
				type: "model.request_failed",
				severity: "error",
				message: "failed",
			}),
		).toEqual({ kind: "llm.error", status: "failed" });
		expect(
			workbenchLlmActivityProjection({
				type: "model.response_finished",
				severity: "info",
				message: "finished",
			}),
		).toEqual({ kind: "llm.response_final", status: "completed" });
	});

	it("keeps native request failures terminal in the projected activity", () => {
		expect(
			runEventToActivityStatus({ eventType: "model.request_started" }),
		).toBe("started");
		expect(
			runEventToActivityStatus({ eventType: "model.request_failed" }),
		).toBe("failed");
		expect(
			runEventToActivityTurnId({
				runId: "run-1",
				eventType: "model.request_failed",
			}),
		).toBe("llm:run-1");
	});
});
