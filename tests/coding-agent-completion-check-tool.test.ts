import { describe, expect, it } from "vitest";
import { AppError } from "../api/lib/errors";
import { completionCheckTool } from "../api/services/worker-tools/run-check";

const input = {
	taskId: "00000000-0000-4000-8000-000000000001",
	runId: "00000000-0000-4000-8000-000000000002",
	verificationDocumentId: "00000000-0000-4000-8000-000000000003",
	repoRoot: "/workspace",
};

describe("completion_check worker boundary", () => {
	it("fails closed when an untyped evaluation error escapes", async () => {
		const result = await completionCheckTool(input, {
			runCompletionCheck: async () => {
				throw new Error("database temporarily unavailable");
			},
		});

		expect(result).toMatchObject({
			ok: false,
			toolName: "completion_check",
			payload: null,
			error: {
				code: "COMPLETION_CHECK_EXECUTION_FAILED",
				message: "database temporarily unavailable",
				retryable: false,
			},
		});
		expect(result.error).not.toHaveProperty("recoveryAction");
	});

	it("allows retry only for an explicitly retryable typed failure", async () => {
		const result = await completionCheckTool(input, {
			runCompletionCheck: async () => {
				throw new AppError(
					503,
					"completion_check_temporarily_unavailable",
					"The readiness store is temporarily unavailable.",
					{ retryable: true },
				);
			},
		});

		expect(result).toMatchObject({
			ok: false,
			payload: null,
			error: {
				code: "completion_check_temporarily_unavailable",
				retryable: true,
				recoveryAction: "同じcompletion_checkを再実行してください。",
			},
		});
	});

	it("preserves non-retryable application conflicts", async () => {
		const result = await completionCheckTool(input, {
			runCompletionCheck: async () => {
				throw new AppError(
					409,
					"evidence_confirmation_conflict",
					"Receipt conflicts with the stored evidence.",
				);
			},
		});

		expect(result).toMatchObject({
			ok: false,
			payload: null,
			error: {
				code: "evidence_confirmation_conflict",
				message: "Receipt conflicts with the stored evidence.",
				retryable: false,
			},
		});
		expect(result.error).not.toHaveProperty("recoveryAction");
	});
});
