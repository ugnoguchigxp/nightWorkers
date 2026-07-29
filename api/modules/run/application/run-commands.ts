import { reviewTaskRunCommand } from "./run-review.command";

export async function submitRunReviewCommand(input: {
	runId: string;
	action: "complete" | "cancel";
	note?: string;
	expectedTaskId: string;
	expectedTaskRevision: number;
}) {
	return reviewTaskRunCommand(
		input.runId,
		{ action: input.action, note: input.note },
		{
			expectedTaskId: input.expectedTaskId,
			expectedTaskRevision: input.expectedTaskRevision,
		},
	);
}
