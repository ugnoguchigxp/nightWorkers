import { useQuery, useQueryClient } from "@tanstack/react-query";
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
			const res = await fetchAgentHooks();
			if (!res.ok) throw new Error("Failed to fetch Agent Hooks");
			const data = (await res.json()) as { hooks: AgentHookConfig[] };
			return data.hooks;
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	return {
		agentHooks,
		createAgentHook: async (input: AgentHookInput) => {
			const res = await createAgentHook(input);
			if (!res.ok) throw new Error(await res.text());
			const hook = (await res.json()) as AgentHookConfig;
			queryClient.invalidateQueries({ queryKey: ["agentHooks"] });
			return hook;
		},
		updateAgentHook: async (id: string, input: Partial<AgentHookInput>) => {
			const res = await updateAgentHook(id, input);
			if (!res.ok) throw new Error(await res.text());
			const hook = (await res.json()) as AgentHookConfig;
			queryClient.invalidateQueries({ queryKey: ["agentHooks"] });
			return hook;
		},
		deleteAgentHook: async (id: string) => {
			const res = await deleteAgentHook(id);
			if (!res.ok) throw new Error(await res.text());
			queryClient.invalidateQueries({ queryKey: ["agentHooks"] });
		},
		testAgentHook: async (id: string) => {
			const res = await testAgentHook(id);
			if (!res.ok) throw new Error(await res.text());
			const result = (await res.json()) as AgentHookTestResult;
			queryClient.invalidateQueries({ queryKey: ["agentHooks"] });
			return result;
		},
	};
}
