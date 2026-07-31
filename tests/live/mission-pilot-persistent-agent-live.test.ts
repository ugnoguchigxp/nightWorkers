import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../../api/app";
import { ensureNightWorkersSchema } from "../../api/db/bootstrap";
import { db } from "../../api/db/client";
import { repositories, taskRuns, tasks } from "../../api/db/schema";
import {
	missionPilotActionExecutions,
	missionPilotAgentSessions,
	missionPilotConversationItems,
	missionPilotSessions,
	missionPilotTaskEventInbox,
	missionPilotToolCalls,
} from "../../api/modules/missionPilot/persistence";
import { createTask } from "../../api/modules/nightworkers/nightworkers.basic.service";
import { appendTaskMessage } from "../../api/modules/nightworkers/nightworkers.workbench-message.service";

const liveEnabled = process.env.NIGHTWORKERS_LIVE_MISSION_PILOT === "1";
const repositoryIds: string[] = [];

beforeAll(async () => {
	if (process.env.NIGHTWORKERS_LIVE_MISSION_PILOT_PROVIDER === "codex") {
		process.env.ACTIVE_LLM_PROVIDER = "codex";
		process.env.CODEX_ENABLED = "true";
		process.env.CODEX_MODEL =
			process.env.NIGHTWORKERS_LIVE_MISSION_PILOT_MODEL || "gpt-5.6-sol";
	}
	await ensureNightWorkersSchema();
});
afterAll(async () => {
	for (const repositoryId of repositoryIds)
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
});

describe.skipIf(!liveEnabled)("Mission Pilot persistent agent live", () => {
	it("uses public Play, a real provider, Task Operator receipts, and re-evaluates a permission failure", async () => {
		const configuredRepositoryPath =
			process.env.NIGHTWORKERS_LIVE_MISSION_PILOT_REPOSITORY_PATH?.trim();
		if (!configuredRepositoryPath)
			throw new Error(
				"NIGHTWORKERS_LIVE_MISSION_PILOT_REPOSITORY_PATH must identify a registered real canary repository.",
			);
		const repositoryRoot = await realpath(configuredRepositoryPath);
		const temporaryRoot = await realpath(os.tmpdir());
		const temporaryRelative = path.relative(temporaryRoot, repositoryRoot);
		if (
			temporaryRelative === "" ||
			(!temporaryRelative.startsWith("..") &&
				!path.isAbsolute(temporaryRelative))
		)
			throw new Error(
				"Mission Pilot live canary repository must not be a temporary directory.",
			);
		const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd: repositoryRoot,
			encoding: "utf8",
		}).trim();
		if ((await realpath(gitRoot)) !== repositoryRoot)
			throw new Error(
				"NIGHTWORKERS_LIVE_MISSION_PILOT_REPOSITORY_PATH must be the repository root.",
			);
		const branch = execFileSync("git", ["branch", "--show-current"], {
			cwd: repositoryRoot,
			encoding: "utf8",
		}).trim();
		const repositoryId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		await db.insert(repositories).values({
			id: repositoryId,
			name: "Mission Pilot live",
			localPath: repositoryRoot,
			branch,
			allowed: true,
		});
		const task = await createTask({
			repositoryId,
			title: "Mission Pilot persistent runtime live verification",
			objective:
				"Task Operator viewを読み、task.message.sendで「persistent runtime live path confirmed」と一度だけ送信し、その結果を再評価してagent.wait_for_eventを選んでください。",
			acceptanceCriteria:
				"公開Play、実provider、generic tool、Task Operator receiptが一つのpersistent sessionで確認できる。",
		});
		const initialSessions = await db
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.taskId, task.id));
		expect(initialSessions).toHaveLength(0);
		const playResponse = await app.request(
			`/api/mission-pilot/tasks/${task.id}/play`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedVersion: 0,
				}),
			},
		);
		expect(playResponse.status, await playResponse.text()).toBe(200);
		const session = await waitFor(async () => {
			const [row] = await db
				.select()
				.from(missionPilotSessions)
				.where(eq(missionPilotSessions.taskId, task.id));
			return row?.desiredState === "playing" ? row : null;
		});
		const firstOutcome = await waitFor(async () => {
			const [rows, agent] = await Promise.all([
				db
					.select()
					.from(missionPilotActionExecutions)
					.where(eq(missionPilotActionExecutions.sessionId, session.id)),
				db
					.select()
					.from(missionPilotAgentSessions)
					.where(eq(missionPilotAgentSessions.sessionId, session.id))
					.then(([row]) => row),
			]);
			const action = rows.find(
				(row) =>
					row.actionId === "task.message.send" && row.status === "succeeded",
			);
			if (action) return { action, failure: null };
			if (agent?.lastFailureJson)
				return { action: null, failure: agent.lastFailureJson };
			return null;
		});
		if (!firstOutcome.action)
			throw new Error(
				`Mission Pilot provider failed before the first action: ${JSON.stringify(firstOutcome.failure)}`,
			);
		const action = firstOutcome.action;
		expect(action.resultJson).toMatchObject({
			receipt: {
				actionId: "task.message.send",
				resourceRefs: [expect.objectContaining({ kind: "task_message" })],
			},
		});
		const firstToolCalls = await db
			.select()
			.from(missionPilotToolCalls)
			.where(eq(missionPilotToolCalls.sessionId, session.id));
		expect(firstToolCalls.map((call) => call.actionId)).toContain(
			"read_task_operator_view",
		);
		expect(firstToolCalls.map((call) => call.actionId)).toContain(
			"task.message.send",
		);

		const beforeItems = await db
			.select()
			.from(missionPilotConversationItems)
			.where(eq(missionPilotConversationItems.sessionId, session.id));
		await appendTaskMessage(
			task.id,
			"現在の権限でTask Operator viewを再取得し、失敗した場合は本文を保持して次の判断をしてください。",
		);
		await waitFor(async () => {
			const events = await db
				.select()
				.from(missionPilotTaskEventInbox)
				.where(eq(missionPilotTaskEventInbox.sessionId, session.id));
			const event = events.sort(
				(left, right) => right.sequence - left.sequence,
			)[0];
			return event?.eventType === "task.user_message_added" ? event : null;
		});
		const [current] = await db
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, session.id));
		if (current?.authorizationJson?.version !== 4)
			throw new Error("Delegated user authorization is missing.");
		await db
			.update(missionPilotSessions)
			.set({
				authorizationJson: {
					...current.authorizationJson,
					userAuthorizationRef: "revoked-live-user",
				},
			})
			.where(eq(missionPilotSessions.id, session.id));

		const failureResult = await waitFor(async () => {
			const items = await db
				.select()
				.from(missionPilotConversationItems)
				.where(eq(missionPilotConversationItems.sessionId, session.id));
			return (
				items
					.slice(beforeItems.length)
					.find(
						(item) =>
							item.kind === "tool_result" &&
							JSON.stringify(item.bodyJson).includes(
								"TASK_OPERATOR_PERMISSION_DENIED",
							),
					) ?? null
			);
		});
		expect(JSON.stringify(failureResult.bodyJson)).toContain(
			"TASK_OPERATOR_PERMISSION_DENIED",
		);
		await waitFor(async () => {
			const items = await db
				.select()
				.from(missionPilotConversationItems)
				.where(eq(missionPilotConversationItems.sessionId, session.id));
			return items
				.slice(beforeItems.length)
				.some(
					(item) =>
						item.kind === "assistant" || item.kind === "runtime_failure",
				)
				? true
				: null;
		});
	}, 180_000);

	it(
		"completes Questionnaire, Artifact, implementation, outcome evaluation, and Task completion through public operations",
		async () => {
			const configuredRepositoryPath =
				process.env.NIGHTWORKERS_LIVE_MISSION_PILOT_REPOSITORY_PATH?.trim();
			if (!configuredRepositoryPath)
				throw new Error(
					"NIGHTWORKERS_LIVE_MISSION_PILOT_REPOSITORY_PATH must identify a registered real canary repository.",
				);
			const repositoryRoot = await realpath(configuredRepositoryPath);
			const temporaryRoot = await realpath(os.tmpdir());
			const temporaryRelative = path.relative(temporaryRoot, repositoryRoot);
			if (
				temporaryRelative === "" ||
				(!temporaryRelative.startsWith("..") &&
					!path.isAbsolute(temporaryRelative))
			)
				throw new Error(
					"Mission Pilot full live canary repository must not be a temporary directory.",
				);
			const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
				cwd: repositoryRoot,
				encoding: "utf8",
			}).trim();
			if ((await realpath(gitRoot)) !== repositoryRoot)
				throw new Error(
					"NIGHTWORKERS_LIVE_MISSION_PILOT_REPOSITORY_PATH must be the repository root.",
				);
			const branch = execFileSync("git", ["branch", "--show-current"], {
				cwd: repositoryRoot,
				encoding: "utf8",
			}).trim();
			const repositoryId = crypto.randomUUID();
			repositoryIds.push(repositoryId);
			await db.insert(repositories).values({
				id: repositoryId,
				name: "Mission Pilot full live canary",
				localPath: repositoryRoot,
				branch,
				allowed: true,
			});
			const task = await createTask({
				repositoryId,
				title: "Mission Pilot full public-operation live canary",
				objective:
					"Plan ModeでQuestionnaireを生成し、answeringになってから20秒間は人間の回答を待ってください。未回答ならRecommendedを含む現在の選択肢から回答し、Feature Plan Artifactを生成してください。その後、登録済みrepositoryのworker worktreeだけでmission-pilot-live-canary.mdを作成し、内容を検証するImplementation Runを開始してください。terminal outcomeをTask Operatorで再評価し、Goal達成を確認できた場合だけtask.completeとagent.finishを実行してください。途中でRunまたはTodoが継続可能な状態で止まった場合は、最新resourceを再読してrun.todo.resumeまたはrun.implementation.startを選んでください。",
				acceptanceCriteria:
					"Questionnaire代理回答、Feature Plan Artifact、worker経由のImplementation Run、terminal outcome再評価、Task完了が同じpersistent Mission Pilot sessionで公開resource/actionだけを通って確認できる。",
			});
			const playResponse = await app.request(
				`/api/mission-pilot/tasks/${task.id}/play`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ expectedVersion: 0 }),
				},
			);
			expect(playResponse.status, await playResponse.text()).toBe(200);
			const session = await waitFor(async () => {
				const [row] = await db
					.select()
					.from(missionPilotSessions)
					.where(eq(missionPilotSessions.taskId, task.id));
				return row?.desiredState === "playing" ? row : null;
			});

			const completed = await waitFor(async () => {
				const [actions, agent, currentTask] = await Promise.all([
					db
						.select()
						.from(missionPilotActionExecutions)
						.where(eq(missionPilotActionExecutions.sessionId, session.id)),
					db
						.select()
						.from(missionPilotAgentSessions)
						.where(eq(missionPilotAgentSessions.sessionId, session.id))
						.then(([row]) => row),
					db
						.select()
						.from(tasks)
						.where(eq(tasks.id, task.id))
						.then(([row]) => row),
				]);
				if (agent?.runtimeState === "attention")
					throw new Error(
						`Mission Pilot full live canary needs attention: ${JSON.stringify(agent.lastFailureJson)}`,
					);
				const succeeded = actions.filter(
					(action) => action.status === "succeeded",
				);
				const questionnaireIndex = succeeded.findIndex(
					(action) => action.actionId === "questionnaire.submit",
				);
				const artifactIndex = succeeded.findIndex((action) =>
					action.actionId.startsWith("plan.artifact."),
				);
				const implementationIndex = succeeded.findIndex(
					(action) => action.actionId === "run.implementation.start",
				);
				const completionIndex = succeeded.findIndex(
					(action) => action.actionId === "task.complete",
				);
				if (
					questionnaireIndex < 0 ||
					artifactIndex <= questionnaireIndex ||
					implementationIndex <= artifactIndex ||
					completionIndex <= implementationIndex ||
					currentTask?.status !== "completed" ||
					agent?.runtimeState !== "completed"
				)
					return null;
				return { actions: succeeded, agent, currentTask };
			}, 12 * 60_000);

			const [runs, events, conversation] = await Promise.all([
				db.select().from(taskRuns).where(eq(taskRuns.taskId, task.id)),
				db
					.select()
					.from(missionPilotTaskEventInbox)
					.where(eq(missionPilotTaskEventInbox.sessionId, session.id)),
				db
					.select()
					.from(missionPilotConversationItems)
					.where(eq(missionPilotConversationItems.sessionId, session.id)),
			]);
			const terminalRuns = runs.filter((run) =>
				[
					"completed",
					"needs_review",
					"failed",
					"cancelled",
					"timed_out",
				].includes(run.status),
			);
			expect(terminalRuns.length).toBeGreaterThan(0);
			expect(
				terminalRuns.every((run) => {
					if (!run.worktreePath || !path.isAbsolute(run.worktreePath))
						return false;
					const relative = path.relative(temporaryRoot, run.worktreePath);
					return (
						relative !== "" &&
						(relative.startsWith("..") || path.isAbsolute(relative))
					);
				}),
			).toBe(true);
			expect(
				events.some((event) =>
					["task_run.terminal", "task_run.failed"].includes(event.eventType),
				),
			).toBe(true);
			expect(conversation.length).toBeGreaterThan(5);
			expect(completed.actions.map((action) => action.actionId)).toContain(
				"task.complete",
			);
		},
		15 * 60_000,
	);
});

async function waitFor<T>(
	read: () => Promise<T | null>,
	timeoutMs = 90_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await read();
		if (value !== null) return value;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out after ${timeoutMs}ms.`);
}
