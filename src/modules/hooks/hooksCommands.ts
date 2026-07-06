import { apiFetch } from "../../lib/api-base";
import { jsonRequest } from "../../lib/api-request";
import type { AgentHookInput } from "../nightworkers/types";

export function fetchAgentHooks() {
	return apiFetch("/api/settings/hooks");
}

export function createAgentHook(input: AgentHookInput) {
	return apiFetch("/api/settings/hooks", jsonRequest("POST", input));
}

export function updateAgentHook(id: string, input: Partial<AgentHookInput>) {
	return apiFetch(`/api/settings/hooks/${id}`, jsonRequest("PUT", input));
}

export function deleteAgentHook(id: string) {
	return apiFetch(`/api/settings/hooks/${id}`, { method: "DELETE" });
}

export function testAgentHook(id: string) {
	return apiFetch(`/api/settings/hooks/${id}/test`, { method: "POST" });
}
