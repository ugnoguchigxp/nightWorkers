import type { RuntimePromptSnapshot } from "../../../services/todo-context";
import type { AgentRuntimeResult } from "../../codingAgent";
import {
	buildSecurityFinalJudgmentContinuation,
	evaluateSecurityFinalizationGate,
} from "../../securityIntelligence/security-finalization-gate.service";
import { buildSecurityRuntimeContextSnapshot } from "../../securityIntelligence/security-runtime-context.service";
import * as repo from "../nightworkers.repository";
import { IMPLEMENTATION_QUEUE_LEASE_TTL_MS } from "./queues";
import type { LaunchRuntimeExecutionInput } from "./runtime-execution-types";
import { ACTIVE_RUN_HEARTBEAT_INTERVAL_MS } from "./runtime-heartbeat";
import { toAgentRuntimeTodoContext } from "./todo-closeout";

type RuntimeAdapter = ReturnType<
	LaunchRuntimeExecutionInput["runtimeLaneDefinition"]["createAdapter"]
>;
type RuntimeSink = Parameters<RuntimeAdapter["start"]>[1];
type CodingAgentSystemContext = Parameters<
	RuntimeAdapter["start"]
>[0]["codingAgentSystemContext"];

export function mergeSecurityContinuationResult(input: {
	previous: AgentRuntimeResult;
	continuation: AgentRuntimeResult;
	securityFinalJudgment: AgentRuntimeResult["securityFinalJudgment"];
}): AgentRuntimeResult {
	return {
		...input.previous,
		...input.continuation,
		logContent: [input.previous.logContent, input.continuation.logContent]
			.filter(Boolean)
			.join("\n"),
		diffPatch: input.continuation.diffPatch ?? input.previous.diffPatch,
		testResults: input.continuation.testResults ?? input.previous.testResults,
		usage: input.continuation.usage ?? input.previous.usage,
		contractWarnings: [
			...(input.previous.contractWarnings ?? []),
			...(input.continuation.contractWarnings ?? []),
		],
		securityFinalJudgment: input.securityFinalJudgment,
	};
}

export async function enforceSecurityRuntimeFinalization(input: {
	launch: LaunchRuntimeExecutionInput;
	runtime: RuntimeAdapter;
	sink: RuntimeSink;
	executionLease: { heartbeat(): Promise<unknown> };
	runtimeResult: AgentRuntimeResult;
	effectiveRuntimeContextSnapshot: RuntimePromptSnapshot;
	codingAgentSystemContext: CodingAgentSystemContext;
}): Promise<{ blocked: boolean; runtimeResult: AgentRuntimeResult }> {
	const {
		taskId,
		task,
		run,
		repoInfo,
		compiledPromptText,
		runtimeOptions,
		agentModeSessionId,
	} = input.launch;
	let runtimeResult = input.runtimeResult;
	if (runtimeResult.terminalState === "cancelled") {
		return { blocked: false, runtimeResult };
	}
	let securityContinuationUsed = false;
	let securityGate = await evaluateSecurityFinalizationGate({
		runId: run.id,
		proposedJudgment: runtimeResult.securityFinalJudgment,
	});
	if (securityGate.required && !securityGate.valid) {
		securityContinuationUsed = true;
		await repo.createRunEvent({
			version: 1,
			runId: run.id,
			taskId,
			timestamp: new Date().toISOString(),
			type: "system.warning",
			severity: "warning",
			actor: "system",
			message:
				"Security Final Judgmentを受理できなかったため、同じruntime laneへ継続します。",
			data: {
				reasonCode: securityGate.reasonCode,
				conditionRefs: securityGate.conditionRefs,
				contractRef: securityGate.contractRef,
				invalidStructuredPayload: securityGate.invalidJudgment ?? null,
			},
		});
		const refreshedSecurityContext = await buildSecurityRuntimeContextSnapshot({
			taskRevisionSnapshotId: run.taskRevisionSnapshotId,
			runId: run.id,
		});
		const continuationContextSnapshot = {
			...input.effectiveRuntimeContextSnapshot,
			securityContractContext: refreshedSecurityContext,
		};
		const continuationHeartbeat = setInterval(() => {
			void Promise.all([
				repo.refreshImplementationQueueLeaseForRun({
					runId: run.id,
					leaseTtlMs: IMPLEMENTATION_QUEUE_LEASE_TTL_MS,
				}),
				repo.heartbeatActiveTaskRun(run.id),
				input.executionLease.heartbeat(),
			]);
		}, ACTIVE_RUN_HEARTBEAT_INTERVAL_MS);
		continuationHeartbeat.unref?.();
		let continuationResult: AgentRuntimeResult;
		try {
			continuationResult = await input.runtime.start(
				{
					runId: run.id,
					taskId,
					agentModeSessionId,
					repositoryId: task.repositoryId,
					repoRoot: repoInfo.localPath,
					compiledPrompt: compiledPromptText,
					latestUserMessage:
						buildSecurityFinalJudgmentContinuation(securityGate),
					imageAttachments: [],
					timeoutSeconds: task.timeoutSeconds ?? 3600,
					safetyPolicy: repoInfo.safetyPolicy || undefined,
					contextSnapshot: continuationContextSnapshot,
					runtimeOptions,
					todoPlan: (await repo.listTaskRunTodosForRun(run.id)).map(
						toAgentRuntimeTodoContext,
					),
					codingAgentSystemContext: input.codingAgentSystemContext,
				},
				input.sink,
			);
		} finally {
			clearInterval(continuationHeartbeat);
		}
		if (continuationResult.terminalState === "cancelled") {
			return {
				blocked: false,
				runtimeResult: mergeSecurityContinuationResult({
					previous: runtimeResult,
					continuation: continuationResult,
					securityFinalJudgment: undefined,
				}),
			};
		}
		securityGate = await evaluateSecurityFinalizationGate({
			runId: run.id,
			proposedJudgment: continuationResult.securityFinalJudgment,
		});
		runtimeResult = mergeSecurityContinuationResult({
			previous: runtimeResult,
			continuation: continuationResult,
			securityFinalJudgment:
				securityGate.valid && securityGate.required
					? securityGate.judgment
					: undefined,
		});
	}
	if (securityGate.required && !securityGate.valid) {
		await repo.updateTaskRunIfStatus(run.id, "running", {
			logContent: runtimeResult.logContent,
			diffPatch: runtimeResult.diffPatch,
			testResults: runtimeResult.testResults,
			finalReport: runtimeResult.finalReport,
			summary: runtimeResult.summary,
			contextSnapshot: {
				...input.effectiveRuntimeContextSnapshot,
				securityFinalJudgmentContinuation: {
					version: 1,
					boundedContinuationUsed: securityContinuationUsed,
					reasonCode: securityGate.reasonCode,
					conditionRefs: securityGate.conditionRefs,
					contractRef: securityGate.contractRef,
				},
			},
		});
		await repo.createRunEvent({
			version: 1,
			runId: run.id,
			taskId,
			timestamp: new Date().toISOString(),
			type: "system.warning",
			severity: "warning",
			actor: "system",
			message:
				"Security Final Judgmentが未完了のため、Runをterminal化しません。",
			data: {
				reasonCode: securityGate.reasonCode,
				conditionRefs: securityGate.conditionRefs,
				contractRef: securityGate.contractRef,
				boundedContinuationUsed: securityContinuationUsed,
				invalidStructuredPayload: securityGate.invalidJudgment ?? null,
			},
		});
		return { blocked: true, runtimeResult };
	}
	return { blocked: false, runtimeResult };
}

export async function recheckSecurityRuntimeFinalization(input: {
	runId: string;
	taskId: string;
	proposedJudgment?: AgentRuntimeResult["securityFinalJudgment"];
}) {
	const gate = await evaluateSecurityFinalizationGate({
		runId: input.runId,
		proposedJudgment: input.proposedJudgment,
	});
	if (gate.required && !gate.valid) {
		await repo.createRunEvent({
			version: 1,
			runId: input.runId,
			taskId: input.taskId,
			timestamp: new Date().toISOString(),
			type: "system.warning",
			severity: "warning",
			actor: "system",
			message:
				"Final Judgment保存後にSecurity Contractまたはcondition headが変化したため、Runをterminal化しません。",
			data: {
				reasonCode: gate.reasonCode,
				conditionRefs: gate.conditionRefs,
				contractRef: gate.contractRef,
			},
		});
	}
	return gate;
}
