import { callMissionPilotHost } from "../../backend/host-bindings";

// biome-ignore lint/suspicious/noExplicitAny: E2E fixture callbacks are isolated from production runtime
export type FixtureTurn = any;

export const registerFixtureProviderToolTurns = (...args: unknown[]) =>
	callMissionPilotHost("registerFixtureProviderToolTurns", ...args);
