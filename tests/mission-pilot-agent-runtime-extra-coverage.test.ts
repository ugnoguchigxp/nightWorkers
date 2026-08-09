import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	class RetryScheduledError extends Error {
		constructor(
			readonly failure: unknown,
			readonly availableAt: Date,
		) {
			super("retry scheduled");
		}
	}
	return {
		RetryScheduledError,
		claimTurn: vi.fn(),
		renewLease: vi.fn(),
		finishTurn: vi.fn(),
		checkpoint: vi.fn(),
		loadMessages: vi.fn(),
		persistTurn: vi.fn(),
		claimTool: vi.fn(),
		completeTool: vi.fn(),
		reprojectTool: vi.fn(),
		compactConversation: vi.fn(),
		appendFailure: vi.fn(),
		cancelPending: vi.fn(),
		buildStepContext: vi.fn(),
		shouldCompact: vi.fn(),
		estimateTokens: vi.fn(),
		executeTool: vi.fn(),
		getActionDefinition: vi.fn(),
		defaultProvider: { nextTurn: vi.fn() },
		defaultUsage: vi.fn(),
	};
});

vi.mock("../packages/mission-pilot/src/systemContexts/catalog", () => ({
	createSystemContextBindingSnapshot: () => ({ catalogVersion: "test" }),
	runWithSystemContextBinding: (callback: () => unknown) => callback(),
	p: (_key: string, values: Record<string, unknown>) =>
		String(values.baseSystemContext ?? "system") +
		String(values.currentStepContext ?? "step"),
}));

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/prompts/mission-pilot-system-context",
	() => ({ applyCurrentMissionPilotSystemContext: (value: string) => value }),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-agent-lifecycle.repository",
	() => ({ cancelPendingMissionPilotToolCalls: mocks.cancelPending }),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-content-page",
	() => ({ missionPilotDigest: (value: string) => `digest:${value.length}` }),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-agent-runtime-failures",
	() => ({
		readMissionPilotRuntimeSystemContext: () => "runtime system",
		missionPilotProviderFailure: (error: unknown) => ({
			kind: "provider",
			message: error instanceof Error ? error.message : String(error),
		}),
		missionPilotResourceFailure: (limit: string) => ({
			kind: "resource_limit",
			message: limit,
		}),
	}),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-context-compaction",
	() => ({
		buildMissionPilotCompactionRequest: (messages: unknown[]) => messages,
		getMissionPilotCompactionSystemContext: () => "compact-system",
		shouldCompactMissionPilotContext: mocks.shouldCompact,
	}),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-context-envelope",
	() => ({
		estimateMissionPilotProviderRequestTokens: mocks.estimateTokens,
		projectMissionPilotProviderMessages: (messages: unknown[]) => messages,
	}),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-conversation.repository",
	() => ({
		appendMissionPilotRuntimeFailure: mocks.appendFailure,
		claimMissionPilotAgentTurn: mocks.claimTurn,
		claimMissionPilotToolCall: mocks.claimTool,
		compactMissionPilotConversation: mocks.compactConversation,
		completeMissionPilotToolCall: mocks.completeTool,
		finishMissionPilotAgentTurn: mocks.finishTurn,
		getMissionPilotConversationCheckpoint: mocks.checkpoint,
		loadMissionPilotProviderMessages: mocks.loadMessages,
		persistMissionPilotProviderTurn: mocks.persistTurn,
		reconcileInterruptedMissionPilotAgentSessions: vi.fn(),
		renewMissionPilotAgentTurnLease: mocks.renewLease,
		reprojectMissionPilotTerminalToolCall: mocks.reprojectTool,
	}),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-current-step-context",
	() => ({ buildMissionPilotCurrentStepContext: mocks.buildStepContext }),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-provider.port",
	() => ({
		MissionPilotProviderRetryScheduledError: mocks.RetryScheduledError,
		missionPilotProviderPort: mocks.defaultProvider,
	}),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-provider-usage",
	() => ({ recordMissionPilotProviderTurnUsage: mocks.defaultUsage }),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-task-action.adapter",
	() => ({ missionPilotTaskActionPort: { execute: vi.fn() } }),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-task-action.registry",
	() => ({ getMissionPilotActionDefinition: mocks.getActionDefinition }),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-task-read.adapter",
	() => ({ missionPilotTaskReadPort: {} }),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-tools",
	() => ({
		executeMissionPilotToolCall: mocks.executeTool,
		missionPilotToolDefinitions: () => [{ name: "tool" }],
	}),
);

import {
	isMissionPilotAgentRuntimeActive,
	runMissionPilotAgentWake,
	stopMissionPilotAgentRuntime,
} from "../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-agent-runtime";

const claimedTurn = {
	turnId: "turn-1",
	providerRetryAttempt: 3,
	session: { taskId: "task-1" },
	triggerEvents: [] as Array<{ eventType: string }>,
};

const supported = (overrides: Record<string, unknown> = {}) => ({
	type: "supported" as const,
	content: "assistant content",
	toolCalls: [],
	usage: {
		inputTokens: 1,
		outputTokens: 1,
		cachedInputTokens: 0,
		reasoningOutputTokens: 0,
		totalTokens: 2,
		mode: "provider_reported" as const,
	},
	...overrides,
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.claimTurn.mockResolvedValue({ ...claimedTurn, triggerEvents: [] });
	mocks.renewLease.mockResolvedValue(true);
	mocks.checkpoint.mockResolvedValue({
		revision: 4,
		sourceThroughSequence: 9,
	});
	mocks.loadMessages.mockResolvedValue([
		{ role: "system", content: "base system" },
		{ role: "user", content: "work" },
	]);
	mocks.buildStepContext.mockResolvedValue("current step");
	mocks.shouldCompact.mockReturnValue(false);
	mocks.estimateTokens.mockReturnValue(1);
	mocks.persistTurn.mockResolvedValue([]);
	mocks.finishTurn.mockResolvedValue(true);
	mocks.appendFailure.mockResolvedValue(true);
	mocks.cancelPending.mockResolvedValue(0);
	mocks.completeTool.mockResolvedValue(true);
	mocks.compactConversation.mockResolvedValue(true);
	mocks.defaultUsage.mockResolvedValue(true);
	mocks.getActionDefinition.mockReturnValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("mission-pilot agent runtime extra coverage", () => {
	it("returns not_claimed and handles a lost lease or missing checkpoint", async () => {
		mocks.claimTurn.mockResolvedValueOnce(null);
		await expect(
			runMissionPilotAgentWake({ sessionId: "none" }),
		).resolves.toEqual({ kind: "not_claimed" });

		mocks.renewLease.mockResolvedValueOnce(false);
		await expect(
			runMissionPilotAgentWake({ sessionId: "lost" }),
		).resolves.toEqual({ kind: "stopped" });

		mocks.checkpoint.mockResolvedValueOnce(null);
		await expect(
			runMissionPilotAgentWake({ sessionId: "missing-checkpoint" }),
		).resolves.toEqual({ kind: "stopped" });
	});

	it("enforces provider and tool call limits, including failure cleanup errors", async () => {
		mocks.appendFailure.mockRejectedValueOnce(new Error("append unavailable"));
		mocks.cancelPending.mockRejectedValueOnce(new Error("cancel unavailable"));
		const providerLimited = await runMissionPilotAgentWake(
			{ sessionId: "provider-limit" },
			{ maxProviderCallsPerWake: 0 },
		);
		expect(providerLimited).toMatchObject({
			kind: "attention",
			failure: { kind: "resource_limit" },
		});

		const toolLimited = await runMissionPilotAgentWake(
			{ sessionId: "tool-limit" },
			{ maxProviderCallsPerWake: 2, maxToolCallsPerWake: 0 },
		);
		expect(toolLimited).toMatchObject({ kind: "attention" });
	});

	it("handles unsupported and empty compaction results", async () => {
		mocks.shouldCompact.mockReturnValue(true);
		const unsupportedProvider = {
			nextTurn: vi.fn().mockResolvedValue({
				type: "unsupported",
				reason: "no compaction",
			}),
		};
		await expect(
			runMissionPilotAgentWake(
				{ sessionId: "compact-unsupported" },
				{ provider: unsupportedProvider },
			),
		).resolves.toMatchObject({ kind: "attention" });

		const emptyProvider = {
			nextTurn: vi.fn().mockResolvedValue(supported({ content: "  " })),
		};
		await expect(
			runMissionPilotAgentWake(
				{ sessionId: "compact-empty" },
				{
					provider: emptyProvider,
					recordProviderUsage: vi.fn().mockRejectedValue(1),
				},
			),
		).resolves.toMatchObject({ kind: "attention" });
	});

	it("compacts successfully and then reaches the provider limit", async () => {
		mocks.shouldCompact.mockReturnValueOnce(true).mockReturnValue(true);
		const provider = { nextTurn: vi.fn().mockResolvedValue(supported()) };
		const result = await runMissionPilotAgentWake(
			{
				sessionId: "compact-limit",
				providerEndpointId: "endpoint",
				model: "model",
				thinkingDepth: "high",
			},
			{ provider, maxProviderCallsPerWake: 1 },
		);
		expect(result).toMatchObject({ kind: "attention" });
		expect(mocks.compactConversation).toHaveBeenCalledWith(
			expect.objectContaining({ summary: "assistant content" }),
		);
	});

	it("rejects an oversized context and an unsupported regular provider", async () => {
		mocks.estimateTokens.mockReturnValueOnce(100);
		await expect(
			runMissionPilotAgentWake(
				{ sessionId: "hard-budget" },
				{ contextHardTokenBudget: 2 },
			),
		).resolves.toMatchObject({ kind: "attention" });

		const provider = {
			nextTurn: vi.fn().mockResolvedValue({
				type: "unsupported",
				reason: "not configured",
			}),
		};
		await expect(
			runMissionPilotAgentWake(
				{ sessionId: "unsupported-provider" },
				{ provider },
			),
		).resolves.toMatchObject({ kind: "attention" });
	});

	it("covers default provider fields, usage failure, and persistence stop", async () => {
		mocks.defaultProvider.nextTurn.mockResolvedValueOnce(
			supported({
				providerDebug: { provider: "fixture" },
				model: "response-model",
			}),
		);
		mocks.defaultUsage.mockRejectedValueOnce(new Error("usage unavailable"));
		mocks.persistTurn.mockResolvedValueOnce(null);
		const result = await runMissionPilotAgentWake({
			sessionId: "persist-null",
		});
		expect(result).toEqual({ kind: "stopped" });
		expect(mocks.defaultProvider.nextTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				providerEndpointId: null,
				model: null,
				thinkingDepth: null,
			}),
		);
	});

	it("reprojects terminal calls, skips unknown calls, and completes a tool", async () => {
		const calls = [
			{ id: "missing", providerCallId: "not-returned", status: "pending" },
			{ id: "terminal", providerCallId: "terminal-provider", status: "failed" },
			{ id: "running", providerCallId: "running-provider", status: "running" },
		];
		const providerCalls = [
			{ id: "terminal-provider", name: "tool", arguments: {} },
			{ id: "running-provider", name: "tool", arguments: {} },
		];
		mocks.defaultProvider.nextTurn.mockResolvedValueOnce(
			supported({ toolCalls: providerCalls }),
		);
		mocks.persistTurn.mockResolvedValueOnce(calls);
		mocks.claimTool.mockResolvedValueOnce(null).mockResolvedValueOnce({
			id: "running",
			turnId: "turn-1",
			idempotencyKey: "key",
		});
		mocks.executeTool.mockResolvedValueOnce({
			ok: true,
			data: { done: true },
			directive: "finish",
		});
		const result = await runMissionPilotAgentWake({ sessionId: "tool-finish" });
		expect(result).toEqual({ kind: "completed", data: { done: true } });
		expect(mocks.reprojectTool).toHaveBeenCalledOnce();
	});

	it("waits for a fresh wait directive and continues after special failures", async () => {
		const provider = {
			nextTurn: vi.fn().mockResolvedValueOnce(
				supported({
					toolCalls: [
						{ id: "permission", name: "tool", arguments: {} },
						{ id: "wait", name: "tool", arguments: {} },
					],
				}),
			),
		};
		mocks.persistTurn.mockResolvedValueOnce([
			{
				id: "permission-row",
				providerCallId: "permission",
				status: "pending",
				actionId: "action",
			},
			{
				id: "wait-row",
				providerCallId: "wait",
				status: "pending",
				actionId: "action",
			},
		]);
		mocks.claimTool
			.mockResolvedValueOnce({
				id: "permission-row",
				turnId: "turn-1",
				idempotencyKey: "one",
			})
			.mockResolvedValueOnce({
				id: "wait-row",
				turnId: "turn-1",
				idempotencyKey: "two",
			});
		mocks.executeTool
			.mockResolvedValueOnce({
				ok: false,
				directive: "continue",
				failure: { kind: "permission" },
			})
			.mockResolvedValueOnce({
				ok: true,
				data: {},
				directive: "wait",
				waitFor: ["task_run.terminal"],
				replayed: false,
			});
		const result = await runMissionPilotAgentWake(
			{ sessionId: "tool-wait" },
			{ provider },
		);
		expect(result).toEqual({ kind: "waiting" });
	});

	it("uses action metadata waiting and ignores an already satisfied wait", async () => {
		mocks.claimTurn.mockResolvedValueOnce({
			...claimedTurn,
			triggerEvents: [{ eventType: "task_run.terminal" }],
		});
		const provider = {
			nextTurn: vi.fn().mockResolvedValueOnce(
				supported({
					toolCalls: [
						{ id: "satisfied", name: "tool", arguments: {} },
						{ id: "metadata", name: "tool", arguments: {} },
					],
				}),
			),
		};
		mocks.persistTurn.mockResolvedValueOnce([
			{
				id: "satisfied-row",
				providerCallId: "satisfied",
				status: "pending",
				actionId: "continue-action",
			},
			{
				id: "metadata-row",
				providerCallId: "metadata",
				status: "pending",
				actionId: "metadata-action",
			},
		]);
		mocks.claimTool
			.mockResolvedValueOnce({
				id: "satisfied-row",
				turnId: "turn-1",
				idempotencyKey: "one",
			})
			.mockResolvedValueOnce({
				id: "metadata-row",
				turnId: "turn-1",
				idempotencyKey: "two",
			});
		mocks.executeTool
			.mockResolvedValueOnce({
				ok: true,
				data: {},
				directive: "wait",
				waitFor: ["task_run.terminal"],
				replayed: false,
			})
			.mockResolvedValueOnce({
				ok: true,
				data: {},
				directive: "continue",
				replayed: false,
			});
		mocks.getActionDefinition.mockImplementation((id: string) =>
			id === "metadata-action"
				? { execution: { completion: "wait_for_event" } }
				: undefined,
		);
		await expect(
			runMissionPilotAgentWake({ sessionId: "metadata-wait" }, { provider }),
		).resolves.toEqual({ kind: "waiting" });
	});

	it("handles retry scheduling, provider errors, and claim errors", async () => {
		const retryAt = new Date("2030-01-01T00:00:00.000Z");
		const retryProvider = {
			nextTurn: vi
				.fn()
				.mockRejectedValue(
					new mocks.RetryScheduledError({ kind: "rate_limit" }, retryAt),
				),
		};
		await expect(
			runMissionPilotAgentWake(
				{ sessionId: "retry-scheduled" },
				{ provider: retryProvider },
			),
		).resolves.toEqual({ kind: "waiting", retryScheduledAt: retryAt });

		const errorProvider = {
			nextTurn: vi.fn().mockRejectedValue("provider exploded"),
		};
		await expect(
			runMissionPilotAgentWake(
				{ sessionId: "provider-error" },
				{ provider: errorProvider },
			),
		).resolves.toMatchObject({ kind: "attention" });

		mocks.claimTurn.mockRejectedValueOnce(new Error("claim unavailable"));
		await expect(
			runMissionPilotAgentWake({ sessionId: "claim-error" }),
		).resolves.toMatchObject({ kind: "attention" });
	});

	it("reports active, already running, stop timeout, and eventual quiescence", async () => {
		let release!: () => void;
		const provider = {
			nextTurn: vi.fn(
				() =>
					new Promise<ReturnType<typeof supported>>((resolve) => {
						release = () => resolve(supported());
					}),
			),
		};
		const running = runMissionPilotAgentWake(
			{ sessionId: "active-runtime" },
			{ provider },
		);
		await vi.waitFor(() => expect(provider.nextTurn).toHaveBeenCalled());
		expect(isMissionPilotAgentRuntimeActive("active-runtime")).toBe(true);
		await expect(
			runMissionPilotAgentWake({ sessionId: "active-runtime" }, { provider }),
		).resolves.toEqual({ kind: "already_running" });
		await expect(stopMissionPilotAgentRuntime("absent")).resolves.toEqual({
			requested: false,
			quiesced: true,
		});
		await expect(
			stopMissionPilotAgentRuntime("active-runtime", 1),
		).resolves.toEqual({ requested: true, quiesced: false });
		release();
		await expect(running).resolves.toEqual({ kind: "stopped" });
		expect(isMissionPilotAgentRuntimeActive("active-runtime")).toBe(false);
	});
});
