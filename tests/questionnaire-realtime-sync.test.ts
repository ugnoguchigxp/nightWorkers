import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
	applyQuestionnaireStateChangedRealtimeMessage,
	designQuestionnaireSessionsQueryKey,
} from "../src/modules/questionnaire";

const taskId = "00000000-0000-4000-8000-000000000101";
const questionnaireSessionId = "00000000-0000-4000-8000-000000000201";
const otherQuestionnaireSessionId = "00000000-0000-4000-8000-000000000202";

function event(input: {
	taskId?: string;
	questionnaireSessionId?: string;
	revision: number;
	stateDigest?: string;
}) {
	const targetTaskId = input.taskId ?? taskId;
	return {
		type: "questionnaire.state_changed",
		taskId: targetTaskId,
		payload: {
			taskId: targetTaskId,
			questionnaireSessionId:
				input.questionnaireSessionId ?? questionnaireSessionId,
			status: "review_ready",
			revision: input.revision,
			stateDigest: input.stateDigest ?? "a".repeat(64),
		},
	};
}

describe("Questionnaire realtime UI synchronization", () => {
	it("invalidates the canonical task query without applying realtime answers", () => {
		const queryClient = new QueryClient();
		const queryKey = designQuestionnaireSessionsQueryKey(taskId);
		const canonical = [
			{ id: questionnaireSessionId, status: "answering", answers: [] },
		];
		queryClient.setQueryData(queryKey, canonical);
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");

		expect(
			applyQuestionnaireStateChangedRealtimeMessage({
				message: event({ revision: 10 }),
				activeTaskId: taskId,
				latestRevisionBySession: new Map(),
				queryClient,
			}),
		).toBe(true);
		expect(invalidate).toHaveBeenCalledWith({ queryKey });
		expect(queryClient.getQueryData(queryKey)).toBe(canonical);
	});

	it("ignores another Task and never overwrites an active session from another session payload", () => {
		const queryClient = new QueryClient();
		const queryKey = designQuestionnaireSessionsQueryKey(taskId);
		const canonical = [
			{ id: questionnaireSessionId, status: "answering", answers: [] },
		];
		queryClient.setQueryData(queryKey, canonical);
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");
		const revisions = new Map<
			string,
			{ revision: number; stateDigest: string }
		>();

		expect(
			applyQuestionnaireStateChangedRealtimeMessage({
				message: event({
					taskId: "00000000-0000-4000-8000-000000000102",
					revision: 10,
				}),
				activeTaskId: taskId,
				latestRevisionBySession: revisions,
				queryClient,
			}),
		).toBe(false);
		expect(
			applyQuestionnaireStateChangedRealtimeMessage({
				message: event({
					questionnaireSessionId: otherQuestionnaireSessionId,
					revision: 10,
				}),
				activeTaskId: taskId,
				latestRevisionBySession: revisions,
				queryClient,
			}),
		).toBe(true);
		expect(queryClient.getQueryData(queryKey)).toBe(canonical);
		expect(invalidate).toHaveBeenCalledTimes(1);
	});

	it("deduplicates the same revision and ignores delayed older revisions", () => {
		const queryClient = new QueryClient();
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");
		const revisions = new Map<
			string,
			{ revision: number; stateDigest: string }
		>();
		const apply = (revision: number, stateDigest?: string) =>
			applyQuestionnaireStateChangedRealtimeMessage({
				message: event({ revision, stateDigest }),
				activeTaskId: taskId,
				latestRevisionBySession: revisions,
				queryClient,
			});

		expect(apply(10)).toBe(true);
		expect(apply(10)).toBe(false);
		expect(apply(9)).toBe(false);
		expect(apply(10, "b".repeat(64))).toBe(true);
		expect(apply(11)).toBe(true);
		expect(invalidate).toHaveBeenCalledTimes(3);
	});
});
