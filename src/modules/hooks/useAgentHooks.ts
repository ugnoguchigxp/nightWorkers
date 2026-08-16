import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readJsonResponse } from "../../lib/api-error";
import type {
	AgentHookConfig,
	AgentHookInput,
	AgentHookTestResult,
} from "../nightworkers/types";
import {
	createAgentHook,
	deleteAgentHook,
	fetchAgentHooks,
	testAgentHook,
	updateAgentHook,
} from "./hooksCommands";

export function useAgentHooks() {
	const queryClient = useQueryClient();
	const { data: agentHooks = [] } = useQuery({
		queryKey: ["agentHooks"],
		queryFn: async () => {
			const data = await readJsonResponse<{ hooks: AgentHookConfig[] }>(
				await fetchAgentHooks(),
			);
			return data.hooks;
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	return {
		agentHooks,
		createAgentHook: async (input: AgentHookInput) => {
			const hook = await readJsonResponse<AgentHookConfig>(
				await createAgentHook(input),
			);
			queryClient.invalidateQueries({ queryKey: ["agentHooks"] });
			return hook;
		},
		updateAgentHook: async (id: string, input: Partial<AgentHookInput>) => {
			const hook = await readJsonResponse<AgentHookConfig>(
				await updateAgentHook(id, input),
			);
			queryClient.invalidateQueries({ queryKey: ["agentHooks"] });
			return hook;
		},
		deleteAgentHook: async (id: string) => {
			await readJsonResponse(await deleteAgentHook(id));
			queryClient.invalidateQueries({ queryKey: ["agentHooks"] });
		},
		testAgentHook: async (id: string) => {
			const result = await readJsonResponse<AgentHookTestResult>(
				await testAgentHook(id),
			);
			queryClient.invalidateQueries({ queryKey: ["agentHooks"] });
			return result;
		},
	};
}
