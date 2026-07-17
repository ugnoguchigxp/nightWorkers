import { reviewTaskRun } from "../../nightworkers/nightworkers.service";

export function submitRunReviewCommand(input: {
	runId: string;
	action: "complete" | "cancel";
	note?: string;
	expectedTaskId: string;
	expectedTaskRevision: number;
}) {
	return reviewTaskRun(
		input.runId,
		{ action: input.action, note: input.note },
		{
			expectedTaskId: input.expectedTaskId,
			expectedTaskRevision: input.expectedTaskRevision,
		},
	);
}
