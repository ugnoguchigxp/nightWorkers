import { queryOptions } from "@tanstack/react-query";
import type { DesignQuestionnaireSession } from "../nightworkers/types";
import { fetchDesignQuestionnaireSessions } from "./questionnaireCommands";

export const designQuestionnaireSessionsQueryKey = (taskId: string | null) =>
	["designQuestionnaireSessions", taskId] as const;

export function designQuestionnaireSessionsQueryOptions(taskId: string | null) {
	return queryOptions({
		queryKey: designQuestionnaireSessionsQueryKey(taskId),
		queryFn: async () => {
			if (!taskId) return [];
			const response = await fetchDesignQuestionnaireSessions(taskId);
			if (!response.ok)
				throw new Error("Failed to fetch Design Questionnaire sessions");
			return (await response.json()) as DesignQuestionnaireSession[];
		},
		enabled: Boolean(taskId),
		refetchOnWindowFocus: false,
		refetchOnReconnect: true,
	});
}
