import { buildAgentModeSessionRouteIdentity } from "../../../services/agent-runtime/agent-mode-session";
import type { NativeApiExecutionMode } from "../../../services/agent-runtime/native-api-runner/native-api-mode";
import { associateMissionPilotChildRun } from "../../missionPilot/mission-pilot-run-association.service";
import { launchRuntimeExecution } from "./runtime-execution";
import type { LaunchRuntimeExecutionInput } from "./runtime-execution-types";
import { readMissionPilotEnvelope } from "./start-task-run-entry";
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

export class MissionPilotRunAssociationError extends Error {
	constructor() {
		super("Mission Pilot could not claim the prepared child run.");
		this.name = "MissionPilotRunAssociationError";
	}
}

export function createPreparedMissionPilotAssociation(input: {
	runtimeOptions: Record<string, unknown>;
	taskId: string;
	runId: string;
	executionMode: NativeApiExecutionMode;
	missionPilotPhase?: StartTaskRunOptions["missionPilotPhase"];
}) {
	return createRetryableLaunch(async () => {
		const missionPilot = readMissionPilotEnvelope(
			input.runtimeOptions.missionPilot,
		);
		if (
			missionPilot &&
			(input.executionMode === "implementation" ||
				input.executionMode === "test" ||
				input.executionMode === "review")
		) {
			const associated = await associateMissionPilotChildRun({
				taskId: input.taskId,
				runId: input.runId,
				phase: input.missionPilotPhase ?? input.executionMode,
				missionPilot,
			});
			if (!associated) throw new MissionPilotRunAssociationError();
		}
	});
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
