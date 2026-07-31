import type { MissionPilotHostPorts } from "../contracts";

export * from "../backend/runtime/adapters/mission-pilot-provider.adapter";
export * from "../backend/runtime/agent/mission-pilot-action-command-executor";
export * from "../backend/runtime/agent/mission-pilot-action-execution.repository";
export * from "../backend/runtime/agent/mission-pilot-agent.ports";
export * from "../backend/runtime/agent/mission-pilot-agent-control-tools";
export * from "../backend/runtime/agent/mission-pilot-agent-lifecycle.repository";
export * from "../backend/runtime/agent/mission-pilot-agent-runtime";
export * from "../backend/runtime/agent/mission-pilot-agent-session.repository";
export * from "../backend/runtime/agent/mission-pilot-agent-wake.service";
export * from "../backend/runtime/agent/mission-pilot-content-page";
export * from "../backend/runtime/agent/mission-pilot-context-envelope";
export * from "../backend/runtime/agent/mission-pilot-conversation.repository";
export * from "../backend/runtime/agent/mission-pilot-conversation-query.repository";
export * from "../backend/runtime/agent/mission-pilot-current-step-context";
export * from "../backend/runtime/agent/mission-pilot-provider.port";
export * from "../backend/runtime/agent/mission-pilot-runtime-ownership.service";
export * from "../backend/runtime/agent/mission-pilot-task-action.adapter";
export * from "../backend/runtime/agent/mission-pilot-task-action.registry";
export * from "../backend/runtime/agent/mission-pilot-task-event.repository";
export * from "../backend/runtime/agent/mission-pilot-task-read.adapter";
export * from "../backend/runtime/agent/mission-pilot-tools";
export * from "../backend/runtime/mission-pilot.service";
export * from "../backend/runtime/mission-pilot-context";
export * from "../backend/runtime/mission-pilot-delegation";
export * from "../backend/runtime/mission-pilot-execution-query.service";
export * from "../backend/runtime/prompts/mission-pilot-system-context";
export * from "../backend/runtime/routes/mission-pilot-agent-fixture-scenarios";
export { backfillMissionPilotTraceProvenance } from "../backend/storage/provenance-backfill";

export function createMissionPilotHostPortsFake(
	overrides: Partial<MissionPilotHostPorts> = {},
): MissionPilotHostPorts {
	const clock = {
		now: () => new Date(0),
		setTimeout: (callback: () => void) => {
			callback();
			return 0;
		},
		clearTimeout: () => {},
	};
	return {
		taskOperator: {
			query: async () => ({}),
			execute: async () => ({}),
		},
		taskIntake: {
			submitUserMessage: async () => ({}),
		},
		events: {
			subscribe: () => () => {},
		},
		realtime: {
			publish: async () => {},
		},
		systemContext: {
			resolve: async () => ({}),
		},
		structuredLlm: {
			generate: async () => ({}),
		},
		authorization: {
			assertTaskAction: async () => {},
		},
		clock,
		ids: {
			random: () => "mission-pilot-test-id",
		},
		logger: {
			info: () => {},
			error: () => {},
		},
		...overrides,
	};
}
