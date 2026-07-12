import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
};

test("real Play persists an immutable reviewed handoff before post-Queue progression", {
	tag: ["@deterministic", "@p0", "@scenario:NW-E2E-MISSION-PILOT-002"],
}, async ({ page, request }) => {
	const databasePath = process.env.NIGHTWORKERS_E2E_DATABASE_PATH;
	const settingsPath = process.env.NIGHTWORKERS_GENERAL_SETTINGS_PATH;
	if (!databasePath || !settingsPath) {
		throw new Error("Isolated E2E database and settings paths are required");
	}
	const previousSettings = await fs
		.readFile(settingsPath, "utf8")
		.catch(() => null);
	await fs.writeFile(
		settingsPath,
		JSON.stringify({
			planMode: {
				capabilities: {
					feature_plan: true,
					questionnaire: true,
					user_flow: false,
					blueprint: false,
					data_model: false,
					api_io_contract: false,
					activity_flow: false,
					sequence_flow: false,
					zod_schema_design: false,
				},
			},
		}),
	);
	const { workspace } = await createDisposableGitWorkspace({
		prefix: "mission-pilot-handoff-",
	});
	const repositoryResponse = await request.post("/api/repositories", {
		headers,
		data: {
			name: "Mission Pilot pre-Queue handoff",
			localPath: workspace,
			branch: "main",
			allowed: true,
		},
	});
	expect(repositoryResponse.status(), await repositoryResponse.text()).toBe(
		201,
	);
	const repositoryId = ((await repositoryResponse.json()) as { id: string }).id;
	try {
		const goalResponse = await request.post(
			`/api/repositories/${repositoryId}/mission-goals`,
			{
				headers,
				data: {
					title: "Mission Pilot handoff goal",
					goalText: "Queue a reviewed Mission Pilot plan exactly once",
					active: true,
				},
			},
		);
		expect(goalResponse.status(), await goalResponse.text()).toBe(201);
		const goalId = ((await goalResponse.json()) as { id: string }).id;
		const candidateId = randomUUID();
		const batchId = randomUUID();
		const now = Math.floor(Date.now() / 1000);
		const db = new Database(databasePath);
		db.prepare(
			"insert into mission_task_candidate_batches (id, created_at, updated_at, repository_id, status, requested_goal_ids_json, signal_snapshot_json, started_at, completed_at) values (?, ?, ?, ?, 'completed', ?, '{}', ?, ?)",
		).run(batchId, now, now, repositoryId, JSON.stringify([goalId]), now, now);
		db.prepare(
			"insert into mission_task_candidates (id, created_at, updated_at, batch_id, repository_id, goal_id, candidate_kind, secondary_modules_json, routing_confidence_percent, constraint_goal_ids_json, plan_mode_open_questions_json, title, summary, rationale, evidence_json, importance_percent, confidence_percent, token_size, complexity, task_prompt, acceptance_criteria, verification_plan, status) values (?, ?, ?, ?, ?, ?, 'feature_followup', '[]', 100, '[]', '[]', ?, ?, ?, '[]', 90, 95, 'small', 'simple', ?, ?, ?, 'candidate')",
		).run(
			candidateId,
			now,
			now,
			batchId,
			repositoryId,
			goalId,
			"Mission Pilot reviewed handoff",
			"Queue the reviewed plan without running implementation",
			"The pre-Queue contract must be deterministic",
			"Prepare the reviewed plan and hand it to the Queue",
			"Exactly one unclaimed Queue entry exists and no TaskRun exists",
			"Inspect Session, Context, Queue, and TaskRun rows",
		);
		db.close();

		const createResponse = await request.post(
			`/api/repositories/${repositoryId}/mission-task-candidates/create-tasks`,
			{
				headers,
				data: { candidateIds: [candidateId], mode: "draft" },
			},
		);
		expect(createResponse.status(), await createResponse.text()).toBe(201);
		const created = (await createResponse.json()) as {
			tasks: Array<{ id: string; missionPilot: { version: number } }>;
		};
		const taskId = created.tasks[0].id;
		const fixtureDb = new Database(databasePath);
		const session = fixtureDb
			.prepare(
				"select id, context_revision as contextRevision from mission_pilot_sessions where task_id = ?",
			)
			.get(taskId) as { id: string; contextRevision: number };
		const contextRow = fixtureDb
			.prepare(
				"select id, context_json as contextJson from mission_pilot_context_snapshots where session_id = ? and revision = ?",
			)
			.get(session.id, session.contextRevision) as {
			id: string;
			contextJson: string;
		};
		const questionnaireId = randomUUID();
		const featurePlanMessageId = randomUUID();
		const verificationDocumentId = randomUUID();
		const planReviewId = randomUUID();
		fixtureDb
			.prepare(
				"insert into design_questionnaire_sessions (id, created_at, updated_at, task_id, repository_id, source_blueprint_message_id, status) values (?, ?, ?, ?, ?, null, 'accepted')",
			)
			.run(questionnaireId, now, now, taskId, repositoryId);
		fixtureDb
			.prepare(
				"insert into task_messages (id, task_id, run_id, role, content, message_type, metadata_json, created_at) values (?, ?, null, 'assistant', ?, 'markdown_document', ?, ?)",
			)
			.run(
				featurePlanMessageId,
				taskId,
				"# Feature Plan\n\n## Verification\n- Assert the immutable Queue handoff",
				JSON.stringify({ intent: "feature_plan", title: "Feature Plan" }),
				now,
			);
		const questionnaireDigest = createHash("sha256")
			.update(
				JSON.stringify({ status: "accepted", answers: [], questionSets: [] }),
			)
			.digest("hex");
		const context = JSON.parse(contextRow.contextJson) as Record<
			string,
			unknown
		>;
		context.plan = {
			questionnaire: {
				sessionId: questionnaireId,
				status: "accepted",
				answers: [],
				questionSets: [],
				questionnaireDigest,
			},
			artifacts: [
				{
					stepKey: "feature_plan",
					sourceMessageId: featurePlanMessageId,
					digest: createHash("sha256").update("# Feature Plan").digest("hex"),
				},
			],
		};
		const serializedContext = JSON.stringify(context);
		const contextDigest = createHash("sha256")
			.update(serializedContext)
			.digest("hex");
		const activationContextRevision = session.contextRevision + 1;
		fixtureDb
			.prepare(
				"update mission_pilot_context_snapshots set context_json = ?, digest = ? where id = ?",
			)
			.run(serializedContext, contextDigest, contextRow.id);
		fixtureDb
			.prepare(
				"update mission_pilot_sessions set context_digest = ?, updated_at = ? where id = ?",
			)
			.run(contextDigest, now, session.id);
		const insertStep = fixtureDb.prepare(
			"insert into mission_pilot_steps (id, session_id, step_key, ordinal, status, attempt, context_revision, context_digest, artifact_message_id, evidence_json, started_at, finished_at, created_at, updated_at) values (?, ?, ?, ?, 'completed', 1, ?, ?, ?, ?, ?, ?, ?, ?)",
		);
		insertStep.run(
			randomUUID(),
			session.id,
			"questionnaire",
			1,
			activationContextRevision,
			contextDigest,
			null,
			JSON.stringify({ kind: "questionnaire", required: true, enabled: true }),
			now,
			now,
			now,
			now,
		);
		insertStep.run(
			randomUUID(),
			session.id,
			"feature_plan",
			2,
			activationContextRevision,
			contextDigest,
			featurePlanMessageId,
			JSON.stringify({
				kind: "feature_plan",
				required: true,
				enabled: true,
				sourceMessageId: featurePlanMessageId,
				preFeaturePlanQuestionnaireStatus: "completed",
			}),
			now,
			now,
			now,
			now,
		);
		const reviewJson = {
			verdict: "pass",
			summary: "Ready for implementation",
			coverage: {
				goal: "pass",
				scope: "pass",
				acceptanceCriteria: "pass",
				implementationSteps: "pass",
				verification: "pass",
				artifactConsistency: "pass",
				riskAndSafety: "pass",
			},
			findings: [],
			revisionTargets: [],
		};
		fixtureDb
			.prepare(
				"insert into mission_pilot_plan_reviews (id, session_id, context_revision, context_digest, feature_plan_message_id, attempt, verdict, review_json, created_at) values (?, ?, ?, ?, ?, 1, 'pass', ?, ?)",
			)
			.run(
				planReviewId,
				session.id,
				activationContextRevision,
				contextDigest,
				featurePlanMessageId,
				JSON.stringify(reviewJson),
				now,
			);
		fixtureDb
			.prepare(
				"insert into verification_documents (id, created_at, updated_at, task_id, run_id, spec_message_id, source_spec_path, schema_version, status, document_json, generated_at) values (?, ?, ?, ?, null, ?, 'task-message', 1, 'active', '{}', ?)",
			)
			.run(verificationDocumentId, now, now, taskId, featurePlanMessageId, now);
		fixtureDb.close();

		const playResponse = await request.post(
			`/api/mission-pilot/tasks/${taskId}/play`,
			{
				headers,
				data: { expectedVersion: created.tasks[0].missionPilot.version },
			},
		);
		expect(playResponse.status(), await playResponse.text()).toBe(200);
		await expect
			.poll(
				() => {
					const stateDb = new Database(databasePath, { readonly: true });
					try {
						return stateDb
							.prepare(
								"select queue_handoff_json as queueHandoffJson from mission_pilot_sessions where task_id = ?",
							)
							.get(taskId) as { queueHandoffJson: string | null };
					} finally {
						stateDb.close();
					}
				},
				{ timeout: 15_000 },
			)
			.toMatchObject({ queueHandoffJson: expect.any(String) });
		const resultDb = new Database(databasePath, { readonly: true });
		const result = resultDb
			.prepare(
				"select s.phase, s.context_revision as contextRevision, s.context_digest as contextDigest, s.queue_handoff_json as queueHandoffJson, t.status as taskStatus, (select count(*) from implementation_queue_entries q where q.task_id = t.id) as queueCount, (select count(*) from task_runs r where r.task_id = t.id) as runCount, (select count(*) from implementation_queue_entries q where q.task_id = t.id and q.status = 'queued' and q.active_run_id is null) as unclaimedQueueCount from mission_pilot_sessions s join tasks t on t.id = s.task_id where s.task_id = ?",
			)
			.get(taskId) as {
			phase: string;
			contextRevision: number;
			contextDigest: string;
			queueHandoffJson: string;
			taskStatus: string;
			queueCount: number;
			runCount: number;
			unclaimedQueueCount: number;
		};
		resultDb.close();
		expect(result).toMatchObject({
			contextRevision: activationContextRevision,
			contextDigest,
			queueCount: 1,
		});
		const handoff = JSON.parse(result.queueHandoffJson) as {
			reviewedContextDigest: string;
			planReviewId: string;
			verificationDocumentId: string;
		};
		expect(handoff).toMatchObject({
			reviewedContextDigest: contextDigest,
			planReviewId,
			verificationDocumentId,
			queueClaimReady: false,
		});

		const diagnosticRunId = randomUUID();
		const diagnosticDb = new Database(databasePath);
		diagnosticDb
			.prepare(
				"update mission_pilot_sessions set desired_state = 'stopped', phase = 'attention', last_error_code = ?, last_error_message = ?, pre_queue_diagnostic_json = ?, version = version + 1, updated_at = ? where task_id = ?",
			)
			.run(
				"MISSION_PILOT_PRE_QUEUE_UNEXPECTED_RUN",
				"Unexpected pre-Queue run detected",
				JSON.stringify({
					code: "MISSION_PILOT_PRE_QUEUE_UNEXPECTED_RUN",
					detectedAt: new Date().toISOString(),
					taskStatus: "queued",
					sessionPhase: "queueing",
					queueEntryIds: [JSON.parse(result.queueHandoffJson).queueEntryId],
					runIds: [diagnosticRunId],
					runSourceRefs: [
						{
							runId: diagnosticRunId,
							executionMode: "implementation",
							executionModeSource: "workbench_intake",
						},
					],
					commitRecordIds: [],
					diffEventIds: [],
					contextRevision: activationContextRevision,
					contextDigest,
					reviewedContextRevision: activationContextRevision,
					reviewedContextDigest: contextDigest,
				}),
				now,
				taskId,
			);
		diagnosticDb.close();
		await page.goto(`/sessions/${taskId}`);
		await page.getByRole("button", { name: "Pilot thought" }).click();
		const diagnostic = page
			.locator(".nightworkers-pilot-thought-event")
			.filter({ hasText: "MISSION_PILOT_PRE_QUEUE_UNEXPECTED_RUN" });
		await expect(
			diagnostic.getByText(/Mission Pilotを停止しました/),
		).toBeVisible();
		await diagnostic.locator("summary").click();
		await expect(diagnostic.getByText(diagnosticRunId)).toBeVisible();
	} finally {
		await Promise.allSettled([
			request.delete(`/api/repositories/${repositoryId}`, { headers }),
			fs.rm(workspace, { recursive: true, force: true }),
			previousSettings === null
				? fs.rm(settingsPath, { force: true })
				: fs.writeFile(settingsPath, previousSettings),
		]);
	}
});
