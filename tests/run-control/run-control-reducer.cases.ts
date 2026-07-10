import { describe, expect, it } from "vitest";
import {
	isFailedToolPayload,
	isTransportFailedToolPayload,
} from "../../api/services/agent-runtime/codex-runtime-support";
import { buildRunActionIdentity } from "../../api/services/run-control/action-identity";
import { createInitialRunControlState } from "../../api/services/run-control/contracts";
import { reduceRunControlState } from "../../api/services/run-control/run-control-reducer";
import {
	classifyRunEffect,
	deriveWorkerDomainOutcome,
} from "../../api/services/run-control/tool-outcome-envelope";

describe("run control reducer", () => {
	it("normalizes action identity without persisting secret values", () => {
		const first = buildRunActionIdentity({
			toolName: "run_check",
			workspaceIdentity: "/repo",
			arguments: {
				command: "bun test",
				apiKey: "first-secret",
				nested: { b: 2, a: 1 },
			},
		});
		const second = buildRunActionIdentity({
			toolName: "run_check",
			workspaceIdentity: "/repo",
			arguments: {
				nested: { a: 1, b: 2 },
				apiKey: "second-secret",
				command: "bun test",
			},
		});

		expect(first.actionKey).toBe(second.actionKey);
		expect(first.normalizedArguments).toMatchObject({ apiKey: "[redacted]" });
	});

	it("keeps observations revision-stable and enters recovery after no progress", () => {
		const initial = createInitialRunControlState("run-1");
		const observed = reduceRunControlState(initial, {
			type: "action_completed",
			sequence: 1,
			effect: "observation",
			domainOutcome: "succeeded",
			evidenceCount: 0,
			artifactCount: 0,
		});
		const recovered = reduceRunControlState(observed, {
			type: "no_progress_turn",
		});
		const recoveredAgain = reduceRunControlState(recovered, {
			type: "no_progress_turn",
		});

		expect(observed.progressRevision).toBe(0);
		expect(observed.consecutiveNoProgressTurns).toBe(0);
		expect(recovered.phase).toBe("active");
		expect(recoveredAgain.phase).toBe("recovery");
	});

	it("records failing verification as evidence without changing workspace revision", () => {
		const state = reduceRunControlState(createInitialRunControlState("run-1"), {
			type: "action_completed",
			sequence: 2,
			effect: "verification",
			domainOutcome: "failed",
			evidenceCount: 1,
			artifactCount: 0,
		});

		expect(state.progressRevision).toBe(1);
		expect(state.evidenceRevision).toBe(1);
		expect(state.workspaceRevision).toBe(0);
		expect(state.lastEvidenceSequence).toBe(2);
	});

	it("does not allow terminal state to be reopened", () => {
		const terminal = reduceRunControlState(
			createInitialRunControlState("run-1"),
			{ type: "terminalize", reason: "completed" },
		);
		const afterMutation = reduceRunControlState(terminal, {
			type: "progress_observed",
			effect: "workspace_mutation",
		});

		expect(afterMutation).toBe(terminal);
	});

	it("classifies first-party effects and domain failures separately", () => {
		expect(
			classifyRunEffect("nightworkers.todo_list", { operation: "list" }),
		).toBe("observation");
		expect(
			classifyRunEffect("nightworkers.todo_list", { operation: "done" }),
		).toBe("workflow_mutation");
		expect(classifyRunEffect("run_check", {})).toBe("verification");
		expect(
			deriveWorkerDomainOutcome({
				ok: false,
				toolName: "run_check",
				startedAt: "",
				finishedAt: "",
				payload: { exitCode: 1 },
				error: { code: "CHECK_FAILED", message: "tests failed" },
			}),
		).toBe("failed");
		const domainFailurePayload = {
			status: "completed",
			result: {
				structuredContent: {
					outcome: {
						transportStatus: "completed",
						domainOutcome: "failed",
					},
					error: { code: "CHECK_FAILED", message: "tests failed" },
				},
			},
		};
		expect(isFailedToolPayload(domainFailurePayload)).toBe(true);
		expect(isTransportFailedToolPayload(domainFailurePayload)).toBe(false);
	});
});
