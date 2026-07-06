import * as repo from "../../../modules/nightworkers/nightworkers.repository";
import { recordLlmUsage } from "../../llm-usage";
import { callProviderToolTurn } from "../../structured-llm/providers";
import type {
	AgentRunContext,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "../types";
import {
	NativeApiCloseoutController,
	type NativeApiCloseoutControllerLike,
} from "./native-api-closeout-controller";
import {
	estimateNativeApiContextBudget,
	renderNativeApiContextBudgetHint,
} from "./native-api-context-budget";
import {
	compactNativeApiHistoryToBaseline,
	type NativeApiBaselineCompactionResult,
} from "./native-api-context-compaction";
import { readNativeApiExecutionMode } from "./native-api-mode";
import { runNativeApiProviderAttempts } from "./native-api-provider-attempts";
import { buildNativeApiProviderRequests } from "./native-api-request-adapter";
import {
	contextBudgetFailureResult,
	emitNativeApiContextBudgetEvent,
	MAX_RUNTIME_BASELINE_COMPACTIONS,
} from "./native-api-runner-context-events";
import {
	buildPostImportHistoryItem,
	buildTodoSnapshotHistory,
} from "./native-api-runner-history-cards";
import {
	buildNativeApiRoutePolicy,
	canCompleteNativeApiWithTextOnly,
	firstLine,
	readNativeApiCompletedTurnModel,
	readNativeApiResumeRouteCompatibility,
	readRuntimeLlmRouteOverride,
	shouldForceNativeApiStartupGates,
	validateNativeApiRouteSnapshot,
} from "./native-api-runner-routing";
import { createNativeApiTimeoutSignal } from "./native-api-runner-timeout";
import {
	type NativeApiUsageRecorder,
	recordNativeApiTurnUsage,
} from "./native-api-runner-usage";
import { NativeApiSessionStore } from "./native-api-session-store";
import {
	NativeApiStartupController,
	type NativeApiStartupControllerLike,
} from "./native-api-startup-controller";
import {
	dispatchNativeApiToolCall,
	type NativeApiDispatchState,
} from "./native-api-tool-dispatcher";
import {
	buildInitialNativeApiHistory,
	type NativeApiHistoryItem,
	sanitizeNativeApiResumeHistory,
} from "./native-api-tool-history";
import { getNativeApiToolDefinitions } from "./native-api-tool-registry";
import { capNativeApiToolResultContent } from "./native-api-tool-result-projector";

export type NativeApiToolTurnProvider = typeof callProviderToolTurn;

export class NativeApiRunner {
	private readonly cancelledRunIds = new Set<string>();
	private readonly activeRunControllers = new Map<string, AbortController>();
	private readonly store: NativeApiSessionStore;
	private readonly startupController: NativeApiStartupControllerLike;
	private readonly closeoutController: NativeApiCloseoutControllerLike;
	private readonly providerTurn: NativeApiToolTurnProvider;
	private readonly usageRecorder: NativeApiUsageRecorder;

	constructor(
		input: {
			store?: NativeApiSessionStore;
			startupController?: NativeApiStartupControllerLike;
			closeoutController?: NativeApiCloseoutControllerLike;
			providerTurn?: NativeApiToolTurnProvider;
			usageRecorder?: NativeApiUsageRecorder;
		} = {},
	) {
		this.store = input.store ?? new NativeApiSessionStore();
		this.startupController =
			input.startupController ??
			new NativeApiStartupController({ store: this.store });
		this.closeoutController =
			input.closeoutController ??
			new NativeApiCloseoutController({ store: this.store });
		this.providerTurn = input.providerTurn ?? callProviderToolTurn;
		this.usageRecorder = input.usageRecorder ?? recordLlmUsage;
	}

	async run(
		context: AgentRunContext,
		sink: AgentRuntimeSink,
		signal?: AbortSignal,
	): Promise<AgentRuntimeResult> {
		if (signal?.aborted || this.cancelledRunIds.has(context.runId)) {
			return this.toCancelled();
		}

		const executionMode = readNativeApiExecutionMode(context);
		const routeOverride = readRuntimeLlmRouteOverride(context);
		const resumeHistory = await this.loadResumeHistory(
			context,
			sink,
			executionMode,
		);
		let history: NativeApiHistoryItem[] = buildInitialNativeApiHistory(
			context,
			{ resumeHistory },
		);
		let state: NativeApiDispatchState = {
			readFiles: [],
			specificationRead: false,
			initialInstructionsCompleted: false,
			contextCompiled: false,
			todoAligned: false,
			startupCompleted: false,
			postImport: null,
			importProjectSucceeded: false,
			copyDirectorySucceeded: false,
			manifestReadAfterImport: false,
			successfulVerificationCommands: [],
			compileEvalCompleted: false,
		};
		let lastTodoSnapshotContent: string | null = null;
		let lastCurrentTodoContent: string | null = null;
		let lastPostImportHistoryToolCallId: string | null = null;
		const runController = new AbortController();
		this.activeRunControllers.set(context.runId, runController);
		const timeout = createNativeApiTimeoutSignal(
			signal,
			runController.signal,
			context.timeoutSeconds,
		);
		try {
			if (shouldForceNativeApiStartupGates(context)) {
				const startup = await this.startupController.runStartup({
					context,
					sink,
					history,
					state,
					resumeHistoryRestored: (resumeHistory?.length ?? 0) > 0,
					signal: timeout.signal,
				});
				history = startup.history;
				state = startup.state;
				if (!startup.ok) {
					return startup.result;
				}
			}
			const contextWindowBaselineHistory = [...history];
			let contextBudgetHintInserted = false;
			let runtimeBaselineCompactionCount = 0;

			for (let turnIndex = 1; ; turnIndex += 1) {
				if (await this.isCancelled(context.runId, timeout.signal))
					return this.toCancelled();
				const todoSnapshot = await buildTodoSnapshotHistory(context.runId);
				const currentTodo = todoSnapshot?.currentTodo ?? null;
				if (
					todoSnapshot?.snapshotItem &&
					todoSnapshot.snapshotItem.content !== lastTodoSnapshotContent
				) {
					history = [...history, todoSnapshot.snapshotItem];
					lastTodoSnapshotContent = todoSnapshot.snapshotItem.content;
				}
				if (
					todoSnapshot?.currentTodoItem &&
					todoSnapshot.currentTodoItem.content !== lastCurrentTodoContent
				) {
					history = [...history, todoSnapshot.currentTodoItem];
					lastCurrentTodoContent = todoSnapshot.currentTodoItem.content;
				}
				if (
					state.postImport &&
					state.postImport.toolCallId !== lastPostImportHistoryToolCallId
				) {
					history = [...history, buildPostImportHistoryItem(state.postImport)];
					lastPostImportHistoryToolCallId = state.postImport.toolCallId;
				}
				const routePolicy = await buildNativeApiRoutePolicy({
					sink,
					runId: context.runId,
					taskId: context.taskId,
					basePolicy: {
						disallowedProviderIds: ["codex"],
					},
				});
				const tools = getNativeApiToolDefinitions({ executionMode });
				let providerRequests = buildNativeApiProviderRequests({
					context,
					history,
					tools,
					routeOverride,
					routePolicy,
				});
				const routeSnapshotGuard = validateNativeApiRouteSnapshot(
					providerRequests,
					context,
				);
				if (!routeSnapshotGuard.ok) {
					await sink.emit({
						type: "runtime_error",
						message:
							"[NativeApiRunner] provider route candidate was outside the run snapshot.",
						payload: {
							runtime: "native_api_runner",
							executionMode,
							reason: "route_candidate_outside_snapshot",
							route: routeSnapshotGuard.route,
						},
					});
					return {
						terminalState: "needs_human",
						summary: "Native API route candidate was outside the run snapshot.",
						finalReport:
							"Native API route candidate was outside the run snapshot. Provider call was blocked before execution.",
						stoppedBy: "llm_error",
						riskLevel: "high",
					};
				}
				if (providerRequests.length === 0) {
					await sink.emit({
						type: "runtime_error",
						message:
							"[NativeApiRunner] no native/API provider route candidates were available.",
						payload: {
							runtime: "native_api_runner",
							executionMode,
							reason: "no_native_api_provider_route_candidates",
						},
					});
					return {
						terminalState: "needs_human",
						summary: "No native/API provider route candidates were available.",
						finalReport:
							"No native/API provider route candidates were available. NativeApiRunner did not fall back to Codex or SchemaFirst.",
						stoppedBy: "llm_error",
						riskLevel: "high",
					};
				}
				let contextBudget = estimateNativeApiContextBudget(providerRequests[0]);
				let contextCompaction: NativeApiBaselineCompactionResult | null = null;
				if (
					contextBudget.warningThresholdExceeded &&
					!contextBudgetHintInserted
				) {
					await emitNativeApiContextBudgetEvent({
						sink,
						context,
						action: "context_budget_warning",
						turnIndex,
						budget: contextBudget,
						message:
							"[NativeApiRunner] context budget warning threshold exceeded.",
					});
					history = [
						...history,
						{
							type: "user",
							source: "runtime",
							content: renderNativeApiContextBudgetHint(contextBudget),
						},
					];
					contextBudgetHintInserted = true;
					providerRequests = buildNativeApiProviderRequests({
						context,
						history,
						tools,
						routeOverride,
						routePolicy,
					});
					if (providerRequests.length === 0) {
						await sink.emit({
							type: "runtime_error",
							message:
								"[NativeApiRunner] no native/API provider route candidates were available.",
							payload: {
								runtime: "native_api_runner",
								executionMode,
								reason: "no_native_api_provider_route_candidates",
							},
						});
						return {
							terminalState: "needs_human",
							summary:
								"No native/API provider route candidates were available.",
							finalReport:
								"No native/API provider route candidates were available. NativeApiRunner did not fall back to Codex or SchemaFirst.",
							stoppedBy: "llm_error",
							riskLevel: "high",
						};
					}
					contextBudget = estimateNativeApiContextBudget(providerRequests[0]);
				}
				if (contextBudget.compactLimitExceeded) {
					if (
						runtimeBaselineCompactionCount >= MAX_RUNTIME_BASELINE_COMPACTIONS
					) {
						await emitNativeApiContextBudgetEvent({
							sink,
							context,
							action: "context_compaction_failed",
							turnIndex,
							budget: contextBudget,
							message:
								"[NativeApiRunner] context compaction loop guard stopped provider-native execution.",
						});
						return contextBudgetFailureResult(
							contextBudget,
							"context_compaction_loop_guard",
						);
					}
					await emitNativeApiContextBudgetEvent({
						sink,
						context,
						action: "context_compaction_started",
						turnIndex,
						budget: contextBudget,
						message:
							"[NativeApiRunner] context compaction started before provider call.",
					});
					contextCompaction = compactNativeApiHistoryToBaseline({
						baselineHistory: contextWindowBaselineHistory,
						previousHistory: history,
						reason: contextBudget.hardLimitExceeded
							? "hard_limit_exceeded_before_provider_call"
							: "auto_compact_limit_exceeded_before_provider_call",
						todoSnapshotItem: todoSnapshot?.snapshotItem,
						currentTodoItem: todoSnapshot?.currentTodoItem,
						postImportHistoryItem: state.postImport
							? buildPostImportHistoryItem(state.postImport)
							: null,
					});
					runtimeBaselineCompactionCount += 1;
					history = contextCompaction.history;
					providerRequests = buildNativeApiProviderRequests({
						context,
						history,
						tools,
						routeOverride,
						routePolicy,
					});
					if (providerRequests.length === 0) {
						await emitNativeApiContextBudgetEvent({
							sink,
							context,
							action: "context_compaction_failed",
							turnIndex,
							budget: contextBudget,
							message:
								"[NativeApiRunner] context compaction finished but no native/API provider route candidates remained.",
							compaction: contextCompaction,
						});
						return {
							terminalState: "needs_human",
							summary:
								"No native/API provider route candidates were available after compaction.",
							finalReport:
								"Context compaction completed, but no native/API provider route candidates remained. NativeApiRunner did not fall back to Codex or SchemaFirst.",
							stoppedBy: "llm_error",
							riskLevel: "high",
						};
					}
					contextBudget = estimateNativeApiContextBudget(providerRequests[0]);
					await emitNativeApiContextBudgetEvent({
						sink,
						context,
						action: "context_compaction_finished",
						turnIndex,
						budget: contextBudget,
						message:
							"[NativeApiRunner] context compaction finished before provider call.",
						compaction: contextCompaction,
					});
					if (
						contextBudget.compactLimitExceeded ||
						contextBudget.hardLimitExceeded
					) {
						await emitNativeApiContextBudgetEvent({
							sink,
							context,
							action: "context_compaction_failed",
							turnIndex,
							budget: contextBudget,
							message:
								"[NativeApiRunner] context compaction did not reduce the provider request below the compact limit.",
							compaction: contextCompaction,
						});
						return contextBudgetFailureResult(
							contextBudget,
							"context_compaction_insufficient",
						);
					}
				}
				const initialProviderRequest = providerRequests[0];
				const turn = await this.store.createTurn({
					runId: context.runId,
					taskId: context.taskId,
					turnIndex,
					history,
					provider: initialProviderRequest.provider,
					model:
						initialProviderRequest.options.normalizedRequest.modelOrDeployment,
					executionMode,
				});

				await sink.emit({
					type: "turn_started",
					message: `[NativeApiRunner] provider-native turn ${turnIndex} started.`,
					payload: {
						runtime: "native_api_runner",
						executionMode,
						turnId: turn.id,
						turnIndex,
						provider: initialProviderRequest.provider,
						providerEndpointId:
							initialProviderRequest.options.normalizedRequest
								.providerEndpointId,
						model:
							initialProviderRequest.options.normalizedRequest
								.modelOrDeployment,
						routeCandidateCount: providerRequests.length,
						messageRoles: initialProviderRequest.messages.map(
							(message) => message.role,
						),
						toolCount: initialProviderRequest.tools.length,
					},
				});

				const providerAttempt = await runNativeApiProviderAttempts({
					context,
					sink,
					turnId: turn.id,
					turnIndex,
					executionMode,
					signal: timeout.signal,
					history,
					contextWindowBaselineHistory,
					todoSnapshot,
					state,
					providerRequests,
					initialProviderRequest,
					contextBudget,
					contextCompaction,
					runtimeBaselineCompactionCount,
					tools,
					routeOverride,
					routePolicy,
					providerTurn: this.providerTurn,
					isCancelled: (runId, activeSignal) =>
						this.isCancelled(runId, activeSignal),
				});
				providerRequests = providerAttempt.providerRequests;
				history = providerAttempt.history;
				contextBudget = providerAttempt.contextBudget;
				runtimeBaselineCompactionCount =
					providerAttempt.runtimeBaselineCompactionCount;
				const providerResult = providerAttempt.providerResult;
				const providerRequest = providerAttempt.providerRequest;
				const providerDebug = providerAttempt.providerDebug;
				const startedAt = providerAttempt.startedAt;

				if (!providerResult) {
					const message =
						providerAttempt.failureMessage ??
						"No native API provider route succeeded.";
					const cancelled = await this.isCancelled(
						context.runId,
						timeout.signal,
					);
					await this.store.finishTurn({
						turnId: turn.id,
						status: cancelled ? "cancelled" : "failed",
						history,
						providerDebug,
						error: cancelled
							? { message: "Run cancelled during provider turn." }
							: { message },
					});
					if (cancelled) return this.toCancelled();
					await sink.emit({
						type: "runtime_error",
						message: `[NativeApiRunner] provider turn failed: ${message}`,
						payload: { provider: providerRequest.provider, error: message },
					});
					return {
						terminalState: "needs_human",
						summary: "Native API provider turn failed.",
						finalReport: `Native API provider turn failed without Codex/SchemaFirst fallback: ${message}`,
						stoppedBy: "llm_error",
						riskLevel: "high",
					};
				}

				if (await this.isCancelled(context.runId, timeout.signal)) {
					await this.store.finishTurn({
						turnId: turn.id,
						status: "cancelled",
						history,
						providerDebug,
						error: { message: "Run cancelled after provider turn." },
						model:
							providerResult.type === "supported"
								? (providerResult.model ?? null)
								: null,
					});
					return this.toCancelled();
				}

				if (providerResult.type === "unsupported") {
					await this.store.finishTurn({
						turnId: turn.id,
						status: "failed",
						history,
						providerDebug,
						error: { message: providerResult.reason },
					});
					return {
						terminalState: "needs_human",
						summary: "Native API provider tool turn is unsupported.",
						finalReport: `${providerResult.reason}. NativeApiRunner did not fall back to Codex or SchemaFirst.`,
						stoppedBy: "missing_tool_call",
						riskLevel: "high",
					};
				}

				await recordNativeApiTurnUsage({
					context,
					executionMode,
					providerResult,
					providerDebug,
					contextBudget,
					systemPrompt: providerRequest.systemPrompt,
					userPrompt: providerRequest.userPrompt,
					turnIndex,
					provider: providerRequest.options.normalizedRequest.providerId,
					model:
						providerResult.model ??
						providerRequest.options.normalizedRequest.modelOrDeployment,
					durationMs: Date.now() - startedAt,
					usageRecorder: this.usageRecorder,
				});

				history = [
					...history,
					{
						type: "assistant",
						content: providerResult.content,
						toolCalls: providerResult.toolCalls,
					},
				];

				if (providerResult.toolCalls.length === 0) {
					const finalText = providerResult.content.trim();
					const canComplete = canCompleteNativeApiWithTextOnly(
						executionMode,
						finalText,
					);
					await this.store.finishTurn({
						turnId: turn.id,
						status: canComplete ? "completed" : "failed",
						history,
						providerDebug,
						model: readNativeApiCompletedTurnModel(
							providerResult,
							providerRequest,
						),
					});
					if (canComplete) {
						return {
							terminalState: "completed",
							summary: firstLine(finalText),
							finalReport: finalText,
							stoppedBy: "decision",
							riskLevel: "medium",
						};
					}
					return {
						terminalState: "needs_human",
						summary: "Provider returned no native tool calls.",
						finalReport: finalText
							? "Provider returned text without native tool calls. NativeApiRunner requires tool calls/finalize_answer for this execution mode and did not fall back to Codex or SchemaFirst."
							: "Provider returned no native tool calls. NativeApiRunner requires finalize_answer and did not fall back to Codex or SchemaFirst.",
						stoppedBy: "missing_tool_call",
						riskLevel: "high",
					};
				}

				for (const toolCall of providerResult.toolCalls) {
					if (await this.isCancelled(context.runId, timeout.signal)) {
						await this.store.finishTurn({
							turnId: turn.id,
							status: "cancelled",
							history,
						});
						return this.toCancelled();
					}
					const record = await this.store.recordToolCallPending({
						runId: context.runId,
						taskId: context.taskId,
						turnId: turn.id,
						toolCall,
						todoSeq: currentTodo?.seq ?? context.currentTodo?.seq ?? null,
					});
					if (await this.isCancelled(context.runId, timeout.signal)) {
						await this.store.finishToolCall({
							id: record.id,
							status: "cancelled",
							error: { message: "Run cancelled before tool execution." },
							modelVisibleOutput: JSON.stringify({
								ok: false,
								error: {
									code: "RUN_CANCELLED",
									message: "Run cancelled before tool execution.",
								},
							}),
						});
						await this.store.finishTurn({
							turnId: turn.id,
							status: "cancelled",
							history,
						});
						return this.toCancelled();
					}
					await this.store.markToolCallRunning({ id: record.id });
					if (await this.isCancelled(context.runId, timeout.signal)) {
						await this.store.finishToolCall({
							id: record.id,
							status: "cancelled",
							error: { message: "Run cancelled before tool execution." },
							modelVisibleOutput: JSON.stringify({
								ok: false,
								error: {
									code: "RUN_CANCELLED",
									message: "Run cancelled before tool execution.",
								},
							}),
						});
						await this.store.finishTurn({
							turnId: turn.id,
							status: "cancelled",
							history,
						});
						return this.toCancelled();
					}
					const dispatch = await dispatchNativeApiToolCall({
						toolCall,
						context,
						sink,
						state,
					}).catch(
						(error): Awaited<ReturnType<typeof dispatchNativeApiToolCall>> => {
							const message =
								error instanceof Error ? error.message : String(error);
							return {
								kind: "continue",
								state,
								toolResult: capNativeApiToolResultContent({
									ok: false,
									content: JSON.stringify({
										ok: false,
										error: { code: "TOOL_DISPATCH_EXCEPTION", message },
									}),
									error: { code: "TOOL_DISPATCH_EXCEPTION", message },
								}),
							};
						},
					);
					state = dispatch.state;
					history = [
						...history,
						{
							type: "tool_result",
							toolCallId: toolCall.id,
							toolName: toolCall.name,
							result: dispatch.toolResult,
						},
					];
					await this.store.finishToolCall({
						id: record.id,
						status: dispatch.toolResult.ok ? "completed" : "failed",
						result: dispatch.toolResult,
						error: dispatch.toolResult.error,
						modelVisibleOutput: dispatch.toolResult.content,
					});
					if (dispatch.kind === "final") {
						const closeout = await this.closeoutController.runCompileEval({
							context,
							sink,
							turnId: turn.id,
							state,
							finalReport: dispatch.finalReport,
							todoSeq: currentTodo?.seq ?? context.currentTodo?.seq ?? null,
						});
						state = closeout.state;
						if (!closeout.skipped) {
							history = [...history, closeout.historyItem];
						}
						await this.store.finishTurn({
							turnId: turn.id,
							status: "completed",
							history,
							providerDebug,
							model: readNativeApiCompletedTurnModel(
								providerResult,
								providerRequest,
							),
						});
						return {
							terminalState: "completed",
							summary: dispatch.summary,
							finalReport: dispatch.finalReport,
							stoppedBy: "decision",
							riskLevel: "medium",
							testResults: dispatch.coverageAutonomyGate
								? { coverageAutonomy: dispatch.coverageAutonomyGate }
								: undefined,
						};
					}
				}

				await this.store.finishTurn({
					turnId: turn.id,
					status: "completed",
					history,
					providerDebug,
					model: readNativeApiCompletedTurnModel(
						providerResult,
						providerRequest,
					),
				});

				if (state.newContextWindowRequested) {
					history = [...contextWindowBaselineHistory];
					state = {
						...state,
						newContextWindowRequested: false,
					};
					lastTodoSnapshotContent = null;
					lastCurrentTodoContent = null;
					lastPostImportHistoryToolCallId = null;
					await sink.emit({
						type: "tool_call_progress",
						message:
							"[NativeApiRunner] started a new provider context window without summarizing conversation history.",
						payload: {
							action: "context_window_started",
							runtime: "native_api_runner",
							turnIndex,
							retainedHistoryItems: history.length,
						},
					});
				}
			}
		} finally {
			timeout.dispose();
			this.activeRunControllers.delete(context.runId);
		}
	}

	private async loadResumeHistory(
		context: AgentRunContext,
		sink: AgentRuntimeSink,
		executionMode: ReturnType<typeof readNativeApiExecutionMode>,
	) {
		const getLatestCompletedTurn =
			this.store.getLatestCompletedTurnForPreviousRun;
		if (typeof getLatestCompletedTurn !== "function") return null;
		const routeCompatibility = readNativeApiResumeRouteCompatibility(
			context,
			executionMode,
		);
		if (!routeCompatibility) {
			await sink.emit({
				type: "runtime_started",
				message:
					"[NativeApiRunner] runtime session resume skipped because route compatibility is unavailable.",
				payload: {
					runtime: "native_api_runner",
					action: "runtime.resume_state_missing",
					resumeState: "unavailable",
					reason: "route_compatibility_unavailable",
					executionMode,
				},
			});
			return null;
		}
		const sourceTurn = await getLatestCompletedTurn.call(this.store, {
			taskId: context.taskId,
			runId: context.runId,
			provider: routeCompatibility.provider,
			model: routeCompatibility.model,
			executionMode,
		});
		if (!sourceTurn?.historyJson) {
			await sink.emit({
				type: "runtime_started",
				message:
					"[NativeApiRunner] runtime session resume history unavailable.",
				payload: {
					runtime: "native_api_runner",
					action: "runtime.resume_state_missing",
					resumeState: "unavailable",
					reason: "no_compatible_completed_history",
					compatibility: routeCompatibility,
				},
			});
			return null;
		}
		const sanitized = sanitizeNativeApiResumeHistory(sourceTurn.historyJson);
		if (!sanitized) {
			await sink.emit({
				type: "runtime_warning",
				message:
					"[NativeApiRunner] invalid runtime session resume history ignored.",
				payload: {
					code: "native_api_resume_history_invalid",
					severity: "warning",
					message:
						"Invalid native/API resume history was ignored; runtime started fresh.",
				},
			});
			return null;
		}
		await sink.emit({
			type: "runtime_started",
			message: "[NativeApiRunner] runtime session resume history restored.",
			payload: {
				runtime: "native_api_runner",
				action: "runtime.resume_state_reused",
				runtimeResume: {
					kind: "native_api_history",
					status: "reused",
					sourceRunId: sourceTurn.runId,
					sourceTurnId: sourceTurn.id,
					restoredItemCount: sanitized.length,
					provider: routeCompatibility.provider,
					model: routeCompatibility.model,
					executionMode,
				},
			},
		});
		return sanitized;
	}

	async stop(runId: string): Promise<void> {
		this.cancelledRunIds.add(runId);
		this.activeRunControllers
			.get(runId)
			?.abort(new Error("NativeApiRunner stop requested."));
	}

	private toCancelled(): AgentRuntimeResult {
		return {
			terminalState: "cancelled",
			summary: "Runtime execution cancelled.",
			finalReport: "Runtime execution cancelled.",
			stoppedBy: "cancelled",
			riskLevel: "medium",
		};
	}

	private async isCancelled(runId: string, signal?: AbortSignal) {
		if (signal?.aborted || this.cancelledRunIds.has(runId)) return true;
		try {
			const run = await repo.getTaskRun(runId);
			if (run?.status === "cancelled") {
				this.cancelledRunIds.add(runId);
				return true;
			}
		} catch {
			return false;
		}
		return false;
	}
}
