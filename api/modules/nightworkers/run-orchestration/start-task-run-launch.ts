import {
	associatePreparedTaskRun,
	type TaskRunAssociationRequest,
} from "../../agentsShare";
import { buildAgentModeSessionRouteIdentity } from "../../codingAgent";
import { launchRuntimeExecution } from "./runtime-execution";
import type { LaunchRuntimeExecutionInput } from "./runtime-execution-types";

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
