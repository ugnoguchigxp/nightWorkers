import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
	"x-nightworkers-e2e": "1",
};

type ArchiveState = {
	taskStatus: string;
	phase: string;
	desiredState: string;
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	implementationRunCount: number;
	snapshotCount: number;
	reviewPassCount: number;
	closeoutCount: number;
	invalidationCount: number;
	archiveCount: number;
	forbiddenCount: number;
	evidenceRows: Array<{
		phaseRunId: string;
		id: string;
		command: string;
		exitCode: number;
	}>;
	snapshots: Array<{ evidenceRunIds: string[] }>;
};

test("Mission Pilot continues from a reviewed Queue handoff through true Task Archive", {
	tag: ["@deterministic", "@p0", "@scenario:NW-E2E-MISSION-PILOT-003"],
}, async ({ page, request }) => {
	test.setTimeout(90_000);
	const { workspace } = await createDisposableGitWorkspace({
		prefix: "mission-pilot-through-archive-",
	});
	const branch = execFileSync("git", ["branch", "--show-current"], {
		cwd: workspace,
		encoding: "utf8",
	}).trim();
	const hookPath = `${workspace}/.git/hooks/pre-commit`;
	await fs.writeFile(
		hookPath,
		[
			"#!/bin/sh",
			'if [ ! -f "$(git rev-parse --git-dir)/mission-pilot-hook-ran" ]; then',
			'  printf "Hook-reviewed content\\n" >> src/greeting.txt',
			"  git add -- src/greeting.txt",
			'  touch "$(git rev-parse --git-dir)/mission-pilot-hook-ran"',
			"fi",
		].join("\n"),
		"utf8",
	);
	await fs.chmod(hookPath, 0o755);
	const repositoryResponse = await request.post("/api/repositories", {
		headers,
		data: {
			name: "Mission Pilot through archive",
			localPath: workspace,
			branch,
			allowed: true,
		},
	});
	expect(repositoryResponse.status(), await repositoryResponse.text()).toBe(
		201,
	);
	const repositoryId = ((await repositoryResponse.json()) as { id: string }).id;
	let taskId = "";
	try {
		const taskResponse = await request.post("/api/tasks", {
			headers,
			data: {
				repositoryId,
				title: "Mission Pilot autonomous closeout",
				description: "[fixture:success] [fixture:test-transient-failure]",
				objective:
					"[fixture:success] [fixture:test-transient-failure] Implement and verify the greeting.",
				acceptanceCriteria: "The Mission Pilot task reaches archived.",
				timeoutSeconds: 60,
			},
		});
		expect(taskResponse.status(), await taskResponse.text()).toBe(201);
		taskId = ((await taskResponse.json()) as { id: string }).id;
		const prepared = await request.post("/api/e2e/fixtures/pre-queue-handoff", {
			headers,
			data: { taskId, repositoryId, includeChecklist: true },
		});
		expect(prepared.status(), await prepared.text()).toBe(201);
		const fixture = (await prepared.json()) as { sessionId: string };
		const reconcile = await request.post(
			`/api/mission-pilot/sessions/${fixture.sessionId}/reconcile`,
			{ headers },
		);
		expect(reconcile.status(), await reconcile.text()).toBe(200);

		let finalState: ArchiveState | null = null;
		await expect
			.poll(
				async () => {
					const response = await request.post(
						"/api/e2e/fixtures/pre-queue-state",
						{
							headers,
							data: { taskId },
						},
					);
					expect(response.status(), await response.text()).toBe(200);
					finalState = ((await response.json()) as { state: ArchiveState })
						.state;
					if (finalState.phase === "attention") {
						throw new Error(
							`${finalState.lastErrorCode}: ${finalState.lastErrorMessage}`,
						);
					}
					return finalState;
				},
				{ timeout: 60_000 },
			)
			.toMatchObject({
				taskStatus: "archived",
				phase: "archived",
				desiredState: "stopped",
				implementationRunCount: 2,
				snapshotCount: 2,
				reviewPassCount: 2,
				closeoutCount: 2,
				invalidationCount: 1,
				archiveCount: 1,
			});
		if (!finalState) throw new Error("Archive state was not observed.");

		const chatResponse = await request.get(
			`/api/tasks/${taskId}/activity-events?channel=chat`,
			{ headers },
		);
		expect(chatResponse.status(), await chatResponse.text()).toBe(200);
		const chat = (await chatResponse.json()) as {
			events: Array<{ traceOwner: string; traceChannel: string }>;
		};
		expect(
			chat.events.every(
				(event) =>
					event.traceOwner !== "mission_pilot" && event.traceChannel === "chat",
			),
		).toBe(true);
		const traceResponse = await request.get(
			`/api/mission-pilot/tasks/${taskId}/execution`,
			{ headers },
		);
		expect(traceResponse.status(), await traceResponse.text()).toBe(200);
		const trace = (await traceResponse.json()) as {
			activityEvents: Array<{ traceOwner: string; traceChannel: string }>;
			runEvents?: unknown[];
		};
		expect(trace.runEvents).toBeUndefined();
		expect(
			trace.activityEvents.every(
				(event) =>
					event.traceOwner === "mission_pilot" &&
					event.traceChannel === "pilot_thought",
			),
		).toBe(true);
		expect(finalState.forbiddenCount).toBe(0);
		const evidenceRows = finalState.evidenceRows;
		const snapshots = finalState.snapshots;
		const evidenceByPhaseRun = new Map<string, typeof evidenceRows>();
		for (const row of evidenceRows) {
			const rows = evidenceByPhaseRun.get(row.phaseRunId) ?? [];
			rows.push(row);
			evidenceByPhaseRun.set(row.phaseRunId, rows);
		}
		expect(evidenceByPhaseRun.size).toBe(2);
		const transientPhaseRuns = [];
		for (const rows of evidenceByPhaseRun.values()) {
			expect(rows.at(-1)?.exitCode).toBe(0);
			expect(new Set(rows.map((row) => row.command)).size).toBe(1);
			if (rows.some((row) => row.exitCode !== 0)) transientPhaseRuns.push(rows);
		}
		expect(transientPhaseRuns).toHaveLength(1);
		expect(transientPhaseRuns[0]).toHaveLength(2);
		const acceptedEvidenceIds = new Set(
			snapshots.flatMap((snapshot) => snapshot.evidenceRunIds),
		);
		expect(snapshots).toHaveLength(2);
		expect(acceptedEvidenceIds.size).toBe(2);
		expect(
			evidenceRows
				.filter((row) => acceptedEvidenceIds.has(row.id))
				.every((row) => row.exitCode === 0),
		).toBe(true);
		expect(
			evidenceRows
				.filter((row) => row.exitCode !== 0)
				.every((row) => !acceptedEvidenceIds.has(row.id)),
		).toBe(true);
		await page.goto(`/sessions/${taskId}`);
		await expect(
			page.getByText("Mission Pilot autonomous closeout"),
		).toBeVisible();
	} finally {
		await Promise.allSettled([
			taskId ? request.delete(`/api/tasks/${taskId}`, { headers }) : null,
			request.delete(`/api/repositories/${repositoryId}`, { headers }),
			fs.rm(workspace, { recursive: true, force: true }),
		]);
	}
});
