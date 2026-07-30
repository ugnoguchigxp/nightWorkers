import type { QueryClient } from "@tanstack/react-query";
import { questionnaireStateChangedRealtimeEventSchema } from "../../../shared/schemas/design-questionnaire.schema";
import { designQuestionnaireSessionsQueryKey } from "./questionnaireQuery";

export function invalidateQuestionnaireSessions(
	queryClient: QueryClient,
	taskId: string,
) {
	return queryClient.invalidateQueries({
		queryKey: designQuestionnaireSessionsQueryKey(taskId),
	});
}

export function applyQuestionnaireStateChangedRealtimeMessage(input: {
	message: unknown;
	activeTaskId: string | null;
	latestRevisionBySession: Map<
		string,
		{ revision: number; stateDigest: string }
	>;
	queryClient: QueryClient;
}) {
	const parsed = questionnaireStateChangedRealtimeEventSchema.safeParse(
		input.message,
	);
	if (!parsed.success || parsed.data.taskId !== input.activeTaskId)
		return false;
	const { payload } = parsed.data;
	if (payload.taskId !== parsed.data.taskId) return false;
	const previous = input.latestRevisionBySession.get(
		payload.questionnaireSessionId,
	);
	if (
		previous &&
		(previous.revision > payload.revision ||
			(previous.revision === payload.revision &&
				previous.stateDigest === payload.stateDigest))
	)
		return false;
	input.latestRevisionBySession.set(payload.questionnaireSessionId, {
		revision: payload.revision,
		stateDigest: payload.stateDigest,
	});
	void invalidateQuestionnaireSessions(input.queryClient, payload.taskId);
	return true;
}
