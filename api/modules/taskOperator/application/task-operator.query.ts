import type { TaskOperatorQueryContext } from "../../../../shared/modules/taskOperator";
import { readQuestionnaireOperatorState } from "../../questionnaire";
import { readQueueOperatorState } from "../../queue";
import { readRunOperatorState } from "../../run";
import { readArtifactOperatorIndex } from "../../specification";
import { readTaskOperatorTask } from "../../task";
import { projectTaskOperatorHead } from "../projections/task-operator-head.projection";

export async function readTaskOperatorProjection(
	taskId: string,
	_context: TaskOperatorQueryContext,
) {
	const [task, questionnaire, artifacts, queue, run] = await Promise.all([
		readTaskOperatorTask(taskId),
		readQuestionnaireOperatorState(taskId),
		readArtifactOperatorIndex({ taskId, limit: 32 }),
		readQueueOperatorState(taskId),
		readRunOperatorState(taskId),
	]);
	return projectTaskOperatorHead({
		task,
		questionnaire,
		artifactIndex: {
			revision: artifacts.revision,
			totalCount: artifacts.totalCount,
			nextCursor: artifacts.nextCursor,
			latestByKind: artifacts.latestByKind,
		},
		queue,
		run: {
			active: run.active
				? {
						id: run.active.id,
						revision: run.active.revision,
						status: run.active.status,
						currentTodoRef: run.active.currentTodo,
					}
				: null,
			terminal: run.terminal,
		},
	});
}
