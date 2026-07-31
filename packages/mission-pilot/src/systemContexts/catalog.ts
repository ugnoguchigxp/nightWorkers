import { callMissionPilotHost } from "../backend/host-bindings";

export type SystemContextP = (
	key: string,
	values: Record<string, unknown>,
) => string;
// biome-ignore lint/suspicious/noExplicitAny: opaque host snapshot is never inspected outside the package adapter
export type SystemContextBindingSnapshot = any;

export const p: SystemContextP = (key, values) =>
	callMissionPilotHost("renderSystemContext", key, values);
export const createSystemContextBindingSnapshot = (...args: unknown[]) =>
	callMissionPilotHost("createSystemContextBindingSnapshot", ...args);
export const bindSystemContextCatalogSnapshot = (...args: unknown[]) =>
	callMissionPilotHost("bindSystemContextCatalogSnapshot", ...args);
export const runWithSystemContextBinding = (...args: unknown[]) =>
	callMissionPilotHost("runWithSystemContextBinding", ...args);
export const systemContextPromptAudit = (...args: unknown[]) =>
	callMissionPilotHost("systemContextPromptAudit", ...args);
