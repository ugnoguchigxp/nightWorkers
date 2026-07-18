import { createHash } from "node:crypto";
import {
	TASK_OPERATOR_PROJECTION_VERSION,
	type TaskOperatorBoundedTextRef,
	type TaskOperatorProjectionV1,
	taskOperatorProjectionV1Schema,
} from "../../../../shared/modules/taskOperator";
import type { OperatorArtifactRef } from "../../specification";
import { composeTaskOperatorCommandCatalog } from "../policies/task-operator-command-catalog";

const MAX_BOUNDED_TEXT_CHARS = 1_000;

export type TaskOperatorHeadFacts = {
	task: {
		id: string;
		revision: number;
		status: TaskOperatorProjectionV1["task"]["status"];
		title: string;
		objective: string | null;
		acceptanceCriteria: string | null;
		repository: {
			id: string;
			revision: number;
			state: TaskOperatorProjectionV1["project"]["repositoryState"];
		};
	};
	questionnaire: TaskOperatorProjectionV1["questionnaire"];
	artifactIndex: {
		revision: number;
		totalCount: number;
		nextCursor: number | null;
		latestByKind: OperatorArtifactRef[];
	};
	queue: TaskOperatorProjectionV1["queue"];
	run: {
		active: TaskOperatorProjectionV1["activeRun"];
		terminal: TaskOperatorProjectionV1["latestTerminalRun"];
	};
};

export function projectTaskOperatorHead(
	facts: TaskOperatorHeadFacts,
): TaskOperatorProjectionV1 {
	const commands = composeTaskOperatorCommandCatalog({
		taskRevision: facts.task.revision,
		taskStatus: facts.task.status,
		repositoryAvailable: facts.task.repository.state === "registered",
		hasActiveRun: Boolean(facts.run.active),
		hasTerminalRun: Boolean(facts.run.terminal),
		currentTodoStatus: facts.run.active?.currentTodoRef?.status ?? null,
	});
	const sourceRevision = Math.max(
		facts.task.revision,
		facts.task.repository.revision,
		facts.questionnaire?.revision ?? 0,
		facts.artifactIndex.revision,
		facts.queue?.revision ?? 0,
		facts.run.active?.revision ?? 0,
		facts.run.terminal?.revision ?? 0,
	);
	const withoutDigest = {
		version: TASK_OPERATOR_PROJECTION_VERSION,
		sourceRevision,
		task: {
			id: facts.task.id,
			revision: facts.task.revision,
			status: facts.task.status,
			title: facts.task.title,
			objective: boundedText(facts.task.objective, facts.task.revision),
			acceptanceCriteria: boundedText(
				facts.task.acceptanceCriteria,
				facts.task.revision,
			),
		},
		project: {
			id: facts.task.repository.id,
			revision: facts.task.repository.revision,
			repositoryState: facts.task.repository.state,
		},
		questionnaire: facts.questionnaire,
		artifactIndex: facts.artifactIndex,
		queue: facts.queue,
		activeRun: facts.run.active,
		latestTerminalRun: facts.run.terminal,
		commandCatalog: {
			revision: sourceRevision,
			availableIds: commands
				.filter((command) => command.availability === "available")
				.map((command) => command.id),
			confirmationRequiredIds: commands
				.filter((command) => command.availability === "confirmation_required")
				.map((command) => command.id),
			unavailableCount: commands.filter(
				(command) => command.availability === "unavailable",
			).length,
		},
		unreadEvents: { from: null, through: null, types: [] },
	};
	return taskOperatorProjectionV1Schema.parse({
		...withoutDigest,
		sourceDigest: digest(stableJson(withoutDigest)),
	});
}

function boundedText(
	value: string | null,
	sourceRevision: number,
): TaskOperatorBoundedTextRef | null {
	if (value === null) return null;
	return {
		text: value.slice(0, MAX_BOUNDED_TEXT_CHARS),
		truncated: value.length > MAX_BOUNDED_TEXT_CHARS,
		sourceRevision,
		sourceDigest: digest(value),
	};
}

function stableJson(value: unknown) {
	return JSON.stringify(sortValue(value));
}
function sortValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortValue);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, sortValue(entry)]),
	);
}
function digest(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
