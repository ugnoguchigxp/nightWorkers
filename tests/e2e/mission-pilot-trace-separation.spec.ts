import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
};

test("Mission Pilot thought and coding-agent chat remain disjoint", {
	tag: [
		"@deterministic",
		"@p0",
		"@regression",
		"@scenario:NW-E2E-MISSION-PILOT-TRACE-001",
	],
}, async ({ page, request }) => {
	const databasePath = process.env.NIGHTWORKERS_E2E_DATABASE_PATH;
	if (!databasePath) throw new Error("Isolated E2E database path is required");
	const { workspace } = await createDisposableGitWorkspace({
		prefix: "mission-pilot-trace-separation-",
	});
	const branch = execFileSync("git", ["branch", "--show-current"], {
		cwd: workspace,
		encoding: "utf8",
	}).trim();
	const repositoryResponse = await request.post("/api/repositories", {
		headers,
		data: {
			name: "Mission Pilot trace separation",
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
				title: "Mission Pilot trace separation task",
				description: "Verify trace channel ownership",
				objective: "Keep Pilot thought and coding agent chat disjoint",
				acceptanceCriteria: "No event appears in both surfaces",
				timeoutSeconds: 60,
			},
		});
		expect(taskResponse.status(), await taskResponse.text()).toBe(201);
		taskId = ((await taskResponse.json()) as { id: string }).id;
		const db = new Database(databasePath);
		const session = db
			.prepare("select id from mission_pilot_sessions where task_id = ?")
			.get(taskId) as { id: string };
		const now = Math.floor(Date.now() / 1000);
		const insertActivity = db.prepare(
			"insert into activity_events (id, task_id, run_id, turn_id, parent_event_id, seq, run_seq, kind, source, status, text, payload_json, artifact_id, client_temp_id, external_id, dedupe_key, ingest_error, visibility, trace_owner, trace_channel, created_at) values (?, ?, null, ?, null, ?, null, ?, ?, 'completed', ?, ?, null, null, null, ?, null, 'visible', ?, ?, ?)",
		);
		insertActivity.run(
			randomUUID(),
			taskId,
			"pilot-turn",
			1,
			"runtime.decision",
			"mission_pilot",
			"MISSION_PILOT_THOUGHT_ONLY",
			JSON.stringify({ missionPilotSessionId: session.id }),
			`e2e:pilot:${taskId}`,
			"mission_pilot",
			"pilot_thought",
			now,
		);
		insertActivity.run(
			randomUUID(),
			taskId,
			"coding-turn",
			2,
			"assistant.message",
			"worker",
			"CODING_AGENT_CHAT_ONLY",
			JSON.stringify({}),
			`e2e:coding:${taskId}`,
			"coding_agent",
			"chat",
			now + 1,
		);
		db.prepare(
			"insert into task_messages (id, task_id, run_id, role, content, message_type, metadata_json, trace_owner, trace_channel, created_at) values (?, ?, null, 'assistant', 'MISSION_PILOT_ARTIFACT_BODY', 'markdown_document', ?, 'mission_pilot', 'artifact', ?)",
		).run(
			randomUUID(),
			taskId,
			JSON.stringify({ intent: "feature_plan" }),
			now,
		);
		db.close();

		const chatResponse = await request.get(
			`/api/tasks/${taskId}/activity-events?channel=chat`,
			{ headers },
		);
		expect(chatResponse.status(), await chatResponse.text()).toBe(200);
		const chat = (await chatResponse.json()) as {
			events: Array<{
				id: string;
				text: string;
				traceOwner: string;
				traceChannel: string;
			}>;
		};
		expect(chat.events.map((event) => event.text)).toContain(
			"CODING_AGENT_CHAT_ONLY",
		);
		expect(chat.events.every((event) => event.traceChannel === "chat")).toBe(
			true,
		);
		expect(
			chat.events.some((event) => event.traceOwner === "mission_pilot"),
		).toBe(false);

		const traceResponse = await request.get(
			`/api/mission-pilot/tasks/${taskId}/execution`,
			{ headers },
		);
		expect(traceResponse.status(), await traceResponse.text()).toBe(200);
		const trace = (await traceResponse.json()) as {
			activityEvents: Array<{
				id: string;
				text: string;
				traceOwner: string;
				traceChannel: string;
			}>;
		};
		expect(trace.activityEvents.map((event) => event.text)).toEqual([
			"MISSION_PILOT_THOUGHT_ONLY",
		]);
		expect(
			trace.activityEvents.every(
				(event) =>
					event.traceOwner === "mission_pilot" &&
					event.traceChannel === "pilot_thought",
			),
		).toBe(true);
		expect(
			chat.events.some((chatEvent) =>
				trace.activityEvents.some(
					(pilotEvent) => pilotEvent.id === chatEvent.id,
				),
			),
		).toBe(false);

		await page.goto(`/sessions/${taskId}`);
		const chatWindow = page.locator(".nightworkers-chat-window");
		await expect(chatWindow.getByText("CODING_AGENT_CHAT_ONLY")).toBeVisible();
		await expect(
			chatWindow.getByText("MISSION_PILOT_THOUGHT_ONLY"),
		).toHaveCount(0);
		await expect(
			chatWindow.getByText("MISSION_PILOT_ARTIFACT_BODY"),
		).toHaveCount(0);
		await page.getByRole("button", { name: "Pilot thought" }).click();
		const pilotDock = page.locator("aside.nightworkers-chat-dock");
		await expect(
			pilotDock.getByText("MISSION_PILOT_THOUGHT_ONLY"),
		).toBeVisible();
		await expect(pilotDock.getByText("CODING_AGENT_CHAT_ONLY")).toHaveCount(0);
	} finally {
		await Promise.allSettled([
			taskId ? request.delete(`/api/tasks/${taskId}`, { headers }) : null,
			request.delete(`/api/repositories/${repositoryId}`, { headers }),
			fs.rm(workspace, { recursive: true, force: true }),
		]);
	}
});
