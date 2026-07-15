import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotPhaseRuns,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import {
	implementationQueueEntries,
	repositories,
	taskRuns,
	tasks,
} from "../../db/schema";
import { runGitCommand } from "../gitworktree/gitworktree-cli";
import {
	ensureTaskGitWorkspace,
	provisionTaskGitWorkspace,
} from "../gitworktree/task-git-workspace.service";
import { startTaskRun } from "../nightworkers/run-orchestration/start-task-run";
import { appendMissionPilotEvent } from "./mission-pilot-event.repository";

export async function repositoryHasGitHead(repositoryPath: string) {
	try {
		await runGitCommand([
			"-C",
			repositoryPath,
			"rev-parse",
			"--verify",
			"HEAD^{commit}",
		]);
		return true;
	} catch {
		return false;
	}
}

export async function alignBootstrappedRepositoryBranch(input: {
	repositoryPath: string;
	targetBranch: string;
}) {
	try {
		await runGitCommand([
			"-C",
			input.repositoryPath,
			"rev-parse",
			"--verify",
			`${input.targetBranch}^{commit}`,
		]);
		return;
	} catch {
		const current = (
			await runGitCommand([
				"-C",
				input.repositoryPath,
				"branch",
				"--show-current",
			])
		).stdout.trim();
		if (!current) throw new Error("Bootstrapped repository branch is missing");
		await runGitCommand([
			"-C",
			input.repositoryPath,
			"branch",
			"-M",
			input.targetBranch,
		]);
	}
}

export async function startMissionPilotRepositoryBootstrap(input: {
	taskId: string;
	sessionId: string;
}) {
	const [session] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, input.sessionId))
		.limit(1);
	if (
		!session ||
		session.taskId !== input.taskId ||
		session.desiredState !== "playing" ||
		!session.queueHandoffJson
	) {
		throw new Error("Mission Pilot repository bootstrap admission is invalid");
	}
	const [active] = await db
		.select()
		.from(missionPilotPhaseRuns)
		.where(
			and(
				eq(missionPilotPhaseRuns.sessionId, session.id),
				eq(missionPilotPhaseRuns.phase, "repository_bootstrap"),
				eq(missionPilotPhaseRuns.status, "running"),
			),
		)
		.limit(1);
	if (active) {
		const activeRun = await db.query.taskRuns.findFirst({
			where: eq(taskRuns.id, active.runId),
		});
		if (
			activeRun &&
			[
				"running",
				"context_compiling",
				"compiling_context",
				"finalizing",
			].includes(activeRun.status)
		) {
			return activeRun;
		}
		await db
			.update(missionPilotPhaseRuns)
			.set({ status: "failed", finishedAt: new Date() })
			.where(eq(missionPilotPhaseRuns.id, active.id));
	}
	const preparingSession = await claimMissionPilotRepositoryBootstrapStart({
		taskId: input.taskId,
		sessionId: input.sessionId,
		contextRevision: session.contextRevision,
		contextDigest: session.contextDigest,
		implementationCycle: session.implementationCycle,
	});
	if (!preparingSession) {
		throw new Error(
			"Mission Pilot repository bootstrap preparation could not be claimed",
		);
	}
	return startTaskRun(input.taskId, {
		executionMode: "implementation",
		executionModeSource: "explicit",
		missionPilotPhase: "repository_bootstrap",
		initialTodos: [
			{
				title: "Repositoryをbootstrapする",
				description:
					"登録済みProject rootでpwdとls相当を実行し、空または未materializedならnightworkers.import_projectでstarterを取り込み、Git HEADとbaseline commitを確認する。通常機能の実装は行わない。",
				taskType: "scaffold",
				procedureId: "repository_bootstrap",
			},
		],
		runtimeOptionsPatch: {
			missionPilot: {
				sessionId: preparingSession.id,
				cycle: preparingSession.implementationCycle,
				contextRevision: preparingSession.contextRevision,
				contextDigest: preparingSession.contextDigest,
			},
			repositoryBootstrap: {
				targetPathSource: "registered_project_root",
				queueEntryId: preparingSession.queueHandoffJson?.queueEntryId,
			},
		},
	}).catch(async (error) => {
		await db.transaction(async (tx) => {
			await tx
				.update(tasks)
				.set({ status: "queued", updatedAt: new Date() })
				.where(eq(tasks.id, input.taskId));
			await tx
				.update(missionPilotSessions)
				.set({ phase: "queued", updatedAt: new Date() })
				.where(
					and(
						eq(missionPilotSessions.id, input.sessionId),
						eq(missionPilotSessions.phase, "repository_bootstrap_preparing"),
						isNull(missionPilotSessions.activeRunId),
						isNull(missionPilotSessions.activePhaseRunId),
					),
				);
		});
		throw error;
	});
}

export async function claimMissionPilotRepositoryBootstrapStart(input: {
	taskId: string;
	sessionId: string;
	contextRevision: number;
	contextDigest: string;
	implementationCycle: number;
}) {
	const [preparing] = await db
		.update(missionPilotSessions)
		.set({ phase: "repository_bootstrap_preparing", updatedAt: new Date() })
		.where(
			and(
				eq(missionPilotSessions.id, input.sessionId),
				eq(missionPilotSessions.taskId, input.taskId),
				eq(missionPilotSessions.desiredState, "playing"),
				eq(missionPilotSessions.phase, "queued"),
				eq(missionPilotSessions.contextRevision, input.contextRevision),
				eq(missionPilotSessions.contextDigest, input.contextDigest),
				eq(missionPilotSessions.implementationCycle, input.implementationCycle),
				isNull(missionPilotSessions.activeRunId),
				isNull(missionPilotSessions.activePhaseRunId),
			),
		)
		.returning();
	return preparing ?? null;
}

export async function completeMissionPilotRepositoryBootstrap(input: {
	phaseRun: typeof missionPilotPhaseRuns.$inferSelect;
	session: typeof missionPilotSessions.$inferSelect;
	runId: string;
}) {
	const [run, task] = await Promise.all([
		db.query.taskRuns.findFirst({ where: eq(taskRuns.id, input.runId) }),
		db.query.tasks.findFirst({ where: eq(tasks.id, input.session.taskId) }),
	]);
	if (!run || !["completed", "needs_review"].includes(run.status)) {
		throw new Error("Repository bootstrap run did not complete successfully");
	}
	if (!task) throw new Error("Repository bootstrap Task is missing");
	const repository = await db.query.repositories.findFirst({
		where: eq(repositories.id, task.repositoryId),
	});
	if (!repository) throw new Error("Repository bootstrap Project is missing");
	await alignBootstrappedRepositoryBranch({
		repositoryPath: repository.localPath,
		targetBranch: repository.branch,
	});
	const head = (
		await runGitCommand([
			"-C",
			repository.localPath,
			"rev-parse",
			"--verify",
			"HEAD^{commit}",
		])
	).stdout.trim();
	if (!head) throw new Error("Repository bootstrap did not create a Git HEAD");
	const handoff = input.session.queueHandoffJson;
	if (!handoff)
		throw new Error("Repository bootstrap Queue handoff is missing");
	const workspace = await ensureTaskGitWorkspace({
		taskId: task.id,
		planReviewId: handoff.planReviewId,
		admissionKey: handoff.admissionKey,
		materializationIntent: { kind: "existing_git" },
	});
	const ready = await provisionTaskGitWorkspace(task.id);
	if (!["ready", "active"].includes(ready.status)) {
		throw new Error("Repository bootstrap Workspace is not ready");
	}
	const now = new Date();
	await db.transaction(async (tx) => {
		await tx
			.update(implementationQueueEntries)
			.set({
				workspaceId: workspace.id,
				workspaceRequired: true,
				claimReady: false,
				updatedAt: now,
			})
			.where(eq(implementationQueueEntries.id, handoff.queueEntryId));
		await tx
			.update(missionPilotPhaseRuns)
			.set({
				status: "completed",
				verdict: "pass",
				evidenceJson: { repositoryHead: head, workspaceId: ready.id },
				finishedAt: now,
			})
			.where(eq(missionPilotPhaseRuns.id, input.phaseRun.id));
		await tx
			.update(missionPilotSessions)
			.set({
				phase: "queued",
				activeRunId: null,
				activePhaseRunId: null,
				lastErrorCode: null,
				lastErrorMessage: null,
				preQueueDiagnosticJson: null,
				updatedAt: now,
			})
			.where(eq(missionPilotSessions.id, input.session.id));
		await tx
			.update(tasks)
			.set({ status: "queued", updatedAt: now })
			.where(eq(tasks.id, task.id));
	});
	await appendMissionPilotEvent({
		sessionId: input.session.id,
		taskId: task.id,
		eventType: "repository.bootstrap_completed",
		phase: "queued",
		cycle: input.phaseRun.cycle,
		contextRevision: input.session.contextRevision,
		contextDigest: input.session.contextDigest,
		dedupeKey: `repository-bootstrap:${input.runId}:completed`,
		sourceKind: "task_run",
		sourceId: input.runId,
		payload: { repositoryHead: head, workspaceId: ready.id },
	});
	const { releaseMissionPilotQueueHandoff } = await import(
		"./mission-pilot-post-queue-coordinator.service"
	);
	await releaseMissionPilotQueueHandoff(task.id);
	return { kind: "repository_bootstrap_completed" } as const;
}
