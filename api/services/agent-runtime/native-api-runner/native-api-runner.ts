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
import type { readNativeApiExecutionMode } from "./native-api-mode";
import { runNativeApiRunner } from "./native-api-run-coordinator";
import { readNativeApiResumeRouteCompatibility } from "./native-api-runner-routing";
import type { NativeApiUsageRecorder } from "./native-api-runner-usage";
import { NativeApiSessionStore } from "./native-api-session-store";
import {
	NativeApiStartupController,
	type NativeApiStartupControllerLike,
} from "./native-api-startup-controller";
import { sanitizeNativeApiResumeHistory } from "./native-api-tool-history";

export type NativeApiToolTurnProvider = typeof callProviderToolTurn;

const _NATIVE_API_TODO_SNAPSHOT_HEADER = "[Native API Runner Todo Snapshot]";
const _NATIVE_API_CURRENT_TODO_HEADER = "[Current Native API Runner Todo]";

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
		return runNativeApiRunner(
			{
				cancelledRunIds: this.cancelledRunIds,
				activeRunControllers: this.activeRunControllers,
				store: this.store,
				startupController: this.startupController,
				closeoutController: this.closeoutController,
				providerTurn: this.providerTurn,
				usageRecorder: this.usageRecorder,
				loadResumeHistory: (nextContext, nextSink, executionMode) =>
					this.loadResumeHistory(nextContext, nextSink, executionMode),
				toCancelled: () => this.toCancelled(),
				isCancelled: (runId, nextSignal) => this.isCancelled(runId, nextSignal),
			},
			context,
			sink,
			signal,
		);
	}

	private async loadResumeHistory(
		context: AgentRunContext,
		sink: AgentRuntimeSink,
		executionMode: ReturnType<typeof readNativeApiExecutionMode>,
	) {
		const getLatestCompletedTurn =
			this.store.getLatestCompletedTurnForPreviousRun;
		if (typeof getLatestCompletedTurn !== "function") return null;
		if (!context.agentModeSessionId) {
			await sink.emit({
				type: "runtime_started",
				message:
					"[NativeApiRunner] runtime session resume skipped because AgentModeSession is unavailable.",
				payload: {
					runtime: "native_api_runner",
					action: "runtime.resume_state_missing",
					resumeState: "unavailable",
					reason: "agent_mode_session_unavailable",
					executionMode,
				},
			});
			return null;
		}
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
			agentModeSessionId: context.agentModeSessionId,
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

function _readOntologyMcpEnabled(context: AgentRunContext) {
	const snapshot = context.contextSnapshot as Record<string, unknown>;
	const ontologyMcp = snapshot.ontologyMcp;
	if (
		!ontologyMcp ||
		typeof ontologyMcp !== "object" ||
		Array.isArray(ontologyMcp)
	)
		return false;
	const enabled = (ontologyMcp as Record<string, unknown>).enabled;
	return enabled === true;
}
