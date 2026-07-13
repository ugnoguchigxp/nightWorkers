import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
};

test("Mission Pilot continues from a reviewed Queue handoff through true Task Archive", {
	tag: ["@deterministic", "@p0", "@scenario:NW-E2E-MISSION-PILOT-003"],
}, async ({ page, request }) => {
	test.setTimeout(90_000);
	const databasePath = process.env.NIGHTWORKERS_E2E_DATABASE_PATH;
	if (!databasePath) throw new Error("Isolated E2E database path is required");
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
				description: "[fixture:success]",
				objective: "[fixture:success] Implement and verify the greeting.",
				acceptanceCriteria: "The Mission Pilot task reaches archived.",
				timeoutSeconds: 60,
			},
		});
		expect(taskResponse.status(), await taskResponse.text()).toBe(201);
		taskId = ((await taskResponse.json()) as { id: string }).id;

		const db = new Database(databasePath);
		const session = db
			.prepare(
				"select id, context_revision as contextRevision, context_digest as contextDigest from mission_pilot_sessions where task_id = ?",
			)
			.get(taskId) as {
			id: string;
			contextRevision: number;
			contextDigest: string;
		};
		const now = Math.floor(Date.now() / 1000);
		const queueEntryId = randomUUID();
		const featurePlanMessageId = randomUUID();
		const verificationDocumentId = randomUUID();
		const planReviewId = randomUUID();
		const admissionKey = `mission-pilot:${session.id}:${session.contextDigest}:${planReviewId}`;
		db.prepare(
			"insert into task_messages (id, task_id, run_id, role, content, message_type, metadata_json, trace_owner, trace_channel, created_at) values (?, ?, null, 'assistant', ?, 'markdown_document', ?, 'mission_pilot', 'artifact', ?)",
		).run(
			featurePlanMessageId,
			taskId,
			"# Feature Plan\n\nImplement the greeting and verify it.",
			JSON.stringify({ intent: "feature_plan", title: "Feature Plan" }),
			now,
		);
		db.prepare(
			"insert into verification_documents (id, created_at, updated_at, task_id, run_id, spec_message_id, source_spec_path, schema_version, status, document_json, generated_at) values (?, ?, ?, ?, null, ?, 'task-message', 1, 'active', ?, ?)",
		).run(
			verificationDocumentId,
			now,
			now,
			taskId,
			featurePlanMessageId,
			JSON.stringify({ version: 1, completionConditions: [] }),
			now,
		);
		db.prepare(
			"insert into verification_checklist_items (id, created_at, updated_at, verification_document_id, task_id, condition_id, text, required, status, evidence_ids_json) values (?, ?, ?, ?, ?, 'mission-pilot-archive', 'Mission reaches true Archive', 1, 'pending', '[]')",
		).run(randomUUID(), now, now, verificationDocumentId, taskId);
		db.prepare(
			"insert into implementation_queue_entries (id, created_at, updated_at, task_id, repository_id, status, priority, lease_version, attempt_count, execution_type, mission_pilot_admission_key, claim_ready) values (?, ?, ?, ?, ?, 'queued', 0, 0, 0, 'normal', ?, 0)",
		).run(queueEntryId, now, now, taskId, repositoryId, admissionKey);
		const authorization = {
			version: 3,
			sessionId: session.id,
			taskId,
			taskRef: { source: "task", id: taskId },
			activationContextRevision: session.contextRevision,
			activationContextDigest: session.contextDigest,
			grantedByAction: "mission_pilot_play",
			grantedAt: new Date().toISOString(),
			scopes: {
				plan: true,
				queue: true,
				implementation: true,
				testMutation: true,
				review: true,
				localCommit: true,
				taskComplete: true,
				taskArchive: true,
				push: false,
			},
			pushPolicy: "never",
		};
		const handoff = {
			sessionId: session.id,
			taskId,
			admissionKey,
			queueEntryId,
			queueEntryStatus: "queued",
			queueClaimReady: false,
			reviewedContextRevision: session.contextRevision,
			reviewedContextDigest: session.contextDigest,
			featurePlanMessageId,
			verificationDocumentId,
			planReviewId,
			planReviewVerdict: "pass",
			queuedAt: new Date().toISOString(),
		};
		db.prepare(
			"update mission_pilot_sessions set desired_state = 'playing', phase = 'queued', authorization_version = 3, authorization_json = ?, queue_handoff_json = ?, updated_at = ? where id = ?",
		).run(
			JSON.stringify(authorization),
			JSON.stringify(handoff),
			now,
			session.id,
		);
		db.prepare(
			"update tasks set status = 'queued', updated_at = ? where id = ?",
		).run(now, taskId);
		db.close();

		const reconcile = await request.post(
			`/api/mission-pilot/sessions/${session.id}/reconcile`,
			{ headers },
		);
		expect(reconcile.status(), await reconcile.text()).toBe(200);
		await expect
			.poll(
				() => {
					const stateDb = new Database(databasePath, { readonly: true });
					try {
						const state = stateDb
							.prepare(
								"select t.status as taskStatus, s.phase, s.desired_state as desiredState, s.last_error_code as lastErrorCode, s.last_error_message as lastErrorMessage, (select final_report from task_runs r where r.task_id = t.id order by r.created_at desc limit 1) as latestFinalReport, (select context_snapshot from task_runs r where r.task_id = t.id order by r.created_at desc limit 1) as latestContextSnapshot, (select context_json from mission_pilot_context_snapshots c where c.session_id = s.id order by c.revision desc limit 1) as finalContextJson, (select count(*) from mission_pilot_phase_runs p where p.session_id = s.id and p.phase = 'implementation') as implementationRunCount, (select count(*) from mission_pilot_test_snapshots x where x.session_id = s.id) as snapshotCount, (select count(*) from mission_pilot_review_decisions d where d.session_id = s.id and d.verdict = 'pass') as reviewPassCount, (select count(*) from mission_pilot_closeouts c where c.session_id = s.id) as closeoutCount, (select count(*) from mission_pilot_events e where e.session_id = s.id and e.event_type = 'mission_pilot.evidence_invalidated') as invalidationCount, (select count(*) from task_archive_records a where a.task_id = t.id and a.restored_at is null) as archiveCount from mission_pilot_sessions s join tasks t on t.id = s.task_id where s.id = ?",
							)
							.get(session.id) as {
							phase: string;
							lastErrorCode: string | null;
							lastErrorMessage: string | null;
							latestFinalReport: string | null;
							latestContextSnapshot: string | null;
							finalContextJson: string | null;
						};
						if (state.phase === "attention") {
							throw new Error(
								`${state.lastErrorCode}: ${state.lastErrorMessage}\n${state.latestFinalReport}\n${state.latestContextSnapshot}`,
							);
						}
						const finalContext = JSON.parse(state.finalContextJson ?? "{}") as {
							execution?: Record<string, unknown>;
						};
						return {
							...state,
							finalContextSections: Object.keys(
								finalContext.execution ?? {},
							).sort(),
						};
					} finally {
						stateDb.close();
					}
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
				finalContextSections: [
					"closeout",
					"implementation",
					"invalidatedEvidence",
					"lifecycle",
					"review",
					"test",
				],
			});
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
		const traceDb = new Database(databasePath, { readonly: true });
		const forbidden = traceDb
			.prepare(
				"select count(*) as count from activity_events a join mission_pilot_phase_runs p on p.run_id = a.run_id where p.session_id = ? and (a.trace_owner <> 'coding_agent' or a.trace_channel <> 'chat')",
			)
			.get(session.id) as { count: number };
		traceDb.close();
		expect(forbidden.count).toBe(0);
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
