import {
	associatePreparedTaskRun,
	type TaskRunAssociationRequest,
} from "../../agentsShare";
import {
	buildAgentModeSessionRouteIdentity,
	restoreInterruptedCodingAgentRunAfterLaunchFailure,
} from "../../codingAgent";
import { activateTaskRunResume } from "./resume-task-run-activation";
import { launchRuntimeExecution } from "./runtime-execution";
import type { LaunchRuntimeExecutionInput } from "./runtime-execution-types";
import { failPreparedRunBeforeLaunch } from "./start-task-run-failure";
import type { StartTaskRunOptions } from "./start-task-run-types";

type RouteIdentityInput = Parameters<
	typeof buildAgentModeSessionRouteIdentity
>[0];

export function buildContinuationRouteIdentity(input: {
	executionMode: RouteIdentityInput["executionMode"];
	llmRole: RouteIdentityInput["llmRole"];
	runtimeLane: RouteIdentityInput["runtimeLane"];
	runtimeLlmRoute?: {
		providerId?: string | null;
		providerEndpointId?: string | null;
		model?: string | null;
		thinkingDepth?: string | null;
	} | null;
}) {
	const provider =
		input.runtimeLlmRoute?.providerId ??
		(input.runtimeLane === "codex-sdk" ? "codex" : null);
	const route = {
		executionMode: input.executionMode,
		llmRole: input.llmRole,
		runtimeLane: input.runtimeLane,
		provider,
		providerEndpointId: input.runtimeLlmRoute?.providerEndpointId ?? null,
		model: input.runtimeLlmRoute?.model ?? null,
		thinkingDepth: input.runtimeLlmRoute?.thinkingDepth ?? null,
	} satisfies RouteIdentityInput;
	return {
		runtimeLane: route.runtimeLane,
		provider: route.provider ?? null,
		providerEndpointId: route.providerEndpointId ?? null,
		model: route.model ?? null,
		thinkingDepth: route.thinkingDepth ?? null,
		fingerprint: buildAgentModeSessionRouteIdentity(route),
		continuationEligible:
			Boolean(route.provider && route.model) &&
			(route.runtimeLane === "codex-sdk" || Boolean(input.runtimeLlmRoute)),
	};
}

export function createPreparedRunAssociation(input: {
	taskId: string;
	runId: string;
	request?: TaskRunAssociationRequest;
}) {
	return createRetryableLaunch(() => associatePreparedTaskRun(input));
}

export function createPreparedRuntimeLaunch(
	runtime: LaunchRuntimeExecutionInput,
) {
	return createRetryableLaunch(() => launchRuntimeExecution(runtime));
}

export async function launchPreparedTaskRun(input: {
	launch?: () => Promise<void>;
	runId: string;
	taskId: string;
	executionMode: string;
	resumeCommand: StartTaskRunOptions["resumeCommand"];
}) {
	try {
		await input.launch?.();
	} catch (error) {
		if (input.resumeCommand?.kind === "process_interruption") {
			await restoreInterruptedCodingAgentRunAfterLaunchFailure({
				runId: input.runId,
				expectedInterruptionRevision:
					input.resumeCommand.expectedInterruptionRevision,
				error,
			});
		} else {
			await failPreparedRunBeforeLaunch({
				runId: input.runId,
				taskId: input.taskId,
				executionMode: input.executionMode,
				error,
			});
		}
		throw error;
	}
}

export async function activatePreparedTaskRun<TRun>(input: {
	run: TRun;
	associate?: () => Promise<void>;
	resumeRunId?: string;
	resumeCommand: StartTaskRunOptions["resumeCommand"];
	taskId: string;
	executionMode: string;
}) {
	try {
		await input.associate?.();
		if (!input.resumeRunId || !input.resumeCommand) return input.run;
		return (await activateTaskRunResume({
			runId: input.resumeRunId,
			...input.resumeCommand,
		})) as TRun;
	} catch (error) {
		if (input.resumeCommand?.kind !== "process_interruption") {
			await failPreparedRunBeforeLaunch({
				runId: readRunId(input.run),
				taskId: input.taskId,
				executionMode: input.executionMode,
				error,
			});
		}
		throw error;
	}
}

export function createRetryableLaunch(action: () => Promise<void> | void) {
	let launched = false;
	let pending: Promise<void> | null = null;
	return async () => {
		if (launched) return;
		if (pending) return pending;
		const attempt = Promise.resolve().then(action);
		pending = attempt;
		try {
			await attempt;
			launched = true;
		} finally {
			if (pending === attempt) pending = null;
		}
	};
}

function readRunId(run: unknown) {
	const id = (run as { id?: unknown })?.id;
	if (typeof id !== "string") throw new Error("Prepared Run ID is missing.");
	return id;
}
