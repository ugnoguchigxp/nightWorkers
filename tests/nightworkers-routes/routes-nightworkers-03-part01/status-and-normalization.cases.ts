import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import app from "../../../api/app";
import * as repo from "../../../api/modules/nightworkers/nightworkers.repository";
import { saveDesignQuestionnaireAnswers } from "../../../api/modules/questionnaire/questionnaire.service";
import { representativeMockBlueprint } from "../../fixtures/mock-blueprint";
import {
	buildMechanicalQuestionnaireAnswers,
	representativeDataModelArtifact,
	sameOriginHeaders,
} from "./helpers";
import "./setup";

describe("NightWorkers task routes status and normalization", () => {
	it("generates Blueprint, Data Model, and Specification from Status", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";

		try {
			const createdRepo = await repo.createRepository({
				name: `TEST: Status ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: createdRepo.id,
				title: "TEST: Specification status target",
				description: "Generate artifacts from completed questionnaire",
				status: "draft",
			});

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				title: "実装前に決めたいこと",
				questions: [
					{
						text: "最初に作る画面はどれですか？",
						type: "radio",
						options: ["業務ダッシュボード", "入力フォーム", "一覧管理"],
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
				action: "ready_for_design_assembly",
				rationale: "The first screen decision is enough to generate artifacts.",
				questionnaire: null,
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
								selectedOptionIds: ["q1-o1"],
								rankedOptionIds: [],
								deferred: false,
							},
						],
					}),
				},
			);
			expect(answersRes.status).toBe(200);
			expect((await answersRes.json()).status).toBe("review_ready");

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify(
				representativeMockBlueprint,
			);
			const blueprintRes = await app.request(
				`http://localhost/api/tasks/${task.id}/plan-mode/blueprint`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({ questionnaireSessionId: session.id }),
				},
			);
			expect(blueprintRes.status).toBe(200);
			const blueprintBody = await blueprintRes.json();
			expect(blueprintBody.message.metadataJson).toMatchObject({
				intent: "mock_blueprint",
				source: "status",
				questionnaireSessionId: session.id,
			});
			let messages = await repo.listTaskMessages(task.id);
			expect(
				messages.some(
					(message) => message.metadataJson?.intent === "draft_spec",
				),
			).toBe(false);

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify(
				representativeDataModelArtifact,
			);
			const dataModelRes = await app.request(
				`http://localhost/api/tasks/${task.id}/plan-mode/data-model`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({
						questionnaireSessionId: session.id,
						sourceBlueprintMessageId: blueprintBody.message.id,
					}),
				},
			);
			expect(dataModelRes.status).toBe(200);
			expect((await dataModelRes.json()).message.metadataJson).toMatchObject({
				intent: "plan_mode_dedicated_view",
				source: "data-model",
				view: "data_model",
				artifactType: "data_model",
				questionnaireSessionId: session.id,
			});
			messages = await repo.listTaskMessages(task.id);
			expect(
				messages.some(
					(message) => message.metadataJson?.intent === "draft_spec",
				),
			).toBe(false);

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				markdown: [
					"# Kanban Specification",
					"",
					"## 1. 目的",
					"NightWorkers に Operations Command Center を初期実装する。",
					"",
					"## 3. 画面仕様",
					"Operations Command Center",
					"",
					"## 4. 機能要件",
					"カード操作を提供する。",
					"",
					"## 5. データ/API 方針",
					"CREATE TABLE decision_items (id TEXT PRIMARY KEY);",
					"",
					"## Appendix. Questionnaire Decisions",
					"最初に作る画面はどれですか？",
					"",
					"## 実装計画",
					"1. 画面実装: Operations Command Centerを実装する。",
					"",
					"## 完了条件",
					"- [AC-001][ui] 画面を利用できる",
				].join("\n"),
			});
			const docRes = await app.request(
				`http://localhost/api/tasks/${task.id}/plan-mode/feature-plan`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({ questionnaireSessionId: session.id }),
				},
			);
			expect(docRes.status).toBe(200);
			const docBody = await docRes.json();
			expect(docBody.message).toMatchObject({
				messageType: "markdown_document",
				metadataJson: {
					intent: "feature_plan",
					source: "status",
					questionnaireSessionId: session.id,
				},
			});
			expect(docBody.message.content).toContain("## 1. 目的");
			expect(docBody.message.content).not.toContain("NightWorkers");
			expect(docBody.message.content).toContain("## 3. 画面仕様");
			expect(docBody.message.content).toContain("Operations Command Center");
			expect(docBody.message.content).toContain("## 4. 機能要件");
			expect(docBody.message.content).toContain("## 5. データ/API 方針");
			expect(docBody.message.content).toContain(
				"## Appendix. Questionnaire Decisions",
			);
			expect(docBody.message.metadataJson.generation).toMatchObject({
				source: "llm",
				context: {
					blueprintSummaryIncluded: false,
					planViewReferencesIncluded: false,
				},
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

	it("mechanically answers generated questionnaire pages 1-4 before assembling a design document", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";

		try {
			const createdRepo = await repo.createRepository({
				name: `TEST: Mechanical Design Flow ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: createdRepo.id,
				title: "TEST: Mechanical design document flow",
				description:
					"Generate a design document after mechanically answering LLM questions",
				status: "draft",
			});

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				version: 1,
				source: {
					taskId: task.id,
					repositoryId: createdRepo.id,
					sourceKind: "plan_mode_intake",
				},
				title: "Mechanical Flow Questionnaire",
				summary: "Synthetic questionnaire with all supported answer types.",
				questionSets: [
					{
						id: "page-one",
						title: "Page 1",
						category: "Scope",
						purpose: "Cover answer generation without semantic accuracy.",
						questions: [
							{
								id: "primary-screen",
								topic: "Screen",
								question: "Which screen should be designed first?",
								why: "The first screen drives the design document outline.",
								answerType: "single_choice",
								recommendedAnswerId: "dashboard",
								options: [
									{
										id: "dashboard",
										label: "Dashboard",
										tradeoff: "Fast overview.",
									},
									{ id: "form", label: "Form", tradeoff: "More input detail." },
								],
								blocks: ["Initial screen specification"],
								outputSection: "Screen design",
							},
							{
								id: "included-features",
								topic: "Features",
								question: "Which supporting features should be included?",
								why: "Feature selection affects scope.",
								answerType: "multi_choice",
								options: [
									{
										id: "search",
										label: "Search",
										tradeoff: "Adds filtering work.",
									},
									{
										id: "archive",
										label: "Archive",
										tradeoff: "Adds lifecycle state.",
									},
								],
								blocks: ["Feature list"],
								outputSection: "Functional requirements",
							},
							{
								id: "needs-auth",
								topic: "Auth",
								question: "Does the first version need authentication?",
								why: "Authentication changes routes and data model assumptions.",
								answerType: "boolean",
								blocks: ["Auth policy"],
								outputSection: "Non-functional requirements",
							},
							{
								id: "success-copy",
								topic: "Copy",
								question: "What short success copy should be shown?",
								why: "Copy helps verify free text answers are accepted.",
								answerType: "free_text",
								blocks: ["UI copy"],
								outputSection: "UI details",
							},
							{
								id: "priority-order",
								topic: "Priority",
								question: "Rank implementation priorities.",
								why: "The sequence shapes the implementation section.",
								answerType: "ranked",
								options: [
									{
										id: "model",
										label: "Data model",
										tradeoff: "Stabilizes API.",
									},
									{ id: "ui", label: "UI", tradeoff: "Validates workflow." },
								],
								blocks: ["Implementation order"],
								outputSection: "Implementation plan",
							},
						],
					},
				],
				openQuestions: [],
				dataModelHandoffNotes: [],
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
			let session = await createRes.json();
			expect(session.status).toBe("answering");
			expect(session.questionSets).toHaveLength(1);

			async function answerCurrentPageWith(nextFixture: unknown) {
				process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify(nextFixture);
				const answers = buildMechanicalQuestionnaireAnswers(session);
				expect(answers.length).toBeGreaterThan(0);
				session = await saveDesignQuestionnaireAnswers(
					task.id,
					session.id,
					answers,
					{ completionPolicy: "assess_follow_up" },
				);
				return session;
			}

			await answerCurrentPageWith({
				action: "follow_up",
				rationale: "Page 2 is needed to cover a generated follow-up.",
				questionnaire: {
					title: "Page 2",
					questions: [
						{
							text: "Which density should the design use?",
							type: "radio",
							options: ["Compact", "Comfortable", "Spacious"],
						},
					],
				},
			});
			expect(session.status).toBe("answering");
			expect(session.questionSets).toHaveLength(2);

			await answerCurrentPageWith({
				action: "follow_up",
				rationale: "Page 3 is needed for another generated follow-up.",
				questionnaire: {
					title: "Page 3",
					questions: [
						{
							text: "Which states should be visible?",
							type: "checkbox",
							options: ["Empty", "Loading", "Error", "Success"],
						},
					],
				},
			});
			expect(session.status).toBe("answering");
			expect(session.questionSets).toHaveLength(3);

			await answerCurrentPageWith({
				action: "follow_up",
				rationale: "Page 4 is the final follow-up page.",
				questionnaire: {
					title: "Page 4",
					questions: [
						{
							text: "Which implementation risk should the document mention?",
							type: "radio",
							options: ["Data drift", "Slow loading", "Permission mismatch"],
						},
					],
				},
			});
			expect(session.status).toBe("answering");
			expect(session.questionSets).toHaveLength(4);

			await answerCurrentPageWith({
				action: "ready_for_design_assembly",
				rationale: "The synthetic answers are enough for design assembly.",
				questionnaire: null,
			});
			expect(session.status).toBe("review_ready");
			expect(session.answers.length).toBeGreaterThanOrEqual(8);

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify(
				representativeMockBlueprint,
			);
			const blueprintRes = await app.request(
				`http://localhost/api/tasks/${task.id}/plan-mode/blueprint`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({ questionnaireSessionId: session.id }),
				},
			);
			expect(blueprintRes.status).toBe(200);
			const blueprintBody = await blueprintRes.json();
			expect(blueprintBody.message.metadataJson).toMatchObject({
				intent: "mock_blueprint",
				questionnaireSessionId: session.id,
			});

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify(
				representativeDataModelArtifact,
			);
			const dataModelRes = await app.request(
				`http://localhost/api/tasks/${task.id}/plan-mode/data-model`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({
						questionnaireSessionId: session.id,
						sourceBlueprintMessageId: blueprintBody.message.id,
					}),
				},
			);
			expect(dataModelRes.status).toBe(200);
			expect((await dataModelRes.json()).message.metadataJson).toMatchObject({
				source: "data-model",
				view: "data_model",
				questionnaireSessionId: session.id,
			});

			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				markdown: [
					"# Mechanical Design Document",
					"",
					"## 1. 目的",
					"Generated questionnaire answers are enough to assemble the first design document.",
					"",
					"## 2. 決定事項",
					"Mechanically selected answers are treated as provisional decisions.",
					"",
					"## 3. 画面仕様",
					"Operations Command Center",
					"",
					"## 4. 機能要件",
					"Search and lifecycle controls are included.",
					"",
					"## Appendix. Questionnaire Decisions",
					"Which screen should be designed first?",
					"",
					"## 実装計画",
					"1. 画面実装: Design documentを実装する。",
					"",
					"## 完了条件",
					"- [AC-001][ui] 画面を利用できる",
				].join("\n"),
			});
			const docRes = await app.request(
				`http://localhost/api/tasks/${task.id}/plan-mode/feature-plan`,
				{
					method: "POST",
					headers: { ...sameOriginHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({ questionnaireSessionId: session.id }),
				},
			);
			expect(docRes.status).toBe(200);
			const docBody = await docRes.json();
			expect(docBody.message).toMatchObject({
				messageType: "markdown_document",
				metadataJson: {
					intent: "feature_plan",
					questionnaireSessionId: session.id,
				},
			});
			expect(docBody.message.content).toContain("## 1. 目的");
			expect(docBody.message.content).toContain("## 4. 機能要件");
			expect(docBody.message.content).toContain(
				"## Appendix. Questionnaire Decisions",
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

	it("preserves invalid legacy Design Questionnaire output without semantic fabrication", async () => {
		const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
		const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
		const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
		process.env.ACTIVE_LLM_PROVIDER = "fixture";

		try {
			const createdRepo = await repo.createRepository({
				name: `TEST: Legacy Design Questionnaire ${crypto.randomUUID()}`,
				localPath: "/Users/y.noguchi/Code/nightWorkers",
				branch: "main",
			});
			const task = await repo.createTask({
				repositoryId: createdRepo.id,
				title: "TEST: Legacy questionnaire target",
				description: "Generate legacy questionnaire",
				status: "draft",
			});
			process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
				taskId: task.id,
				repositoryId: createdRepo.id,
				questions: [
					{
						id: "product-scope-and-users",
						category: "プロダクト範囲",
						question:
							"この Kanban システムの対象ユーザーと利用範囲はどこまでですか？",
						why: "利用者の前提で必要な画面、権限、データモデル、認証有無が変わるためです。",
						blocks: ["認証方式の設計", "初期 MVP の機能範囲"],
						outputSection: "scope",
						recommendedAnswer: "個人利用から始める",
						choices: [
							{
								label: "個人利用",
								description: "最小構成で始めやすい。",
							},
							{
								label: "チーム利用",
								description: "共有や権限設計が必要になる。",
							},
						],
						tradeoff: "共有を入れるほど初期実装は重くなります。",
					},
				],
				dataModelHandoffNotes: [
					"ボード、列、カードの正規化方針を Data Model で決める。",
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
			expect(session.status).toBe("needs_edit");
			expect(session.questionSets[0]).toMatchObject({
				validationStatus: "invalid",
				questionnaire: null,
			});
			expect(session.questionSets[0].rawOutput).toBe(
				process.env.SUPERVISOR_FIXTURE_OUTPUT,
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
});
