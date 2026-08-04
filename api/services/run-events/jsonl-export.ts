import type {
	repositories,
	taskEvents,
	taskRuns,
	taskRunTodos,
} from "../../db/schema";
import { canonicalizeTaskEvent } from "./canonicalize";
import type {
	RunEventJsonlHeader,
	RunEventJsonlLine,
	RunSummaryJsonlLine,
} from "./types";

type RunRow = typeof taskRuns.$inferSelect;
type RepoRow = typeof repositories.$inferSelect;
type EventRow = typeof taskEvents.$inferSelect;
type TodoRow = typeof taskRunTodos.$inferSelect;

type RunWithEvents = {
	run: RunRow;
	repository?: RepoRow | null;
	events: EventRow[];
	todos?: TodoRow[];
};

export function buildRunJsonlHeader(
	run: RunRow,
	repository?: RepoRow | null,
): RunEventJsonlHeader {
	return {
		type: "nightworkers_run",
		version: 1,
		runId: run.id,
		taskId: run.taskId,
		repositoryId: run.repositoryId ?? null,
		createdAt: run.startedAt.toISOString(),
		cwd: repository?.localPath ?? null,
		workerKind: run.workerKind,
		exportedAt: new Date().toISOString(),
	};
}

export function serializeRunEventForJsonl(
	event: EventRow,
	run: RunRow,
): string {
	const payload = (event.payloadJson as Record<string, unknown>) || {};
	const runEvent = canonicalizeTaskEvent(event, run);
	const line: RunEventJsonlLine = {
		type: "run_event",
		version: 1,
		runId: run.id,
		seq: event.seq,
		event: {
			...runEvent,
			id: runEvent.id ?? event.id,
			seq: runEvent.seq ?? event.seq,
			runId: runEvent.runId || run.id,
			taskId: runEvent.taskId || run.taskId,
		},
		...(payload.reviewResult ? { reviewResult: payload.reviewResult } : {}),
	};
	return JSON.stringify(line);
}

export function buildRunJsonlSummary(
	run: RunRow,
	events: EventRow[],
	todos: TodoRow[] = [],
): RunSummaryJsonlLine {
	return {
		type: "run_summary",
		version: 1,
		runId: run.id,
		status: run.status,
		summary: run.summary,
		finalReport: run.finalReport,
		finalJudgment: run.finalJudgment,
		...(todos.length
			? {
					todos: todos.map((todo) => ({
						id: todo.id,
						seq: todo.seq,
						title: todo.title,
						taskType: todo.taskType,
						status: todo.status,
						procedureId: todo.procedureId,
						statusReason: todo.statusReason,
						humanBlocker: todo.humanBlockerJson,
						completionGateResult: todo.completionGateResult,
					})),
				}
			: {}),
		diffBytes: Buffer.byteLength(run.diffPatch || "", "utf8"),
		eventCount: events.length,
	};
}

export function serializeRunToJsonl(input: RunWithEvents): string {
	const sortedEvents = [...input.events]
		.filter((event) => typeof event.seq === "number")
		.sort((a, b) => a.seq - b.seq);
	const lines = [
		JSON.stringify(buildRunJsonlHeader(input.run, input.repository)),
		...sortedEvents.map((event) => serializeRunEventForJsonl(event, input.run)),
		JSON.stringify(buildRunJsonlSummary(input.run, sortedEvents, input.todos)),
	];
	return `${lines.join("\n")}\n`;
}
