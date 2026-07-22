import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import app from "../../../api/app";
import * as repo from "../../../api/modules/nightworkers/nightworkers.repository";
import { representativeMockBlueprint } from "../../fixtures/mock-blueprint";
import { completionVerificationAnswer, sameOriginHeaders } from "./helpers";
import "./setup";

describe("NightWorkers task routes blueprint artifacts", () => {
	it("generates Blueprint and Feature Plan without requiring a Questionnaire session", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";

		try {
			const createdRepo = await repo.createRepository({
				name: `TEST: Optional Questionnaire ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: createdRepo.id,
				title: "TEST: Optional questionnaire target",
				description: "Generate Plan Mode artifacts from task context only",
				status: "draft",
			});

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify(
				representativeMockBlueprint,
			);
			const blueprintRes = await app.request(
				`http://localhost/api/tasks/${task.id}/plan-mode/blueprint`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			expect(blueprintRes.status).toBe(200);
			const blueprintBody = await blueprintRes.json();
			expect(blueprintBody.message.metadataJson).toMatchObject({
				intent: "mock_blueprint",
				source: "status",
				questionnaireSessionId: null,
				artifactRef: {
					artifactId: expect.any(String),
					kind: "app_blueprint",
					version: 1,
				},
				mockBlueprint: expect.objectContaining({
					artifactKind: "mock_blueprint",
					meta: expect.objectContaining({
						selectedSections: expect.any(Array),
					}),
				}),
				generation: {
					llmUsage: expect.objectContaining({
						label: "mock_blueprint",
						totalTokens: expect.any(Number),
					}),
				},
			});
			const blueprintArtifacts = await repo.listActivityArtifactsForTask(
				task.id,
			);
			const mockBlueprintArtifact = blueprintArtifacts.find(
				(artifact) =>
					artifact.id ===
					blueprintBody.message.metadataJson.artifactRef.artifactId,
			);
			expect(mockBlueprintArtifact).toMatchObject({
				kind: "app_blueprint",
				metadataJson: {
					intent: "mock_blueprint",
					schemaName: "mock_blueprint",
					mockBlueprint: expect.objectContaining({
						artifactKind: "mock_blueprint",
						meta: expect.objectContaining({
							selectedSections: expect.any(Array),
						}),
					}),
					generation: expect.objectContaining({
						llmUsage: expect.objectContaining({
							label: "mock_blueprint",
						}),
					}),
				},
			});
			expect(
				JSON.parse(String(mockBlueprintArtifact?.contentText)),
			).toMatchObject({
				artifactKind: "mock_blueprint",
				meta: expect.objectContaining({
					selectedSections: expect.any(Array),
				}),
			});

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				markdown: [
					"# Questionnaire Optional Feature Plan",
					"",
					"## Goal",
					"Task contextだけから初期実装可能なFeature Planを作る。",
					"",
					"## 実装計画",
					"1. 初期実装: Feature Planを実装する。",
					"",
					"## 完了条件",
					"- [AC-001][workflow] 初期実装を利用できる",
				].join("\n"),
				repositoryMaterializationIntent: null,
			});
			const featurePlanRes = await app.request(
				`http://localhost/api/tasks/${task.id}/plan-mode/feature-plan`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			expect(featurePlanRes.status).toBe(200);
			const featurePlanBody = await featurePlanRes.json();
			expect(featurePlanBody.message.metadataJson).toMatchObject({
				intent: "feature_plan",
				source: "status",
				questionnaireSessionId: null,
			});
			expect(featurePlanBody.message.content).toContain(
				"# Questionnaire Optional Feature Plan",
			);
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

	it("stores Mock Blueprint raw output metadata when schema validation fails", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";
		const rawOutput =
			'{"artifactKind":"mock_blueprint","id":"broken","name":"Broken"}';
		process.env.SUPERVISOR_FIXTURE_OUTPUT = rawOutput;

		try {
			const createdRepo = await repo.createRepository({
				name: `TEST: Mock Blueprint Failure ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: createdRepo.id,
				title: "TEST: Mock Blueprint failure target",
				description: "Generate invalid Mock Blueprint output",
				status: "draft",
			});

			const blueprintRes = await app.request(
				`http://localhost/api/tasks/${task.id}/plan-mode/blueprint`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);

			expect(blueprintRes.status).toBe(502);
			const messages = await repo.listTaskMessages(task.id);
			expect(messages).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						messageType: "text",
						content: rawOutput,
						metadataJson: expect.objectContaining({
							intent: "mock_blueprint_raw_output",
							validationStatus: "failed",
							rawOutputBytes: Buffer.byteLength(rawOutput, "utf8"),
							rawOutputPreview: rawOutput,
							promptDiagnostics: expect.objectContaining({
								schemaName: "mock_blueprint",
								totalPromptEstimatedTokens: expect.any(Number),
							}),
						}),
					}),
				]),
			);
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

	it("stores schema-invalid Design Questionnaire raw output without replacing it", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";

		try {
			const createdRepo = await repo.createRepository({
				name: `TEST: Invalid Design Questionnaire ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: createdRepo.id,
				title: "TEST: Invalid questionnaire target",
				description: "Generate invalid questionnaire",
				status: "draft",
			});
			const blueprintMessage = await repo.createTaskMessage({
				taskId: task.id,
				role: "assistant",
				content: "# Blueprint",
				messageType: "markdown_document",
				payloadJson: {
					intent: "app_blueprint",
					title: "Invalid Output App",
					appBlueprint: {
						id: "invalid-output-app",
						name: "Invalid Output App",
					},
				},
			});
			process.env.SUPERVISOR_FIXTURE_OUTPUT =
				"質問票を作れませんでしたが、ここに未決定事項の説明があります。";

			const createRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({
						sourceBlueprintMessageId: blueprintMessage.id,
					}),
				},
			);
			expect(createRes.status).toBe(201);
			const session = await createRes.json();
			expect(session.status).toBe("needs_edit");
			expect(session.questionSets).toHaveLength(1);
			expect(session.questionSets[0]).toMatchObject({
				validationStatus: "invalid",
				questionnaire: null,
				rawOutput:
					"質問票を作れませんでしたが、ここに未決定事項の説明があります。",
			});
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

	it("creates and saves a repaired choice-form Design Questionnaire", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";

		try {
			const createdRepo = await repo.createRepository({
				name: `TEST: Choice Form Questionnaire ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: createdRepo.id,
				title: "TEST: Choice questionnaire target",
				description: "Generate choice questionnaire",
				status: "draft",
			});
			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				title: "実装前に決めたいこと",
				questions: [
					{
						text: "最初のリリース範囲はどれにしますか？",
						kind: "design_decision",
						type: "radio",
						options: [
							"最小CRUDのみ",
							"一覧・詳細・編集まで",
							"通知や履歴も含める",
						],
					},
					{
						text: "必要なユーザー権限を選んでください",
						kind: "design_decision",
						type: "checkbox",
						options: ["管理者", "編集者", "閲覧者"],
					},
					{
						text: "applicationが完了条件として採用するテスト範囲はどれですか？",
						kind: "completion_verification",
						type: "radio",
						options: [
							"テストを完了条件にしない",
							"Unit test",
							"フロントエンドにUIがある場合のE2E",
						],
					},
				],
			}).slice(0, -2);

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
			expect(session.status).toBe("answering");
			const questionnaire = session.questionSets[0].questionnaire;
			expect(questionnaire.source).toMatchObject({
				taskId: task.id,
				repositoryId: createdRepo.id,
				sourceKind: "plan_mode_intake",
			});
			expect(questionnaire.questionSets[0].questions).toEqual([
				expect.objectContaining({
					id: "q1",
					answerType: "single_choice",
					options: expect.arrayContaining([
						expect.objectContaining({ id: "q1-o1" }),
					]),
				}),
				expect.objectContaining({
					id: "q2",
					answerType: "multi_choice",
					options: expect.arrayContaining([
						expect.objectContaining({ id: "q2-o2" }),
					]),
				}),
				expect.objectContaining({
					id: "completion-verification",
					decisionKey: "completion.verification_scope",
					question: "実装完了の条件にするテスト範囲を選んでください。",
					answerType: "single_choice",
					blocking: true,
					options: [
						expect.objectContaining({
							id: "completion-verification-none",
							label: "テストを完了条件にしない",
						}),
						expect.objectContaining({
							id: "completion-verification-unit",
							label: "Unit testを完了条件にする",
						}),
						expect.objectContaining({
							id: "completion-verification-e2e",
						}),
						expect.objectContaining({
							id: "completion-verification-unit-e2e",
						}),
					],
				}),
			]);

			const unknownOptionRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({
						answers: [
							completionVerificationAnswer(),
							{
								questionId: "q1",
								selectedOptionIds: ["missing-option"],
								rankedOptionIds: [],
								deferred: false,
							},
						],
					}),
				},
			);
			expect(unknownOptionRes.status).toBe(422);
			expect((await unknownOptionRes.json()).code).toBe("UNKNOWN_OPTION");

			const multipleRadioRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({
						answers: [
							{
								questionId: "q1",
								selectedOptionIds: ["q1-o1", "q1-o2"],
								rankedOptionIds: [],
								deferred: false,
							},
						],
					}),
				},
			);
			expect(multipleRadioRes.status).toBe(422);
			expect((await multipleRadioRes.json()).code).toBe(
				"MULTIPLE_OPTIONS_FOR_SINGLE_CHOICE",
			);

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				action: "ready_for_design_assembly",
				rationale:
					"The selected release scope and roles are enough for design assembly.",
				questionnaire: null,
			});

			const answersRes = await app.request(
				`http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({
						answers: [
							completionVerificationAnswer(),
							{
								questionId: "q1",
								selectedOptionIds: ["q1-o1"],
								rankedOptionIds: [],
								deferred: false,
							},
							{
								questionId: "q2",
								selectedOptionIds: ["q2-o1", "q2-o2"],
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
			expect(
				answeredSession.answers.map(
					(answer: unknown) => answer.answer.selectedOptionIds,
				),
			).toEqual([
				["completion-verification-unit"],
				["q1-o1"],
				["q2-o1", "q2-o2"],
			]);
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
