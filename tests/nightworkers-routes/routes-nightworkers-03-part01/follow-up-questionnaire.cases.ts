import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import app from "../../../api/app";
import * as repo from "../../../api/modules/nightworkers/nightworkers.repository";
import { saveDesignQuestionnaireAnswers } from "../../../api/modules/questionnaire/questionnaire.service";
import { sameOriginHeaders } from "./helpers";
import "./setup";

describe("NightWorkers task routes follow-up questionnaire", () => {
	it("lets Mission Pilot finalize the current questions without another follow-up page", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";

		try {
			const createdRepo = await repo.createRepository({
				name: `TEST: Mission Pilot Questionnaire ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: createdRepo.id,
				title: "TEST: Mission Pilot current-page finalization",
				description: "Do not generate the legacy follow-up page",
				status: "draft",
			});
			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				title: "最初の確認",
				questions: [
					{
						text: "初期スコープはどれですか？",
						type: "radio",
						options: ["最小", "標準"],
					},
				],
			});
			const createRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			const session = await createRes.json();
			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				action: "follow_up",
				rationale: "This must not be consumed by Mission Pilot finalization.",
				questionnaire: {
					title: "不要な追質問",
					questions: [
						{
							text: "さらに回答しますか？",
							type: "radio",
							options: ["はい", "いいえ"],
						},
					],
				},
			});
			const completed = await saveDesignQuestionnaireAnswers(
				task.id,
				session.id,
				[
					{
						questionId: "q1",
						selectedOptionIds: ["q1-o1"],
						rankedOptionIds: [],
						deferred: false,
					},
				],
				{ completionPolicy: "finalize_current_questions" },
			);
			expect(completed.status).toBe("review_ready");
			expect(completed.questionSets).toHaveLength(1);
		} finally {
			if (originalProvider === undefined)
				delete process.env.ACTIVE_LLM_PROVIDER;
			else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
			if (originalFixture === undefined)
				delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
			else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
			if (originalSettingsPath === undefined)
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
		}
	});

	it("continues Design Questionnaire with LLM follow-up questions before Design Assembly", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";

		try {
			const createdRepo = await repo.createRepository({
				name: `TEST: Follow-up Questionnaire ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: createdRepo.id,
				title: "TEST: Follow-up questionnaire target",
				description: "Generate follow-up questionnaire",
				status: "draft",
			});

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				title: "実装前に決めたいこと",
				questions: [
					{
						text: "初期リリースの主目的はどれですか？",
						type: "radio",
						options: ["予約管理", "顧客管理", "売上確認"],
					},
				],
			});

			const createRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			expect(createRes.status).toBe(201);
			const session = await createRes.json();

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				action: "follow_up",
				rationale:
					"The primary purpose is known, but the first slice boundary is still ambiguous.",
				questionnaire: {
					title: "追加で決めたいこと",
					questions: [
						{
							text: "初期リリースの予約範囲はどこまでにしますか？",
							type: "radio",
							options: ["作成のみ", "作成と変更", "作成・変更・キャンセル"],
						},
					],
				},
			});

			const firstAnswersRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({
						answers: [
							{
								questionId: "q1",
								selectedOptionIds: ["q1-o1"],
								rankedOptionIds: [],
								deferred: false,
							},
						],
					}),
				},
			);
			expect(firstAnswersRes.status).toBe(200);
			const followUpSession = await firstAnswersRes.json();
			expect(followUpSession.status).toBe("answering");
			expect(followUpSession.questionSets).toHaveLength(2);
			expect(
				followUpSession.questionSets[1].questionnaire.questionSets[0]
					.questions[0].id,
			).toBe("follow-up-2-q1");

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				action: "ready_for_design_assembly",
				rationale: "The initial release boundary is now clear enough.",
				questionnaire: null,
			});

			const followUpAnswersRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({
						answers: [
							{
								questionId: "follow-up-2-q1",
								selectedOptionIds: ["follow-up-2-q1-o2"],
								rankedOptionIds: [],
								deferred: false,
							},
						],
					}),
				},
			);
			expect(followUpAnswersRes.status).toBe(200);
			expect((await followUpAnswersRes.json()).status).toBe("review_ready");
		} finally {
			if (originalProvider === undefined)
				delete process.env.ACTIVE_LLM_PROVIDER;
			else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
			if (originalFixture === undefined)
				delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
			else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
			if (originalSettingsPath === undefined)
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
		}
	});

	it("stops Design Questionnaire follow-up after four pages", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";

		try {
			const createdRepo = await repo.createRepository({
				name: `TEST: Four Page Questionnaire ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: createdRepo.id,
				title: "TEST: Four page questionnaire target",
				description: "Generate follow-up questionnaire until the page limit",
				status: "draft",
			});

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				title: "実装前に決めたいこと",
				questions: [
					{
						text: "初期スコープはどれですか？",
						type: "radio",
						options: ["最小構成", "標準構成", "拡張構成"],
					},
				],
			});

			const createRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			expect(createRes.status).toBe(201);
			const session = await createRes.json();

			async function answerAndRequestFollowUp(
				questionId: string,
				optionId: string,
				page: number,
			) {
				const options = [`${page}-A`, `${page}-B`, `${page}-C`];
				process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
					action: "follow_up",
					rationale: `Page ${page} still leaves another dependent decision open.`,
					questionnaire: {
						title: `追加確認 ${page}`,
						questions: [
							{
								text: `追加確認 ${page} はどれですか？`,
								type: "radio",
								options,
							},
						],
					},
				});
				const res = await app.request(
					`http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
					{
						method: "POST",
						headers: {
							...sameOriginHeaders,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							answers: [
								{
									questionId,
									selectedOptionIds: [optionId],
									rankedOptionIds: [],
									deferred: false,
								},
							],
						}),
					},
				);
				expect(res.status).toBe(200);
				return res.json();
			}

			let currentSession = await answerAndRequestFollowUp("q1", "q1-o1", 2);
			expect(currentSession.status).toBe("answering");
			expect(currentSession.questionSets).toHaveLength(2);

			currentSession = await answerAndRequestFollowUp(
				"follow-up-2-q1",
				"follow-up-2-q1-o1",
				3,
			);
			expect(currentSession.status).toBe("answering");
			expect(currentSession.questionSets).toHaveLength(3);

			currentSession = await answerAndRequestFollowUp(
				"follow-up-3-q1",
				"follow-up-3-q1-o1",
				4,
			);
			expect(currentSession.status).toBe("answering");
			expect(currentSession.questionSets).toHaveLength(4);

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				action: "follow_up",
				rationale: "This should be ignored because the page limit is reached.",
				questionnaire: {
					title: "追加確認 5",
					questions: [
						{
							text: "5ページ目の質問は作られますか？",
							type: "radio",
							options: ["はい", "いいえ"],
						},
					],
				},
			});
			const limitRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({
						answers: [
							{
								questionId: "follow-up-4-q1",
								selectedOptionIds: ["follow-up-4-q1-o1"],
								rankedOptionIds: [],
								deferred: false,
							},
						],
					}),
				},
			);
			expect(limitRes.status).toBe(200);
			currentSession = await limitRes.json();
			expect(currentSession.status).toBe("review_ready");
			expect(currentSession.questionSets).toHaveLength(4);
		} finally {
			if (originalProvider === undefined)
				delete process.env.ACTIVE_LLM_PROVIDER;
			else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
			if (originalFixture === undefined)
				delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
			else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
			if (originalSettingsPath === undefined)
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
		}
	});

	it("treats empty checkbox answers as none-needed and blocks duplicate follow-up questions", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";

		try {
			const createdRepo = await repo.createRepository({
				name: `TEST: Duplicate Follow-up ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: createdRepo.id,
				title: "TEST: Duplicate follow-up target",
				description: "Avoid duplicate follow-up questions",
				status: "draft",
			});

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				title: "実装前に決めたいこと",
				questions: [
					{
						text: "初期リリースで含めたい運用機能はどれですか？",
						type: "checkbox",
						options: [
							"並び順の保存",
							"アーカイブ",
							"ラベル",
							"期限日",
							"コメント",
							"通知",
						],
					},
				],
			});
			const createRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			expect(createRes.status).toBe(201);
			const session = await createRes.json();

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				action: "follow_up",
				rationale: "Duplicate question should be suppressed by the server.",
				questionnaire: {
					title: "追加確認フォーム",
					questions: [
						{
							text: "初期リリースに含める運用機能を選んでください。",
							type: "checkbox",
							options: [
								"並び順の保存",
								"アーカイブ",
								"ラベル",
								"期限日",
								"コメント",
								"通知",
							],
						},
					],
				},
			});
			const answersRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({
						answers: [
							{
								questionId: "q1",
								selectedOptionIds: [],
								rankedOptionIds: [],
								deferred: false,
							},
						],
					}),
				},
			);
			expect(answersRes.status).toBe(200);
			const answeredSession = await answersRes.json();
			expect(answeredSession.status).toBe("review_ready");
			expect(answeredSession.questionSets).toHaveLength(1);
		} finally {
			if (originalProvider === undefined)
				delete process.env.ACTIVE_LLM_PROVIDER;
			else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
			if (originalFixture === undefined)
				delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
			else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
			if (originalSettingsPath === undefined)
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
		}
	});

	it("carries answered questions forward and drops same-axis follow-up questions", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";

		try {
			const createdRepo = await repo.createRepository({
				name: `TEST: Answered Axis Follow-up ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: createdRepo.id,
				title: "TEST: Answered axis follow-up target",
				description: "Avoid regenerating already answered questionnaire axes",
				status: "draft",
			});

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				title: "実装前に決めたいこと",
				questions: [
					{
						text: "運用・保存の前提はどれですか？",
						type: "radio",
						options: [
							"ローカル開発のみ",
							"Docker 前提",
							"クラウド配置前提",
							"バックアップや移行も考慮",
							"未定",
						],
					},
					{
						text: "今回の実装はどの技術スタックの前提ですか？",
						type: "radio",
						options: [
							"Hono + React/Vite",
							"Python/FastAPI + React/Vite",
							"既存リポジトリの標準に合わせる",
						],
					},
				],
			});

			const createRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			expect(createRes.status).toBe(201);
			const session = await createRes.json();

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				action: "follow_up",
				rationale:
					"The fixture intentionally repeats answered axes before one genuinely new question.",
				questionnaire: {
					title: "追加確認フォーム",
					questions: [
						{
							text: "この機能の実行・配置先はどれですか？",
							type: "radio",
							options: [
								"ローカル専用の Web アプリ",
								"Docker で動かす self-hosted",
								"クラウド配置前提",
								"将来切り替えられる前提",
								"未定",
							],
						},
						{
							text: "データの保存と復旧はどこまで必要ですか？",
							type: "radio",
							options: [
								"ローカル SQLite の永続保存のみ",
								"エクスポート / インポートが必要",
								"定期バックアップや復元を考慮",
								"保存は最小限で、復旧は不要",
								"未定",
							],
						},
						{
							text: "単一ユーザー前提は維持しますか？",
							type: "radio",
							options: [
								"個人利用の単一ユーザー",
								"同一端末で複数プロフィール",
								"将来の複数ユーザーを見据える",
								"複数ユーザーは今回扱わない",
								"未定",
							],
						},
					],
				},
			});

			const answersRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({
						answers: [
							{
								questionId: "q1",
								selectedOptionIds: ["q1-o5"],
								rankedOptionIds: [],
								deferred: false,
							},
							{
								questionId: "q2",
								selectedOptionIds: ["q2-o1"],
								rankedOptionIds: [],
								deferred: false,
							},
						],
					}),
				},
			);
			expect(answersRes.status).toBe(200);
			const answeredSession = await answersRes.json();
			const followUpQuestions =
				answeredSession.questionSets[1]?.questionnaire?.questionSets[0]
					?.questions || [];

			expect(answeredSession.status).toBe("answering");
			expect(
				followUpQuestions.map(
					(question: { question: unknown }) => question.question,
				),
			).toEqual(["単一ユーザー前提は維持しますか？"]);
		} finally {
			if (originalProvider === undefined)
				delete process.env.ACTIVE_LLM_PROVIDER;
			else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
			if (originalFixture === undefined)
				delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
			else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
			if (originalSettingsPath === undefined)
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
		}
	});

	it("generates additional questionnaire questions through the route and suppresses duplicates", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";

		try {
			const createdRepo = await repo.createRepository({
				name: `TEST: Additional Questionnaire Route ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: createdRepo.id,
				title: "TEST: Additional questionnaire route target",
				description:
					"Generate additional questionnaire questions through the route",
				status: "draft",
			});
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

			const createRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire/additional`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({
						source: "user_requested",
						reason: "route test",
						maxQuestions: 5,
					}),
				},
			);
			expect(createRes.status).toBe(200);
			const created = await createRes.json();
			expect(created.session).toMatchObject({
				taskId: task.id,
				status: "answering",
			});
			expect(created.result).toMatchObject({
				sessionId: created.session.id,
				addedCount: 1,
				skippedDuplicateCount: 0,
				blockingCount: 1,
				nonBlockingCount: 0,
			});

			const duplicateRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire/additional`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({
						source: "user_requested",
						reason: "route test duplicate",
						maxQuestions: 5,
					}),
				},
			);
			expect(duplicateRes.status).toBe(200);
			const duplicate = await duplicateRes.json();
			expect(duplicate.result).toMatchObject({
				sessionId: created.session.id,
				createdQuestionSetId: null,
				addedCount: 0,
				skippedDuplicateCount: 1,
			});
			expect(duplicate.session.questionSets).toHaveLength(1);
		} finally {
			if (originalProvider === undefined)
				delete process.env.ACTIVE_LLM_PROVIDER;
			else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
			if (originalFixture === undefined)
				delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
			else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
			if (originalSettingsPath === undefined)
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
		}
	});
});
