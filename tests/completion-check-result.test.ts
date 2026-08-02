import { describe, expect, it } from "vitest";
import { readCompletionCheckResult } from "../api/services/run-events/completion-check-result";

describe("completion_check Run event projection", () => {
	it("does not treat a successful tool call as domain readiness", () => {
		const result = readCompletionCheckResult(
			completionEvent({ toolOk: true, ready: false }),
		);

		expect(result).toEqual({
			eventId: "completion-event",
			ok: false,
			verificationDocumentIds: ["verification-document"],
		});
	});

	it("accepts completion only when the nested readiness is true", () => {
		const result = readCompletionCheckResult(
			completionEvent({ toolOk: true, ready: true }),
		);

		expect(result).toMatchObject({ ok: true });
	});
});

function completionEvent(input: { toolOk: boolean; ready: boolean }) {
	const projected = {
		ok: input.toolOk,
		payload: {
			result: {
				ready: input.ready,
				verificationDocumentId: "verification-document",
			},
		},
	};
	return {
		id: "completion-event",
		payloadJson: {
			runEvent: {
				type: "tool.call_finished",
				data: {
					mcpTool: "completion_check",
					status: "completed",
					result: {
						structuredContent: {
							payload: projected.payload,
						},
						content: [{ type: "text", text: JSON.stringify(projected) }],
					},
				},
			},
		},
	};
}
