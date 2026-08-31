import {
	createTask,
	listTasks,
} from "../../api/modules/nightworkers/nightworkers.basic.service";
import * as nightworkersRepo from "../../api/modules/nightworkers/nightworkers.repository";
import {
	measureProjectExplorationRun,
} from "../../api/modules/ontology/exploration/project-exploration-measurement";
import {
	saveProjectExplorationCatalogSettings,
} from "../../api/modules/ontology/exploration/project-exploration-settings.service";
import { startTaskRun } from "../../api/modules/nightworkers/run-orchestration/start-task-run";
import { listTaskEventsForRun } from "../../api/modules/nightworkers/nightworkers.runs-event.repository";
import { listTaskRunsForTask } from "../../api/modules/nightworkers/nightworkers.runs.repository";
import { listLlmUsageRecordsForRun } from "../../api/services/llm-usage/repository";
import { runIndependentEvaluator } from "./evaluator";
import { pilotPromptDigest } from "./report";
import {
	progress,
	recordValue,
	routeEvidence,
	sleep,
} from "./runtime-infrastructure";
import {
	classifyPair,
	classifyPairReasonCodes,
	type PilotPair,
} from "./runtime-support";
import {
	modelPilotTask,
	pilotTaskDescription,
	PILOT_TASKS,
	type PilotTask,
} from "./tasks";

const POLL_INTERVAL_MS = 2_000;
const TERMINAL_RUN_STATUSES = new Set([
	"completed",
	"failed",
	"cancelled",
	"needs_review",
	"blocked",
	"timed_out",
	"needs_human",
]);

type PilotMode = "baseline" | "catalog";
type PilotRouteOverride = {
	providerEndpointId: string;
	model: string;
	thinkingDepth: "low" | "medium" | "high" | "very_high";
	requestTimeoutSeconds?: number;
};

export async function runPair(input: {
	task: PilotTask;
	pilotId: string;
	repositoryId: string;
	mcpServerId: string;
	timeoutSeconds: number;
	routeOverride: PilotRouteOverride;
	cooldownSeconds: number;
	executionOrder: [PilotMode, PilotMode];
	maxAttemptsPerTask: number;
}): Promise<PilotPair> {
	const attemptNumber = await nextAttemptNumber(input);
	if (attemptNumber > input.maxAttemptsPerTask) {
		throw new Error(
			`Task ${input.task.id} exceeded its pre-registered attempt limit of ${input.maxAttemptsPerTask}.`,
		);
	}
	const members = new Map<PilotMode, Awaited<ReturnType<typeof runPairMember>>>();
	for (const [index, mode] of input.executionOrder.entries()) {
		const member = await runPairMember({ ...input, mode, attemptNumber });
		members.set(mode, member);
		if (index === 0 && input.cooldownSeconds > 0) {
			progress({
				event: "pilot.cooldown",
				seconds: input.cooldownSeconds,
				reason: "provider_capacity_recovery_between_pair_members",
			});
			await sleep(input.cooldownSeconds * 1_000);
		}
	}
	const baseline = members.get("baseline");
	const catalog = members.get("catalog");
	if (!baseline || !catalog) throw new Error("Paired pilot did not produce both arms.");
	return {
		pairId: input.task.id,
		attemptNumber,
		executionOrder: input.executionOrder,
		promptDigest: pilotPromptDigest(input.task),
		baseline,
		catalog,
		classification: classifyPair({ baseline, catalog }),
		classificationReasonCodes: classifyPairReasonCodes({ baseline, catalog }),
		controls: {
			sameBaseRef: baseline.baseRef === catalog.baseRef,
			sameTaskPrompt:
				baseline.taskPromptFingerprint === catalog.taskPromptFingerprint &&
				baseline.taskPromptFingerprint === pilotPromptDigest(input.task),
			sameRoute: JSON.stringify(baseline.route) === JSON.stringify(catalog.route),
			independentWorktrees:
				Boolean(baseline.worktreePath) &&
				Boolean(catalog.worktreePath) &&
				baseline.worktreePath !== catalog.worktreePath,
		},
	};
}

async function runPairMember(input: {
	task: PilotTask;
	pilotId: string;
	repositoryId: string;
	mcpServerId: string;
	timeoutSeconds: number;
	routeOverride: PilotRouteOverride;
	mode: PilotMode;
	attemptNumber: number;
}) {
	const started = await prepareAndStartRun(input);
	if (input.mode === "catalog") {
		await saveProjectExplorationCatalogSettings(input.repositoryId, {
			enabled: false,
			mcpServerId: input.mcpServerId,
		});
	}
	const terminal = await waitForTerminalRun(
		started.runId,
		input.timeoutSeconds + 180,
	);
	const measurement = await measureRun(terminal);
	const evaluation = started.worktreePath
		? await runIndependentEvaluator({
			worktreePath: started.worktreePath,
			task: input.task,
		})
		: null;
	return {
		taskId: started.taskId,
		runId: terminal.id,
		status: terminal.status,
		baseRef: terminal.baseRef,
		worktreePath: started.worktreePath,
		taskPromptFingerprint: pilotPromptDigest(input.task),
		measurement,
		evaluation,
		route: routeEvidence(terminal.contextSnapshot),
		systemPromptFingerprint: await systemPromptFingerprintForRun(terminal.id),
	};
}

async function nextAttemptNumber(input: { pilotId: string; task: PilotTask }) {
	const prefix = `${input.pilotId}:${input.task.id}:`;
	const attempts = (await listTasks())
		.map((task) => task.createdBy)
		.filter((createdBy): createdBy is string => createdBy?.startsWith(prefix) ?? false)
		.map((createdBy) => Number(createdBy.split(":").at(-1)))
		.filter(Number.isInteger);
	return Math.max(0, ...attempts) + 1;
}

export async function consumedPairAttemptCount(pilotId: string) {
	const prefix = `${pilotId}:`;
	const attempts = new Set<string>();
	for (const task of await listTasks()) {
		if (!task.createdBy?.startsWith(prefix)) continue;
		const [taskId, mode, attemptNumber] = task.createdBy
			.slice(prefix.length)
			.split(":");
		if (
			!PILOT_TASKS.some((candidate) => candidate.id === taskId) ||
			(mode !== "baseline" && mode !== "catalog") ||
			!Number.isInteger(Number(attemptNumber)) ||
			Number(attemptNumber) < 1
		) {
			continue;
		}
		attempts.add(`${taskId}:${attemptNumber}`);
	}
	return attempts.size;
}

export async function pilotRunInventory(pilotId: string) {
	const prefix = `${pilotId}:`;
	const pilotTasks = (await listTasks()).filter((task) =>
		task.createdBy?.startsWith(prefix),
	);
	return Promise.all(
		pilotTasks.map(async (task) => ({
			taskId: task.id,
			createdBy: task.createdBy,
			runs: (await listTaskRunsForTask(task.id)).map((run) => ({
				runId: run.id,
				status: run.status,
			})),
		})),
	);
}

export async function activePilotRunCountFor(pilotId: string) {
	const prefix = `${pilotId}:`;
	const pilotTasks = (await listTasks()).filter((task) =>
		task.createdBy?.startsWith(prefix),
	);
	const runGroups = await Promise.all(
		pilotTasks.map((task) => listTaskRunsForTask(task.id)),
	);
	return runGroups.flat().filter((run) => !TERMINAL_RUN_STATUSES.has(run.status))
		.length;
}

export async function assertPairEvidenceIntegrity(pair: PilotPair) {
	const task = PILOT_TASKS.find((candidate) => candidate.id === pair.pairId);
	if (!task || pair.promptDigest !== pilotPromptDigest(task)) {
		throw new Error("Pilot pair does not match a sealed task prompt.");
	}
	for (const arm of [pair.baseline, pair.catalog]) {
		if (arm.taskPromptFingerprint !== pair.promptDigest) {
			throw new Error("Pilot arm does not match its pair task prompt.");
		}
		const run = await nightworkersRepo.getTaskRun(arm.runId);
		if (!run || run.taskId !== arm.taskId || run.status !== arm.status) {
			throw new Error("Pilot run record no longer matches its recorded pair arm.");
		}
		const [events, usageRecords] = await Promise.all([
			listTaskEventsForRun(arm.runId),
			listLlmUsageRecordsForRun(arm.runId),
		]);
		if (
			events.some((event) => event.taskRunId !== arm.runId) ||
			usageRecords.some(
				(record) => record.runId !== arm.runId || record.taskId !== arm.taskId,
			)
		) {
			throw new Error("Pilot run evidence has an invalid task or run reference.");
		}
	}
}

export function interruptionCode(_error: unknown) {
	return "pilot_pair_interrupted_before_classification";
}

async function prepareAndStartRun(input: {
	task: PilotTask;
	pilotId: string;
	repositoryId: string;
	mcpServerId: string;
	timeoutSeconds: number;
	routeOverride: PilotRouteOverride;
	mode: PilotMode;
	attemptNumber: number;
}) {
	const createdBy = `${input.pilotId}:${input.task.id}:${input.mode}:${input.attemptNumber}`;
	const prompt = modelPilotTask(input.task);
	const task = await createTask({
		repositoryId: input.repositoryId,
		title: prompt.title,
		description: pilotTaskDescription(input.task, input.mode),
		objective: prompt.objective,
		acceptanceCriteria: prompt.acceptanceCriteria,
		timeoutSeconds: input.timeoutSeconds,
		createdBy,
	});
	await saveProjectExplorationCatalogSettings(input.repositoryId, {
		enabled: input.mode === "catalog",
		mcpServerId: input.mcpServerId,
	});
	const run = await startTaskRun(task.id, {
		executionMode: "implementation",
		executionModeSource: "explicit",
		routeOverride: input.routeOverride,
	});
	const refreshedTask = await nightworkersRepo.getTask(task.id);
	return {
		taskId: task.id,
		runId: run.id,
		worktreePath: refreshedTask?.worktreePath ?? null,
	};
}

async function waitForTerminalRun(runId: string, maxWaitSeconds: number) {
	const deadline = Date.now() + maxWaitSeconds * 1_000;
	let lastStatus = "";
	while (Date.now() < deadline) {
		const run = await nightworkersRepo.getTaskRun(runId);
		if (!run) throw new Error(`Pilot run disappeared: ${runId}`);
		if (run.status !== lastStatus) {
			lastStatus = run.status;
			progress({ event: "run.status", runId, status: run.status });
		}
		if (TERMINAL_RUN_STATUSES.has(run.status)) return run;
		await sleep(POLL_INTERVAL_MS);
	}
	const run = await nightworkersRepo.getTaskRun(runId);
	if (!run) throw new Error(`Pilot run disappeared: ${runId}`);
	progress({ event: "run.poll_timeout", runId, status: run.status });
	return run;
}

async function measureRun(
	run: NonNullable<Awaited<ReturnType<typeof nightworkersRepo.getTaskRun>>>,
) {
	const [events, usageRecords] = await Promise.all([
		listTaskEventsForRun(run.id),
		listLlmUsageRecordsForRun(run.id),
	]);
	return measureProjectExplorationRun({ run, events, usageRecords });
}

async function systemPromptFingerprintForRun(runId: string) {
	const fingerprints = new Set(
		(await listTaskEventsForRun(runId)).flatMap((event) => {
			const payload = recordValue(event.payloadJson);
			const runEvent = recordValue(payload?.runEvent);
			if (runEvent?.type !== "model_response_started") return [];
			const data = recordValue(runEvent.data);
			const value = data?.systemPromptSha256;
			return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
				? [`sha256:${value}`]
				: [];
		}),
	);
	if (fingerprints.size !== 1) {
		throw new Error(`Run ${runId} does not have one stable system prompt fingerprint.`);
	}
	return [...fingerprints][0] as string;
}
