import type { TodoContextInput, TodoContextSnapshot } from "./types";

export function buildTodoContextSnapshot(
	input: TodoContextInput,
): TodoContextSnapshot {
	const procedure = input.todo.procedureSnapshot;
	return {
		version: 1,
		todo: {
			id: input.todo.id,
			seq: input.todo.seq,
			title: input.todo.title,
			description: input.todo.description || null,
			taskType: input.todo.taskType,
		},
		selectedProcedure: {
			id: procedure?.id || input.todo.procedureId || null,
			source: procedure?.source || null,
			title: procedure?.title || null,
			digest: procedure?.digest || null,
		},
		runContext: {
			source: input.runContext.source,
			degraded: input.runContext.degraded,
			degradedReason: input.runContext.degradedReason,
			digest: input.runContext.result.digest,
			charCount: input.runContext.result.charCount,
		},
		previousTodoSummaries: (input.previousTodoSummaries || []).map(
			(summary) => ({
				id: summary.id,
				seq: summary.seq,
				title: summary.title,
				status: summary.status,
				summary: summary.summary || null,
			}),
		),
	};
}
