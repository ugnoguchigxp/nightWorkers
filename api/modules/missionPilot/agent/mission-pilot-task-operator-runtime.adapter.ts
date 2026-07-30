import type { TaskOperatorCommandRuntime } from "../../taskOperator";
import { missionPilotArtifactProviderExecutionPolicy } from "../adapters/mission-pilot-provider.adapter";
import { missionPilotDelegatedAuthorizationPort } from "../mission-pilot-delegation";
import {
	missionPilotArtifactTrace,
	missionPilotThoughtTrace,
} from "../mission-pilot-trace-provenance";

export function buildMissionPilotTaskOperatorRuntime(input: {
	sessionId: string;
	toolCallId: string;
	idempotencyKey: string;
	signal?: AbortSignal;
}): TaskOperatorCommandRuntime {
	return {
		signal: input.signal,
		structuredLlmRole: "mission_pilot",
		providerExecutionPolicy: missionPilotArtifactProviderExecutionPolicy,
		usageTrace: missionPilotThoughtTrace({ sessionId: input.sessionId }),
		artifactTrace: missionPilotArtifactTrace({ sessionId: input.sessionId }),
		messageTrace: missionPilotThoughtTrace({ sessionId: input.sessionId }),
		delegatedAuthorization: missionPilotDelegatedAuthorizationPort,
		messageMetadata: {
			source: "mission_pilot",
			missionPilotSessionId: input.sessionId,
			intent: "chat",
			commandProvenance: {
				idempotencyKey: input.idempotencyKey,
				requestId: input.toolCallId,
			},
		},
	};
}
