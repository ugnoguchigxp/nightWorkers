import type {
	MissionPilotProviderPort,
	MissionPilotTaskActionPort,
	MissionPilotTaskReadPort,
} from "./mission-pilot-agent.ports";
import type { recordMissionPilotProviderTurnUsage } from "./mission-pilot-provider-usage";

export type MissionPilotAgentWakeInput = {
	sessionId: string;
	providerEndpointId?: string | null;
	model?: string | null;
	thinkingDepth?: string | null;
};

export type MissionPilotAgentRuntimeDependencies = {
	provider?: MissionPilotProviderPort;
	readPort?: MissionPilotTaskReadPort;
	actionPort?: MissionPilotTaskActionPort;
	maxProviderCallsPerWake?: number;
	maxToolCallsPerWake?: number;
	maxElapsedMsPerWake?: number;
	contextHardTokenBudget?: number;
	compactionTokenBudget?: number;
	recordProviderUsage?: typeof recordMissionPilotProviderTurnUsage;
};
