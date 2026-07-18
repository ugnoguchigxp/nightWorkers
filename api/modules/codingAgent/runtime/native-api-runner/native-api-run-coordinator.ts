import { runFinalizeController } from "../../../../services/run-control/finalize-controller";
import type { callProviderToolTurn } from "../../../../services/structured-llm/providers";
import type {
	AgentRunContext,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "../types";
import { readNativeApiExecutionMode } from "./native-api-mode";
import { runNativeApiProviderAttempts } from "./native-api-provider-attempts";
import { prepareNativeApiRunContext } from "./native-api-run-context-preparation";
import { prepareNativeApiRunRoute } from "./native-api-run-route-preparation";
import { buildTodoSnapshotHistory } from "./native-api-runner-history-cards";
import {
	firstLine,
	readNativeApiCompletedTurnModel,
} from "./native-api-runner-routing";
import { createNativeApiTimeoutSignal } from "./native-api-runner-timeout";
import {
	type NativeApiUsageRecorder,
	recordNativeApiTurnUsage,
} from "./native-api-runner-usage";
import type { NativeApiSessionStore } from "./native-api-session-store";
import {
	dispatchNativeApiToolCall,
	type NativeApiDispatchState,
} from "./native-api-tool-dispatcher";
import {
	buildInitialNativeApiHistory,
	getLatestNativeApiUserContentByHeader,
	type NativeApiHistoryItem,
} from "./native-api-tool-history";
import { capNativeApiToolResultContent } from "./native-api-tool-result-projector";

export type NativeApiToolTurnProvider = typeof callProviderToolTurn;

const NATIVE_API_TODO_SNAPSHOT_HEADER = "[Native API Runner Todo Snapshot]";
const NATIVE_API_CURRENT_TODO_HEADER = "[Current Native API Runner Todo]";

export type NativeApiRunnerHost = {
	cancelledRunIds: Set<string>;
	activeRunControllers: Map<string, AbortController>;
	store: NativeApiSessionStore;
	providerTurn: NativeApiToolTurnProvider;
	usageRecorder: NativeApiUsageRecorder;
	loadResumeHistory: (
		context: AgentRunContext,
		sink: AgentRuntimeSink,
	) => Promise<NativeApiHistoryItem[] | null>;
	toCancelled: () => AgentRuntimeResult;
	isCancelled: (runId: string, signal?: AbortSignal) => Promise<boolean>;
};

export async function runNativeApiRunner(
	runtime: NativeApiRunnerHost,
	context: AgentRunContext,
	sink: AgentRuntimeSink,
	signal?: AbortSignal,
): Promise<AgentRuntimeResult> {
	if (signal?.aborted || runtime.cancelledRunIds.has(context.runId)) {
		return runtime.toCancelled();
	}

	const executionMode = readNativeApiExecutionMode(context);
	const resumeHistory = await runtime.loadResumeHistory(context, sink);
	let history: NativeApiHistoryItem[] = buildInitialNativeApiHistory(context, {
		resumeHistory,
	});
	let lastAssistantText = latestAssistantText(history);
	let state: NativeApiDispatchState = {
		readFiles: [],
		postImport: null,
	};
	let lastTodoSnapshotContent: string | null =
		getLatestNativeApiUserContentByHeader(
			history,
			NATIVE_API_TODO_SNAPSHOT_HEADER,
		);
	let lastCurrentTodoContent: string | null =
		getLatestNativeApiUserContentByHeader(
			history,
			NATIVE_API_CURRENT_TODO_HEADER,
		);
	const runController = new AbortController();
	runtime.activeRunControllers.set(context.runId, runController);
	const timeout = createNativeApiTimeoutSignal(
		signal,
		runController.signal,
		context.timeoutSeconds,
	);
	const toInterruptedResult = (): AgentRuntimeResult =>
		timeout.didTimeout()
			? {
					terminalState: "needs_human",
					summary: "Native API runner reached its execution time limit.",
					finalReport:
						lastAssistantText ||
						"実行時間の上限に達したため、現在の Todo を保持して一時停止しました。再開すると同じ Todo から処理を続けます。",
					stoppedBy: "budget",
					riskLevel: "high",
				}
			: runtime.toCancelled();
	try {
		const contextWindowBaselineHistory = [...history];
		let contextBudgetHintInserted = false;
		let runtimeBaselineCompactionCount = 0;

		for (let turnIndex = 1; ; turnIndex += 1) {
			if (await runtime.isCancelled(context.runId, timeout.signal))
				return toInterruptedResult();
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
			const routePreparation = await prepareNativeApiRunRoute({
				context,
				sink,
				executionMode,
				history,
				currentTodo,
			});
			if (routePreparation.kind === "failed") {
				return routePreparation.result;
			}
			let providerRequests = routePreparation.providerRequests;
			const { tools, routeOverride, routePolicy } = routePreparation;
			const contextPreparation = await prepareNativeApiRunContext({
				context,
				sink,
				turnIndex,
				history,
				contextWindowBaselineHistory,
				todoSnapshot,
				state,
				tools,
				routeOverride,
				routePolicy,
				providerRequests,
				contextBudgetHintInserted,
				runtimeBaselineCompactionCount,
			});
			if (contextPreparation.kind === "failed") {
				return contextPreparation.result;
			}
			history = contextPreparation.history;
			providerRequests = contextPreparation.providerRequests;
			contextBudgetHintInserted = contextPreparation.contextBudgetHintInserted;
			runtimeBaselineCompactionCount =
				contextPreparation.runtimeBaselineCompactionCount;
			let contextBudget = contextPreparation.contextBudget;
			const contextCompaction = contextPreparation.contextCompaction;
			const initialProviderRequest = providerRequests[0];
			const turn = await runtime.store.createTurn({
				runId: context.runId,
				taskId: context.taskId,
				agentModeSessionId: context.agentModeSessionId,
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
						initialProviderRequest.options.normalizedRequest.providerEndpointId,
					model:
						initialProviderRequest.options.normalizedRequest.modelOrDeployment,
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
				providerTurn: runtime.providerTurn,
				isCancelled: (runId, activeSignal) =>
					runtime.isCancelled(runId, activeSignal),
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
				const cancelled = await runtime.isCancelled(
					context.runId,
					timeout.signal,
				);
				await runtime.store.finishTurn({
					turnId: turn.id,
					status: cancelled ? "cancelled" : "failed",
					history,
					providerDebug,
					error: cancelled
						? { message: "Run cancelled during provider turn." }
						: { message },
				});
				if (cancelled) return toInterruptedResult();
				await sink.emit({
					type: "runtime_error",
					message: `[NativeApiRunner] provider turn failed: ${message}`,
					payload: { provider: providerRequest.provider, error: message },
				});
				return {
					terminalState: "failed",
					summary: "Native API provider turn failed.",
					finalReport: lastAssistantText || message,
					stoppedBy: "llm_error",
					riskLevel: "high",
				};
			}

			if (await runtime.isCancelled(context.runId, timeout.signal)) {
				await runtime.store.finishTurn({
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
				return toInterruptedResult();
			}

			if (providerResult.type === "unsupported") {
				await runtime.store.finishTurn({
					turnId: turn.id,
					status: "failed",
					history,
					providerDebug,
					error: { message: providerResult.reason },
				});
				return {
					terminalState: "failed",
					summary: "Native API provider tool turn is unsupported.",
					finalReport: lastAssistantText || providerResult.reason,
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
				usageRecorder: runtime.usageRecorder,
			});

			history = [
				...history,
				{
					type: "assistant",
					content: providerResult.content,
					toolCalls: providerResult.toolCalls,
				},
			];
			if (providerResult.content.trim()) {
				lastAssistantText = providerResult.content;
			}

			if (providerResult.toolCalls.length === 0) {
				const finalText = providerResult.content.trim();
				if (!finalText) {
					history = [
						...history,
						{
							type: "user",
							source: "runtime",
							content: JSON.stringify({
								ok: false,
								error: {
									code: "FINAL_RESPONSE_REQUIRED",
									message:
										"tool結果を読んで次の行動を選ぶか、最終回答本文を返してください。",
								},
							}),
						},
					];
					await runtime.store.finishTurn({
						turnId: turn.id,
						status: "completed",
						history,
						providerDebug,
						model: readNativeApiCompletedTurnModel(
							providerResult,
							providerRequest,
						),
					});
					continue;
				}
				const completion = await runFinalizeController.evaluateCandidate({
					runId: context.runId,
					expectedPlanRevision: todoSnapshot?.planRevision ?? 0,
					expectedTodoRevisions: todoSnapshot?.todoRevisions ?? {},
				});
				await runtime.store.finishTurn({
					turnId: turn.id,
					status: "completed",
					history,
					providerDebug,
					model: readNativeApiCompletedTurnModel(
						providerResult,
						providerRequest,
					),
				});
				if (completion.allowFinalize) {
					return {
						terminalState: "completed",
						summary: firstLine(finalText),
						finalReport: finalText,
						stoppedBy: "decision",
						riskLevel: "medium",
					};
				}
				if (completion.code === "RUN_NEEDS_HUMAN") {
					return {
						terminalState: "needs_human",
						summary: firstLine(finalText),
						finalReport: finalText,
						stoppedBy: "decision",
						riskLevel: "medium",
					};
				}
				history = [
					...history,
					{
						type: "user",
						source: "runtime",
						content: JSON.stringify({
							ok: false,
							error: {
								code: completion.code,
								message: completion.message,
							},
							currentSnapshot: completion.snapshot,
							finalCandidate: finalText,
						}),
					},
				];
				continue;
			}

			for (const toolCall of providerResult.toolCalls) {
				if (await runtime.isCancelled(context.runId, timeout.signal)) {
					await runtime.store.finishTurn({
						turnId: turn.id,
						status: "cancelled",
						history,
					});
					return toInterruptedResult();
				}
				const existingCall = await runtime.store.getToolCall(
					context.runId,
					toolCall.id,
				);
				if (existingCall) {
					const result = existingCall.resultJson
						? capNativeApiToolResultContent(
								existingCall.resultJson as {
									ok: boolean;
									content: string;
									error?: { code: string; message: string };
								},
							)
						: capNativeApiToolResultContent({
								ok: false,
								content: JSON.stringify({
									ok: false,
									error: {
										code: "ACTION_RESULT_UNCERTAIN",
										message:
											"同じtool call IDの実行記録がありますが、resultが確定していません。状態を確認して次の行動を選んでください。",
									},
								}),
								error: {
									code: "ACTION_RESULT_UNCERTAIN",
									message: "同じtool call IDの実行結果が未確定です。",
								},
							});
					history = [
						...history,
						{
							type: "tool_result",
							toolCallId: toolCall.id,
							toolName: toolCall.name,
							result,
						},
					];
					continue;
				}
				const record = await runtime.store.recordToolCallPending({
					runId: context.runId,
					taskId: context.taskId,
					turnId: turn.id,
					toolCall,
					todoSeq: currentTodo?.seq ?? context.currentTodo?.seq ?? null,
				});
				if (await runtime.isCancelled(context.runId, timeout.signal)) {
					await runtime.store.finishToolCall({
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
					await runtime.store.finishTurn({
						turnId: turn.id,
						status: "cancelled",
						history,
					});
					return toInterruptedResult();
				}
				await runtime.store.markToolCallRunning({ id: record.id });
				if (await runtime.isCancelled(context.runId, timeout.signal)) {
					await runtime.store.finishToolCall({
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
					await runtime.store.finishTurn({
						turnId: turn.id,
						status: "cancelled",
						history,
					});
					return toInterruptedResult();
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
				await runtime.store.finishToolCall({
					id: record.id,
					status: dispatch.toolResult.ok ? "completed" : "failed",
					result: dispatch.toolResult,
					error: dispatch.toolResult.error,
					modelVisibleOutput: dispatch.toolResult.content,
				});
			}

			await runtime.store.finishTurn({
				turnId: turn.id,
				status: "completed",
				history,
				providerDebug,
				model: readNativeApiCompletedTurnModel(providerResult, providerRequest),
			});
		}
	} finally {
		timeout.dispose();
		runtime.activeRunControllers.delete(context.runId);
	}
}

function latestAssistantText(history: readonly NativeApiHistoryItem[]) {
	return (
		[...history]
			.reverse()
			.find(
				(item): item is Extract<NativeApiHistoryItem, { type: "assistant" }> =>
					item.type === "assistant" && Boolean(item.content.trim()),
			)?.content ?? ""
	);
}
