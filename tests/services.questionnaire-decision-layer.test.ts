import { describe, expect, it } from "vitest";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import * as questionnaireRepo from "../api/modules/questionnaire/questionnaire.repository";
import { generateAdditionalDesignQuestionnaireQuestions } from "../api/modules/questionnaire/questionnaire-additional.service";
import { generateFeaturePlanArtifact } from "../api/modules/specification/specification-generation.service";
import type { DesignQuestionnaire } from "../shared/schemas/design-questionnaire.schema";

describe("Questionnaire decision layer services", () => {
	it("creates an additional questionnaire session without an existing session and suppresses duplicates", async () => {
		const env = useFixtureProvider();
		try {
			const { repository, task } = await createPlanModeTask(
				"Additional questionnaire",
			);
			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				title: "追加確認",
				rationale: "API contract needs one more decision.",
				questions: [
					{
						decisionKey: "api.todo.delete_response",
						text: "DELETE /api/todos/{id} の成功 response はどれにしますか？",
						type: "radio",
						options: ["204 No Content", "200 deleted object"],
						blocking: true,
						reason: "API handler と UI の削除後処理が変わるため。",
					},
				],
			});

			const created = await generateAdditionalDesignQuestionnaireQuestions(
				task.id,
				{
					source: "user_requested",
					reason: "レビューからの追加確認",
				},
			);

			expect(created.session?.taskId).toBe(task.id);
			expect(created.result).toMatchObject({
				sessionId: created.session?.id,
				addedCount: 1,
				skippedDuplicateCount: 0,
				blockingCount: 1,
				nonBlockingCount: 0,
			});
			expect(
				created.session?.questionSets[0]?.questionnaire?.source.repositoryId,
			).toBe(repository.id);
			expect(
				created.session?.questionSets[0]?.questionnaire?.questionSets[0]
					?.metadata,
			).toMatchObject({
				source: "user_requested",
				blocking: true,
				decisionKeys: ["api.todo.delete_response"],
			});
			const readyMessage = (
				await nightworkersRepo.listTaskMessages(task.id)
			).find(
				(message) =>
					message.metadataJson?.intent === "design_questionnaire_ready" &&
					message.metadataJson?.questionnaireSessionId === created.session?.id,
			);
			expect(readyMessage?.metadataJson).toMatchObject({
				questionnaireStatus: "answering",
				questionSetCount: 1,
			});

			const duplicate = await generateAdditionalDesignQuestionnaireQuestions(
				task.id,
				{
					source: "user_requested",
					reason: "同じ確認を再実行",
				},
			);

			expect(duplicate.result).toMatchObject({
				sessionId: created.session?.id,
				createdQuestionSetId: null,
				addedCount: 0,
				skippedDuplicateCount: 1,
			});
			expect(duplicate.session?.questionSets).toHaveLength(1);
		} finally {
			restoreFixtureProvider(env);
		}
	});

	it("blocks Feature Plan generation on unanswered blocking questions and allows explicit proceed", async () => {
		const env = useFixtureProvider();
		try {
			const { task } = await createPlanModeTask("Blocking gate");
			const session = await createQuestionnaireSession({
				taskId: task.id,
				repositoryId: task.repositoryId,
				blocking: true,
			});

			await expect(
				generateFeaturePlanArtifact(task.id, {
					questionnaireSessionId: session.id,
				}),
			).rejects.toMatchObject({
				statusCode: 409,
				code: "BLOCKING_QUESTIONNAIRE_ANSWERS_REQUIRED",
			});

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				title: "Feature Plan",
				content: "## 目的\n未回答 blocking を assumption として進める。\n",
			});
			const result = await generateFeaturePlanArtifact(task.id, {
				questionnaireSessionId: session.id,
				proceedWithUnansweredBlocking: true,
			});

			expect(result.message.metadataJson).toMatchObject({
				intent: "feature_plan",
				questionnaireSessionId: session.id,
			});
		} finally {
			restoreFixtureProvider(env);
		}
	});

	it("does not block Feature Plan generation for unanswered non-blocking questions", async () => {
		const env = useFixtureProvider();
		try {
			const { task } = await createPlanModeTask("Non-blocking gate");
			const session = await createQuestionnaireSession({
				taskId: task.id,
				repositoryId: task.repositoryId,
				blocking: false,
			});
			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				title: "Feature Plan",
				content: "## 目的\nnon-blocking は既存資料から進める。\n",
			});

			const result = await generateFeaturePlanArtifact(task.id, {
				questionnaireSessionId: session.id,
			});

			expect(result.message.metadataJson).toMatchObject({
				intent: "feature_plan",
				questionnaireSessionId: session.id,
			});
		} finally {
			restoreFixtureProvider(env);
		}
	});
});

async function createPlanModeTask(label: string) {
	const repository = await nightworkersRepo.createRepository({
		name: `TEST: ${label} ${crypto.randomUUID()}`,
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
	});
	const task = await nightworkersRepo.createTask({
		repositoryId: repository.id,
		title: `TEST: ${label}`,
		description: "Questionnaire decision layer regression target.",
		status: "draft",
	});
	return { repository, task };
}

async function createQuestionnaireSession(input: {
	taskId: string;
	repositoryId: string;
	blocking: boolean;
}) {
	const session = await questionnaireRepo.createDesignQuestionnaireSession({
		taskId: input.taskId,
		repositoryId: input.repositoryId,
		status: "answering",
	});
	await questionnaireRepo.createDesignQuestionnaireQuestionSet({
		sessionId: session.id,
		sequence: 1,
		questionnaireJson: buildQuestionnaire(input),
		validationStatus: "valid",
	});
	return session;
}

function buildQuestionnaire(input: {
	taskId: string;
	repositoryId: string;
	blocking: boolean;
}): DesignQuestionnaire {
	const decisionKey = input.blocking
		? "api.todo.delete_response"
		: "ui.todo.empty_state_copy";
	return {
		version: 1,
		source: {
			taskId: input.taskId,
			repositoryId: input.repositoryId,
			sourceKind: "plan_mode_intake",
			blueprintMessageId: null,
		},
		title: "追加確認",
		summary: "Feature Plan gate regression fixture.",
		questionSets: [
			{
				id: "additional-1",
				title: "追加確認",
				category: "追加確認",
				purpose: "Feature Plan 生成前の gate を確認する。",
				metadata: {
					source: "user_requested",
					blocking: input.blocking,
					reason: "regression fixture",
					generatedFromMessageIds: [],
					decisionKeys: [decisionKey],
				},
				questions: [
					{
						id: "additional-1-q1",
						topic: decisionKey,
						question: input.blocking
							? "DELETE /api/todos/{id} の成功 response はどれにしますか？"
							: "empty state の copy はどれにしますか？",
						why: "Feature Plan gate regression fixture.",
						answerType: "single_choice",
						options: [
							{ id: "option-1", label: "A", tradeoff: "A を採用する。" },
							{ id: "option-2", label: "B", tradeoff: "B を採用する。" },
						],
						allowsCustomAnswer: false,
						blocks: ["Feature Plan gate regression fixture."],
						outputSection: input.blocking ? "api" : "ui",
						decisionKey,
						blocking: input.blocking,
						blockingReason: input.blocking
							? "API contract が曖昧になるため。"
							: undefined,
					},
				],
			},
		],
		openQuestions: [],
		dataModelHandoffNotes: [],
	};
}

function useFixtureProvider() {
	const env = {
		activeProvider: process.env.ACTIVE_LLM_PROVIDER,
		fixture: process.env.SUPERVISOR_FIXTURE_OUTPUT,
		settingsPath: process.env.NIGHTWORKERS_LLM_SETTINGS_PATH,
	};
	process.env.ACTIVE_LLM_PROVIDER = "fixture";
	process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
	return env;
}

function restoreFixtureProvider(env: {
	activeProvider: string | undefined;
	fixture: string | undefined;
	settingsPath: string | undefined;
}) {
	restoreEnv("ACTIVE_LLM_PROVIDER", env.activeProvider);
	restoreEnv("SUPERVISOR_FIXTURE_OUTPUT", env.fixture);
	restoreEnv("NIGHTWORKERS_LLM_SETTINGS_PATH", env.settingsPath);
}

function restoreEnv(key: string, value: string | undefined) {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}
