import { recordLlmUsage } from "../../../../services/llm-usage";
import { callProviderToolTurn } from "../../../../services/structured-llm/providers";
import * as repo from "../../../nightworkers/nightworkers.repository";
import type {
	AgentRunContext,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "../types";
import { runNativeApiRunner } from "./native-api-run-coordinator";
import type { NativeApiUsageRecorder } from "./native-api-runner-usage";
import { NativeApiSessionStore } from "./native-api-session-store";
import { sanitizeNativeApiResumeHistory } from "./native-api-tool-history";

export type NativeApiToolTurnProvider = typeof callProviderToolTurn;

export class NativeApiRunner {
	private readonly cancelledRunIds = new Set<string>();
	private readonly activeRunControllers = new Map<string, AbortController>();
	private readonly store: NativeApiSessionStore;
	private readonly providerTurn: NativeApiToolTurnProvider;
	private readonly usageRecorder: NativeApiUsageRecorder;

	constructor(
		input: {
			store?: NativeApiSessionStore;
			providerTurn?: NativeApiToolTurnProvider;
			usageRecorder?: NativeApiUsageRecorder;
		} = {},
	) {
		this.store = input.store ?? new NativeApiSessionStore();
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
				providerTurn: this.providerTurn,
				usageRecorder: this.usageRecorder,
				loadResumeHistory: (nextContext, nextSink) =>
					this.loadResumeHistory(nextContext, nextSink),
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
	) {
		const getLatestCompletedTurn = this.store.getLatestCompletedTurnForRun;
		if (typeof getLatestCompletedTurn !== "function") return null;
		const sourceTurn = await getLatestCompletedTurn.call(
			this.store,
			context.runId,
		);
		if (!sourceTurn?.historyJson) {
			await sink.emit({
				type: "runtime_started",
				message:
					"[NativeApiRunner] runtime session resume history unavailable.",
				payload: {
					runtime: "native_api_runner",
					action: "runtime.resume_state_missing",
					resumeState: "unavailable",
					reason: "no_completed_history_for_run",
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
					sourceRunId: context.runId,
					sourceTurnId: sourceTurn.id,
					restoredItemCount: sanitized.length,
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

	async suspendForHostShutdown(runId: string): Promise<void> {
		this.activeRunControllers
			.get(runId)
			?.abort(new Error("NativeApiRunner host shutdown requested."));
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
