import type {
	MissionPilotHostPorts,
	MissionPilotPublicActionCommand,
	MissionPilotPublicResourceQuery,
	MissionPilotRealtimeEvent,
} from "@nightworkers/mission-pilot/contracts";

export type MissionPilotHostPortAdapters = {
	query(input: MissionPilotPublicResourceQuery): Promise<unknown>;
	execute(input: MissionPilotPublicActionCommand): Promise<unknown>;
	submitUserMessage(
		input: Parameters<MissionPilotHostPorts["taskIntake"]["submitUserMessage"]>[0],
	): Promise<unknown>;
	subscribe(listener: (event: unknown) => void): () => void;
	publish(event: MissionPilotRealtimeEvent): Promise<void>;
	resolveSystemContext(
		input: Parameters<MissionPilotHostPorts["systemContext"]["resolve"]>[0],
	): Promise<unknown>;
	generateStructured(input: Record<string, unknown>): Promise<unknown>;
	assertTaskAction(
		input: Parameters<MissionPilotHostPorts["authorization"]["assertTaskAction"]>[0],
	): Promise<void>;
	now(): Date;
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
	randomId(): string;
	logInfo(message: string, context?: Record<string, unknown>): void;
	logError(message: string, context?: Record<string, unknown>): void;
};

export function createMissionPilotHostPorts(
	adapters: MissionPilotHostPortAdapters,
): MissionPilotHostPorts {
	return {
		taskOperator: {
			query: (input) => adapters.query(input),
			execute: (input) => adapters.execute(input),
		},
		taskIntake: {
			submitUserMessage: (input) => adapters.submitUserMessage(input),
		},
		events: {
			subscribe: (listener) => adapters.subscribe(listener),
		},
		realtime: {
			publish: (event) => adapters.publish(event),
		},
		systemContext: {
			resolve: (input) => adapters.resolveSystemContext(input),
		},
		structuredLlm: {
			generate: (input) => adapters.generateStructured(input),
		},
		authorization: {
			assertTaskAction: (input) => adapters.assertTaskAction(input),
		},
		clock: {
			now: () => adapters.now(),
			setTimeout: (callback, delayMs) =>
				adapters.setTimeout(callback, delayMs),
			clearTimeout: (handle) => adapters.clearTimeout(handle),
		},
		ids: {
			random: () => adapters.randomId(),
		},
		logger: {
			info: (message, context) => adapters.logInfo(message, context),
			error: (message, context) => adapters.logError(message, context),
		},
	};
}
