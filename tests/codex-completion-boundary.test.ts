import { describe, expect, it, vi } from "vitest";
import { reconcileCodexCompletionBoundary } from "../api/modules/codingAgent/application/codex-completion-boundary.service";

const completedResult = {
	terminalState: "completed" as const,
	summary: "done",
	finalReport: "実装完了",
	stoppedBy: "decision" as const,
	riskLevel: "medium" as const,
};

function input() {
	return {
		result: completedResult,
		taskId: "task-1",
		runId: "run-1",
		repositoryRoot: "/repo",
		sink: { emit: vi.fn(async () => {}) },
	};
}

describe("Codex completion boundary", () => {
	it("requires review when Evidence Readiness is not ready", async () => {
		const result = await reconcileCodexCompletionBoundary(input(), {
			executeVerificationCloseout: async () => ({
				applicability: "active",
				verificationDocumentId: "verification-1",
				completionCheck: completionCheck(false),
				commands: [],
				mapping: completionCheck(false).mapping,
				verify: completionCheck(false).verify,
				sourceStateHash: "source",
			}),
		});

		expect(result.terminalState).toBe("needs_review");
		expect(result.testResults).toMatchObject({
			completionReady: false,
		});
	});

	it("keeps completion when verification is not configured", async () => {
		const result = await reconcileCodexCompletionBoundary(input(), {
			executeVerificationCloseout: async () => ({
				applicability: "not_configured",
				commands: [],
			}),
		});

		expect(result.terminalState).toBe("completed");
		expect(result.testResults).toMatchObject({
			completionReady: true,
		});
	});

	it("keeps completion when Evidence Check is settled even if mapping is missing", async () => {
		const result = await reconcileCodexCompletionBoundary(input(), {
			executeVerificationCloseout: async () => ({
				applicability: "active",
				verificationDocumentId: "verification-1",
				completionCheck: completionCheck(true),
				commands: [],
				mapping: completionCheck(true).mapping,
				verify: completionCheck(true).verify,
				sourceStateHash: "source",
			}),
		});

		expect(result.terminalState).toBe("completed");
		expect(result.testResults).toMatchObject({
			completionReady: true,
		});
	});
});

function completionCheck(ok: boolean) {
	return {
		ok,
		verificationDocumentId: "verification-1",
		runId: "run-1",
		sourceStateHash: "source",
		mapping: {
			status: "missing" as const,
			definitionDigest: "definition",
			total: 1,
			matched: 0,
			items: [],
		},
		verify: {
			status: ok ? ("passed" as const) : ("not_run" as const),
			command: ok ? "bun run verify" : null,
			cwd: "/repo",
			exitCode: ok ? 0 : null,
			sourceStateHash: ok ? "source" : null,
			finishedAt: ok ? "2026-08-01T00:00:00.000Z" : null,
			logRefs: [],
		},
		confirmation: {
			status: ok ? ("settled" as const) : ("awaiting_initial_verify" as const),
			initialEvidenceRunId: ok ? "evidence-run-1" : null,
			confirmedAt: ok ? "2026-08-01T00:00:00.000Z" : null,
		},
		suggestedAction: ok
			? ("write_final_report" as const)
			: ("run_verify" as const),
		readinessDigest: ok ? "ready" : "missing",
		...(ok ? {} : { reason: "project_verify_not_run" }),
	};
}
