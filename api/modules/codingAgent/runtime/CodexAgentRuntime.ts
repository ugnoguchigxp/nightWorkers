import { recordLlmUsage } from "../../../services/llm-usage";
import { runFinalizeController } from "../../../services/run-control/finalize-controller";
import { RuntimeSessionStateStore } from "../../../services/runtime-session-state";
import { loadCodingAgentContextPacket } from "../context";
import { auditCodexMappedEvent } from "./codex-runtime-audit";
import { createThread, finishRun, toCancelled } from "./codex-runtime-closeout";
import {
	persistCodexProviderThreadIfPresent,
	readCodexRuntimeExecutionMode,
	readPromptPartObservabilityEnabled,
	updateCodexSessionKey,
} from "./codex-runtime-support";
import type { CodexThreadFactory } from "./codex-sdk/codex-sdk-client";
import {
	createCodexEventMapperState,
	mapCodexThreadEvent,
} from "./codex-sdk/codex-sdk-event-adapter";
import {
	type CodexRuntimeAuditState,
	createCodexRuntimeAuditState,
} from "./codex-sdk/codex-sdk-mcp-audit";
import {
	buildCodexRuntimePromptParts,
	buildCodexRuntimeTurnInput,
} from "./codex-sdk/codex-sdk-runtime-prompt";
import {
	type RuntimeUsageRecorder,
	recordCodexRuntimeUsageIfPresent,
} from "./codex-sdk/codex-sdk-usage";
import type {
	AgentRunContext,
	AgentRuntime,
	AgentRuntimeEvent,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "./types";

export type { CodexThreadFactory } from "./codex-sdk/codex-sdk-client";
export {
	buildCodexRuntimePrompt,
	buildCodexRuntimePromptParts,
} from "./codex-sdk/codex-sdk-runtime-prompt";

const MAX_MODEL_TURNS = 64;

export class CodexAgentRuntime implements AgentRuntime {
	readonly kind = "codex-agent" as const;
	private readonly cancelledRunIds = new Set<string>();
	private readonly activeRunControllers = new Map<string, AbortController>();
	private readonly threadFactory?: CodexThreadFactory;
	private readonly runtimeSessionStore: RuntimeSessionStateStore;
	private readonly persistRuntimeSessionState: boolean;
	private readonly collectWorkspaceDiff: boolean;
	private readonly persistRuntimeUsage: boolean;
	private readonly usageRecorder: RuntimeUsageRecorder;
	readonly maxModelTurns: number;

	constructor(
		input: {
			threadFactory?: CodexThreadFactory;
			runtimeSessionStore?: RuntimeSessionStateStore;
			persistRuntimeSessionState?: boolean;
			collectWorkspaceDiff?: boolean;
			persistRuntimeUsage?: boolean;
			usageRecorder?: RuntimeUsageRecorder;
			maxModelTurns?: number;
		} = {},
	) {
		this.threadFactory = input.threadFactory;
		this.runtimeSessionStore =
			input.runtimeSessionStore ?? new RuntimeSessionStateStore();
		this.persistRuntimeSessionState =
			input.persistRuntimeSessionState ?? !input.threadFactory;
		this.collectWorkspaceDiff =
			input.collectWorkspaceDiff ?? !input.threadFactory;
		this.persistRuntimeUsage =
			input.persistRuntimeUsage ?? !input.threadFactory;
		this.usageRecorder = input.usageRecorder ?? recordLlmUsage;
		this.maxModelTurns =
			Number.isInteger(input.maxModelTurns) && (input.maxModelTurns ?? 0) > 0
				? Math.floor(input.maxModelTurns ?? MAX_MODEL_TURNS)
				: MAX_MODEL_TURNS;
	}

	async start(
		context: AgentRunContext,
		sink: AgentRuntimeSink,
		signal?: AbortSignal,
	): Promise<AgentRuntimeResult> {
		const controller = new AbortController();
		this.activeRunControllers.set(context.runId, controller);
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort(
				new Error(
					`CodexAgentRuntime timed out after ${context.timeoutSeconds}s`,
				),
			);
		}, Math.max(1, context.timeoutSeconds) * 1000);
		const logs: string[] = [];
		const auditState = createCodexRuntimeAuditState({
			executionMode: readCodexRuntimeExecutionMode(context),
		});
		let lastFinalCandidate = "";

		try {
			if (this.isCancelled(context, signal))
				return toCancelled(logs.join("\n"));
			try {
				const thread = await createThread(this.closeoutHost(), context, sink);
				const promptParts = buildCodexRuntimePromptParts(context);
				let nextPrompt = promptParts.prompt;
				let imageInputSent = false;
				let providerSessionKey: string | null = null;

				for (
					let turnIndex = 1;
					turnIndex <= this.maxModelTurns;
					turnIndex += 1
				) {
					if (timedOut) {
						return this.finish(context, sink, logs, auditState, {
							terminalState: "needs_human",
							finalReport: lastFinalCandidate,
							stoppedBy: "budget",
							riskLevel: "high",
						});
					}
					if (this.isCancelled(context, signal)) {
						controller.abort();
						return toCancelled(logs.join("\n"));
					}
					const turnStartedAt = Date.now();
					const turnInput = buildCodexRuntimeTurnInput(
						context,
						nextPrompt,
						imageInputSent,
					);
					imageInputSent ||= typeof turnInput !== "string";
					const { events } = await thread.runStreamed(turnInput, {
						signal: controller.signal,
					});
					const mapperState = createCodexEventMapperState({
						repoRoot: context.repoRoot,
					});
					const todoContractViolations = new Set<string>();
					let turnFinalText = "";
					let runtimeFailed = false;

					for await (const event of events) {
						for (const mapped of mapCodexThreadEvent(event, mapperState)) {
							for (const audited of await auditCodexMappedEvent(
								context,
								auditState,
								mapped,
							)) {
								const violation = readModelVisibleTodoViolation(audited);
								if (violation) todoContractViolations.add(violation);
								providerSessionKey = updateCodexSessionKey(
									providerSessionKey,
									audited,
								);
								logs.push(audited.message);
								await sink.emit(audited);
								if (this.persistRuntimeSessionState) {
									await persistCodexProviderThreadIfPresent(
										this.runtimeSessionStore,
										context,
										audited,
									);
								}
							}
							if (mapped.type === "model_response_finished") {
								const payload = mapped.payload as
									| { text?: unknown }
									| undefined;
								if (typeof payload?.text === "string") {
									turnFinalText = payload.text;
									lastFinalCandidate = payload.text;
								}
								await this.recordUsage({
									context,
									payload: mapped.payload,
									durationMs: Date.now() - turnStartedAt,
									promptParts,
									providerSessionKey,
									turnIndex,
								});
							}
							if (mapped.type === "runtime_error") runtimeFailed = true;
						}
					}
					if (timedOut) {
						return this.finish(context, sink, logs, auditState, {
							terminalState: "needs_human",
							finalReport: lastFinalCandidate,
							stoppedBy: "budget",
							riskLevel: "high",
						});
					}
					if (this.isCancelled(context, signal)) {
						return toCancelled(logs.join("\n"));
					}

					if (runtimeFailed) {
						return this.finish(context, sink, logs, auditState, {
							terminalState: "failed",
							finalReport: lastFinalCandidate,
							stoppedBy: "llm_error",
							riskLevel: "high",
						});
					}

					if (todoContractViolations.size > 0) {
						nextPrompt = buildModelVisibleTodoFeedback(todoContractViolations);
						continue;
					}

					if (!turnFinalText.trim()) {
						nextPrompt = JSON.stringify({
							ok: false,
							error: {
								code: "FINAL_RESPONSE_REQUIRED",
								message:
									"tool結果を読んで次の行動を選ぶか、最終回答本文を返してください。",
							},
						});
						continue;
					}

					const completionSnapshot = await loadCodingAgentContextPacket(
						context.runId,
					);
					const completion = await runFinalizeController.evaluateCandidate({
						runId: context.runId,
						expectedPlanRevision:
							completionSnapshot?.planSummary.planRevision ?? 0,
						expectedTodoRevisions: Object.fromEntries(
							(completionSnapshot?.planSummary.todos ?? []).map((todo) => [
								todo.id,
								todo.revision,
							]),
						),
					});
					if (completion.allowFinalize) {
						return this.finish(context, sink, logs, auditState, {
							terminalState: "completed",
							finalReport: turnFinalText,
							stoppedBy: "decision",
							riskLevel: "medium",
						});
					}
					if (completion.code === "RUN_NEEDS_HUMAN") {
						return this.finish(context, sink, logs, auditState, {
							terminalState: "needs_human",
							finalReport: turnFinalText,
							stoppedBy: "decision",
							riskLevel: "medium",
						});
					}
					nextPrompt = JSON.stringify({
						ok: false,
						error: {
							code: completion.code,
							message: completion.message,
						},
						currentSnapshot: completion.snapshot,
						finalCandidate: turnFinalText,
					});
				}

				return this.finish(context, sink, logs, auditState, {
					terminalState: "needs_human",
					finalReport: lastFinalCandidate,
					stoppedBy: "budget",
					riskLevel: "high",
				});
			} catch (error) {
				if (timedOut) {
					return this.finish(context, sink, logs, auditState, {
						terminalState: "needs_human",
						finalReport: lastFinalCandidate,
						stoppedBy: "budget",
						riskLevel: "high",
					});
				}
				if (this.isCancelled(context, signal)) {
					return toCancelled(logs.join("\n"));
				}
				await sink.emit({
					type: "runtime_error",
					message: `[System Error] ${error instanceof Error ? error.message : String(error)}`,
					payload: { rawError: error },
				});
				return this.finish(context, sink, logs, auditState, {
					terminalState: "failed",
					finalReport: lastFinalCandidate,
					stoppedBy: "llm_error",
					riskLevel: "high",
				});
			}
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			if (this.activeRunControllers.get(context.runId) === controller)
				this.activeRunControllers.delete(context.runId);
		}
	}

	private isCancelled(context: AgentRunContext, signal?: AbortSignal) {
		return signal?.aborted || this.cancelledRunIds.has(context.runId);
	}

	private async recordUsage(input: {
		context: AgentRunContext;
		payload: unknown;
		durationMs: number;
		promptParts: ReturnType<typeof buildCodexRuntimePromptParts>;
		providerSessionKey: string | null;
		turnIndex: number;
	}) {
		const enabled = readPromptPartObservabilityEnabled(input.context);
		await recordCodexRuntimeUsageIfPresent({
			context: input.context,
			payload: input.payload,
			persistRuntimeUsage: this.persistRuntimeUsage,
			usageRecorder: this.usageRecorder,
			durationMs: input.durationMs,
			promptPartObservabilityEnabled: enabled,
			promptPartTokenEstimates: enabled
				? {
						latestUserMessageTokens:
							input.context.contextSnapshot.conversationContext?.usage
								?.latestUserMessageTokens,
						stateCardTokens:
							input.context.contextSnapshot.conversationContext?.usage
								?.stateCardTokens,
						userPromptTokens: input.promptParts.estimates.requestTokens,
						systemPromptTokens:
							input.promptParts.estimates.runtimeContractTokens,
					}
				: undefined,
			providerSessionKey: input.providerSessionKey,
			sourceSequence: input.turnIndex,
		});
	}

	private finish(
		context: AgentRunContext,
		sink: AgentRuntimeSink,
		logs: string[],
		auditState: CodexRuntimeAuditState,
		input: {
			terminalState: AgentRuntimeResult["terminalState"];
			finalReport: string;
			stoppedBy: AgentRuntimeResult["stoppedBy"];
			riskLevel: AgentRuntimeResult["riskLevel"];
		},
	) {
		return finishRun(this.closeoutHost(), context, sink, logs, {
			...input,
			auditState,
		});
	}

	private closeoutHost() {
		return {
			threadFactory: this.threadFactory,
			runtimeSessionStore: this.runtimeSessionStore,
			collectWorkspaceDiff: this.collectWorkspaceDiff,
		};
	}

	async stop(runId: string): Promise<void> {
		this.cancelledRunIds.add(runId);
		this.activeRunControllers
			.get(runId)
			?.abort(new Error("CodexAgentRuntime stop requested."));
	}
}

const MODEL_VISIBLE_TODO_VIOLATIONS = new Set([
	"codex_file_change_without_current_todo",
	"codex_file_change_before_todo_replace",
]);

function readModelVisibleTodoViolation(event: AgentRuntimeEvent) {
	if (event.type !== "runtime_warning") return null;
	const code = event.payload?.code ?? null;
	return code && MODEL_VISIBLE_TODO_VIOLATIONS.has(code) ? code : null;
}

function buildModelVisibleTodoFeedback(violations: Set<string>) {
	const codes = [...violations];
	const primaryCode = codes.includes("codex_file_change_without_current_todo")
		? "CURRENT_TODO_REQUIRED"
		: "TODO_REPLAN_REQUIRED";
	return JSON.stringify({
		ok: false,
		error: {
			code: primaryCode,
			message:
				"Todo contract違反を検出しました。最新のTodo Contextを確認し、必要なTodo更新を行ってから次の行動を選んでください。",
		},
		violations: codes,
	});
}
