import { callMissionPilotHost } from "../../backend/host-bindings";

export type LlmFixtureKey = string;
export const renderLlmFixtureText = (...args: unknown[]) =>
	callMissionPilotHost("renderLlmFixtureText", ...args);
