import { createHash } from "node:crypto";
import {
	type DesignQuestionnaireSession,
	type QuestionnaireStateChangedRealtimePayload,
	questionnaireStateChangedRealtimePayloadSchema,
} from "../../../shared/schemas/design-questionnaire.schema";

export function buildQuestionnaireStateChange(
	session: DesignQuestionnaireSession,
): QuestionnaireStateChangedRealtimePayload {
	const stateDigest = createHash("sha256")
		.update(
			JSON.stringify({
				status: session.status,
				updatedAt: session.updatedAt,
				questionSets: session.questionSets.map((set) => ({
					id: set.id,
					sequence: set.sequence,
					createdAt: set.createdAt,
				})),
				answers: session.answers.map((answer) => ({
					questionId: answer.questionId,
					answer: answer.answer,
					answeredAt: answer.answeredAt,
				})),
				reviews: session.reviews.map((review) => ({
					id: review.id,
					status: review.status,
					publishedMessageId: review.publishedMessageId,
					updatedAt: review.updatedAt,
				})),
			}),
		)
		.digest("hex");
	return questionnaireStateChangedRealtimePayloadSchema.parse({
		taskId: session.taskId,
		questionnaireSessionId: session.id,
		status: session.status,
		revision: new Date(session.updatedAt).getTime(),
		stateDigest,
	});
}
