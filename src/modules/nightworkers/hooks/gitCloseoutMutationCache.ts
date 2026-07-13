import type { QueryClient } from "@tanstack/react-query";
import type { GitCloseoutState } from "../types";

export function syncGitCloseoutMutationCache(
	queryClient: QueryClient,
	state: GitCloseoutState,
	activeSessionId?: string | null,
) {
	queryClient.setQueryData<GitCloseoutState | null>(
		["gitCloseout", state.runId],
		state,
	);
	queryClient.invalidateQueries({ queryKey: ["gitCloseout", state.runId] });
	queryClient.invalidateQueries({ queryKey: ["runDetails", state.runId] });
	if (activeSessionId) {
		queryClient.invalidateQueries({
			queryKey: ["sessionRuns", activeSessionId],
		});
	}
}
