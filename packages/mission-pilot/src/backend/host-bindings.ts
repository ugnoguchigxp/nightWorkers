import type { MissionPilotPersistenceRequest } from "../contracts";

// Host callbacks are intentionally kept behind this package-private adapter.
// Validation and authorization remain in the public Task Operator/LLM ports.
// biome-ignore lint/suspicious/noExplicitAny: the adapter preserves host callback signatures without exporting host-private types
type HostCallback = (...args: any[]) => any;

export type MissionPilotRuntimeHostBindings = Record<string, HostCallback>;

export type MissionPilotPersistenceHostBinding = Readonly<{
	executeMissionPilotPersistence(
		request: MissionPilotPersistenceRequest,
	): Promise<unknown>;
}>;

let configuredBindings: MissionPilotRuntimeHostBindings | null = null;

export function configureMissionPilotRuntimeHost(
	bindings: MissionPilotRuntimeHostBindings,
) {
	configuredBindings = bindings;
}

export function clearMissionPilotRuntimeHost() {
	configuredBindings = null;
}

// biome-ignore lint/suspicious/noExplicitAny: callers recover their package-local signature at the adapter module
export function callMissionPilotHost(name: string, ...args: any[]): any {
	const callback = configuredBindings?.[name];
	if (!callback) {
		throw new Error(`Mission Pilot host callback is unavailable: ${name}`);
	}
	return callback(...args);
}
