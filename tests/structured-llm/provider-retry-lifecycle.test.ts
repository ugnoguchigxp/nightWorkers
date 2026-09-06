import { afterEach, describe, expect, it, vi } from "vitest";
import { emitSupervisorLlmDebugEvent } from "../../api/services/structured-llm/events";
import { retryOpenAITransientUnavailableOnce } from "../../api/services/structured-llm/openai-provider-retry";

vi.mock("../../api/services/structured-llm/events", () => ({
	emitSupervisorLlmDebugEvent: vi.fn(async () => {}),
}));
afterEach(() => {
	vi.mocked(emitSupervisorLlmDebugEvent).mockReset();
});

function request(signal: AbortSignal, status = 503) {
	return {
		response: new Response("temporarily unavailable", { status }),
		input: {
			options: { taskId: "retry-test", role: "worker", round: 1 } as never,
			signal,
		},
		fetchCompletion: vi.fn(
			async () => new Response("still unavailable", { status: 503 }),
		),
		responseFormat: "json_schema" as const,
		stream: false,
	};
}

describe("provider retry cancellation", () => {
	it("does not retry a request that was already cancelled", async () => {
		const input = request(AbortSignal.abort(new Error("stopped")));
		await expect(retryOpenAITransientUnavailableOnce(input)).rejects.toThrow(
			"stopped",
		);
		expect(input.fetchCompletion).not.toHaveBeenCalled();
	});
	it("rechecks cancellation after recording retry events", async () => {
		const controller = new AbortController();
		vi.mocked(emitSupervisorLlmDebugEvent).mockImplementation(async () => {
			controller.abort(new Error("stopped during retry"));
		});
		const input = request(controller.signal);
		await expect(retryOpenAITransientUnavailableOnce(input)).rejects.toThrow(
			"stopped during retry",
		);
		expect(input.fetchCompletion).not.toHaveBeenCalled();
	});
	it("makes only one additional call even if it also fails temporarily", async () => {
		const input = request(new AbortController().signal);
		expect((await retryOpenAITransientUnavailableOnce(input)).status).toBe(503);
		expect(input.fetchCompletion).toHaveBeenCalledOnce();
	});
	it("preserves a non-retryable response body without retrying", async () => {
		const input = request(new AbortController().signal, 400);
		const response = await retryOpenAITransientUnavailableOnce(input);
		expect(response.status).toBe(400);
		expect(await response.text()).toBe("temporarily unavailable");
		expect(input.fetchCompletion).not.toHaveBeenCalled();
	});
});
