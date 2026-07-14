import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { repairStructuredOutputOnce } from "../api/services/structured-generation/structured-output-repair.service";
import { createStructuredOutputContract } from "../api/services/structured-llm";

describe("structured output repair workflow", () => {
	it("records successful initial validation as attempt history", async () => {
		const result = await repairStructuredOutputOnce({
			initialResult: {
				ok: true,
				value: { value: "accepted" },
				attempt: {
					attempt: 1,
					rawText: '{"value":"accepted"}',
					extractedText: '{"value":"accepted"}',
					repairedText: null,
					repairKind: null,
				},
				issues: [],
			},
			options: {
				contract: createStructuredOutputContract({
					name: "test_contract",
					runtimeSchema: z.object({ value: z.string() }),
				}),
				taskId: "test-task",
				role: "plan",
			},
		});

		expect(result.validationByAttempt).toEqual([{ attempt: 1, issues: [] }]);
	});

	it("checks workflow state before sending a repair request", async () => {
		const beforeRepair = vi.fn(() => {
			throw new Error("workflow stopped");
		});
		const rawText = '{"value":';

		await expect(
			repairStructuredOutputOnce({
				initialResult: {
					ok: false,
					value: null,
					attempt: {
						attempt: 1,
						rawText,
						extractedText: null,
						repairedText: null,
						repairKind: null,
					},
					issues: [
						{
							stage: "parse",
							path: [],
							code: "invalid_json",
							message: "invalid JSON",
						},
					],
				},
				options: {
					contract: createStructuredOutputContract({
						name: "test_contract",
						runtimeSchema: z.object({ value: z.string() }),
					}),
					taskId: "test-task",
					role: "plan",
				},
				beforeRepair,
			}),
		).rejects.toThrow("workflow stopped");

		expect(beforeRepair).toHaveBeenCalledWith(
			expect.objectContaining({
				ok: false,
				attempt: expect.objectContaining({ rawText }),
			}),
		);
	});
});
