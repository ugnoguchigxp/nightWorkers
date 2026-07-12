import {
	getTaskDraftMissingFields,
	hasImplementationPlanEvidence,
} from "../nightworkers/nightworkers.planning-helpers.service";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as repo from "./queue.repository";

export async function listImplementationQueueDashboard() {
	const [settings, rows, tasks, repositories, activeQueueEntries] =
		await Promise.all([
			repo.getImplementationQueueSettings(),
			repo.listImplementationQueueEntries(),
			nightworkersRepo.listTasks(),
			nightworkersRepo.listRepositories(),
			repo.listActiveImplementationQueueEntries(),
		]);
	const entries = rows.map(({ entry, task, repository }) => ({
		...entry,
		task,
		repository,
	}));
	const activeQueuedTaskIds = new Set(
		activeQueueEntries.map((entry) => entry.taskId),
	);
	const repositoryById = new Map(
		repositories.map((repository) => [repository.id, repository]),
	);
	const notQueued = [];
	for (const task of tasks) {
		if (activeQueuedTaskIds.has(task.id)) continue;
		if (["completed", "cancelled", "failed", "timed_out"].includes(task.status))
			continue;
		const messages = await nightworkersRepo.listTaskMessages(task.id);
		const hasPlanEvidence = hasImplementationPlanEvidence(messages);
		if (getTaskDraftMissingFields(task).length > 0 && !hasPlanEvidence)
			continue;
		if (!hasPlanEvidence && !["ready", "queued"].includes(task.status))
			continue;
		const repository = repositoryById.get(task.repositoryId);
		if (!repository) continue;
		notQueued.push({ task, repository });
	}
	const occupiedEntries = entries.filter((entry) =>
		[
			"claimed",
			"processing",
			"needs_human",
			"awaiting_commit_decision",
		].includes(entry.status),
	);
	const processors = Array.from(
		{ length: settings.processorCount },
		(_value, index) => {
			const slot = index + 1;
			return {
				slot,
				entry:
					occupiedEntries.find((entry) => entry.processorSlot === slot) || null,
			};
		},
	);
	return {
		settings: { processorCount: settings.processorCount },
		processors,
		queued: entries.filter((entry) => entry.status === "queued"),
		completed: entries.filter((entry) =>
			["execution_completed", "failed", "cancelled"].includes(entry.status),
		),
		notQueued,
	};
}

import { prepareImplementationQueueAdmission } from "./queue-admission.service";
import {
	archiveImplementationQueueEntry,
	createImplementationQueueEntry,
	getTodoWorkflowSettings,
	patchImplementationQueueEntry,
	queueTask,
	recoverImplementationQueueEntry,
	requeueImplementationQueueEntry,
	updateImplementationQueueSettings,
	updateTodoWorkflowSettings,
} from "./queue-entry-commands.service";
import {
	listImplementationQueueHealth,
	reconcileImplementationQueue,
} from "./queue-health.service";

export {
	archiveImplementationQueueEntry,
	createImplementationQueueEntry,
	getTodoWorkflowSettings,
	listImplementationQueueHealth,
	patchImplementationQueueEntry,
	prepareImplementationQueueAdmission,
	queueTask,
	reconcileImplementationQueue,
	recoverImplementationQueueEntry,
	requeueImplementationQueueEntry,
	updateImplementationQueueSettings,
	updateTodoWorkflowSettings,
};
