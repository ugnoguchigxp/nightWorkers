import type { MissionPilotHostPorts } from "../contracts";
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
