import { AppError } from "../../../lib/errors";
import { p } from "../../../systemContexts/catalog";
import type {
	StructuredProviderCallAuthorizationContext,
	StructuredProviderExecutionPolicy,
} from "../../agentsShare";
import * as missionPilotRepo from "../mission-pilot.repository";

export async function authorizeMissionPilotProviderCall(
	context: StructuredProviderCallAuthorizationContext,
) {
	context.signal?.throwIfAborted();
	const session = context.taskId
		? await missionPilotRepo.getSessionByTaskId(context.taskId)
		: null;
	const authorized =
		session?.desiredState === "playing" &&
		missionPilotRepo.hasValidAuthorization(session);
	if (!authorized)
		throw new AppError(
			409,
			"MISSION_PILOT_PROVIDER_DISABLED",
			"Mission Pilotが起動していないため、provider呼び出しを実行できません。",
		);
	context.signal?.throwIfAborted();
}

export const missionPilotToolTurnProviderExecutionPolicy: StructuredProviderExecutionPolicy =
	{
		isolatedHome: true,
		enableMcp: false,
		enableMemory: false,
		allowProviderTools: true,
		authorizeProviderCall: authorizeMissionPilotProviderCall,
		get developerInstructions() {
			return p("missionPilot.tool-turn-provider-instructions", {});
		},
	};

export const missionPilotArtifactProviderExecutionPolicy: StructuredProviderExecutionPolicy =
	{
		isolatedHome: true,
		enableMcp: false,
		enableMemory: false,
		allowProviderTools: false,
		authorizeProviderCall: authorizeMissionPilotProviderCall,
		get developerInstructions() {
			return p("missionPilot.artifact-provider-instructions", {});
		},
	};
