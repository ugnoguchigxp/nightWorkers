import { queryOptions } from "@tanstack/react-query";
import { readJsonResponse } from "../../lib/api-error";
import type { DesignQuestionnaireSession } from "../nightworkers/types";
import { fetchDesignQuestionnaireSessions } from "./questionnaireCommands";

export const designQuestionnaireSessionsQueryKey = (taskId: string | null) =>
	["designQuestionnaireSessions", taskId] as const;

export function designQuestionnaireSessionsQueryOptions(taskId: string | null) {
	return queryOptions({
		queryKey: designQuestionnaireSessionsQueryKey(taskId),
		queryFn: async () => {
			if (!taskId) return [];
			return readJsonResponse<DesignQuestionnaireSession[]>(
				await fetchDesignQuestionnaireSessions(taskId),
			);
		},
		enabled: Boolean(taskId),
		refetchOnWindowFocus: false,
		refetchOnReconnect: true,
	});
}
