import type {
	Task,
	TaskRun,
	TaskRunTodo,
	WorkbenchArtifactRef,
} from "../nightworkers/types";

export type ReviewModePromptAction = {
	id: "code_review" | "security_scan" | "commit" | "push";
	label: string;
	description: string;
	prompt: string;
};

export const REVIEW_MODE_PROMPT_ACTIONS: ReviewModePromptAction[] = [
	{
		id: "code_review",
		label: "コードレビュー",
		description: "実装をレビューし、見つかった指摘事項まで修正します。",
		prompt: "コードレビューをしてください。指摘事項があれば修正してください。",
	},
	{
		id: "security_scan",
		label: "セキュリティスキャン",
		description:
			"vulnWorkbenchでスキャンし、検出された指摘結果まで修正します。",
		prompt:
			"vulnWorkbenchでセキュリティスキャンをしてください。指摘結果があれば修正してください。",
	},
	{
		id: "commit",
		label: "コミット",
		description: "現在の変更を確認してコミットします。",
		prompt: "コミットしてください。",
	},
	{
		id: "push",
		label: "プッシュ",
		description: "現在のブランチをリモートへプッシュします。",
		prompt: "プッシュしてください。",
	},
];

const REVIEW_READY_RUN_STATUSES = new Set(["completed", "needs_review"]);
const CLOSED_TODO_STATUSES = new Set(["passed", "skipped"]);

function runExecutionMode(run: TaskRun) {
	const snapshot = run.contextSnapshot;
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
		return null;
	}
	return (snapshot as Record<string, unknown>).executionMode ?? null;
}

export function isPostImplementationReviewReady(input: {
	task: Task;
	run?: TaskRun;
	todos: TaskRunTodo[];
}) {
	const { task, run, todos } = input;
	if (!run || run.taskId !== task.id) return false;
	if (task.missionPilot?.desiredState === "playing") return false;
	if (!REVIEW_READY_RUN_STATUSES.has(run.status)) return false;
	if (runExecutionMode(run) !== "implementation") return false;
	if (!run.finalReport?.trim() || todos.length === 0) return false;
	if (!todos.every((todo) => CLOSED_TODO_STATUSES.has(todo.status)))
		return false;
	const finalTodo = [...todos].sort((a, b) => b.seq - a.seq)[0];
	return finalTodo?.status === "passed";
}

export function buildPostImplementationReviewArtifact(input: {
	task: Task;
	run: TaskRun;
	todos: TaskRunTodo[];
}): WorkbenchArtifactRef | null {
	if (!isPostImplementationReviewReady(input)) return null;
	return {
		id: `review-mode-${input.run.id}`,
		taskId: input.task.id,
		runId: input.run.id,
		kind: "review_status",
		title: "Review Mode",
		summary: "実装後のレビュー、セキュリティ確認、Git操作を実行します。",
		source: {
			type: "run_field",
			runId: input.run.id,
			field: "finalReport",
		},
		createdAt: String(
			input.run.finishedAt || input.run.endedAt || input.run.updatedAt,
		),
		metadata: { reviewModeLauncher: true },
	};
}
