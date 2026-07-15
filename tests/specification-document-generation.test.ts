import { describe, expect, it } from "vitest";
import {
	buildSpecificationDocumentContext,
	FEATURE_PLAN_TRACEABILITY_STATEMENT,
	sanitizeSpecificationTargetNaming,
} from "../api/modules/specification/specification-document-renderer";
import { buildSpecificationVerificationSidecar } from "../api/modules/specification/specification-verification-sidecar";
import {
	buildSpecificationDocumentSystemPrompt,
	buildSpecificationDocumentUserPrompt,
} from "../api/services/structured-generation/prompts/design-questionnaire";

describe("Specification document generation", () => {
	it("creates unique verification condition ids from completion bullets", () => {
		const result = buildSpecificationVerificationSidecar({
			taskId: "task-1",
			specId: "spec-1",
			specPath: "spec/sample.md",
			sourceMessageIds: [],
			workspace: {
				taskId: "task-1",
				repositoryId: "repo-1",
				generatedAt: "2026-07-08T00:00:00.000Z",
				featurePlanArtifacts: [],
				blueprintArtifacts: [],
				dataModelArtifacts: [],
				dedicatedViewArtifacts: [],
				decisionReviews: [],
				questionnaireSessions: [],
				implementationReferences: [],
			},
			content: [
				"## 完了条件",
				"- [AC-002] API が成功する",
				"- UI が状態を表示する",
				"- [AC-002] 重複 ID は再採番される",
			].join("\n"),
		});

		expect(result.document.conditions.map((condition) => condition.id)).toEqual(
			["AC-002", "AC-003", "AC-004"],
		);
		expect(result.content).toContain("[AC-004] 重複 ID は再採番される");
	});

	it("extracts unchecked and numbered completion condition bullets", () => {
		const result = buildSpecificationVerificationSidecar({
			taskId: "task-1",
			specId: "spec-1",
			specPath: "spec/sample.md",
			sourceMessageIds: [],
			workspace: {
				taskId: "task-1",
				repositoryId: "repo-1",
				generatedAt: "2026-07-08T00:00:00.000Z",
				featurePlanArtifacts: [],
				blueprintArtifacts: [],
				dataModelArtifacts: [],
				dedicatedViewArtifacts: [],
				decisionReviews: [],
				questionnaireSessions: [],
				implementationReferences: [],
			},
			content: [
				"## 完了条件",
				"- [ ] UI に Test Mode ボタンが表示される",
				"1. 実装計画の条件がチェックリスト化される",
				"- [x] 完了済みメモは条件にしない",
			].join("\n"),
		});

		expect(
			result.document.conditions.map((condition) => condition.text),
		).toEqual([
			"UI に Test Mode ボタンが表示される",
			"実装計画の条件がチェックリスト化される",
		]);
		expect(result.content).toContain(
			"- [AC-001] UI に Test Mode ボタンが表示される",
		);
		expect(result.content).toContain(
			"1. [AC-002] 実装計画の条件がチェックリスト化される",
		);
	});

	it("requires concise implementation-plan sections in the generation prompt", () => {
		const systemPrompt = buildSpecificationDocumentSystemPrompt();

		expect(systemPrompt).toContain("## タスク分類");
		expect(systemPrompt).toContain("## 実装計画");
		expect(systemPrompt).toContain("## 検証計画");
		expect(systemPrompt).toContain("## 完了条件");
		expect(systemPrompt).not.toContain("## 契約");
		expect(systemPrompt).not.toContain("## DDL");
		expect(systemPrompt).toContain("必要な判断だけを短く");
		expect(systemPrompt).toContain("同じ内容の重複を避け");
		expect(systemPrompt).toContain(
			"Questionnaire Decisions はTaskを具体化する設計判断",
		);
		expect(systemPrompt).toContain("Taskに明示された中核機能と検証要件");
		expect(systemPrompt).not.toContain("Mission Pilot SystemContext");
		expect(systemPrompt).toContain(
			"詳細契約は assembled design context 側の責務",
		);
		expect(systemPrompt).toContain("Feature Plan 本文に schema 全文");
		expect(systemPrompt).toContain("`## トレーサビリティ` は次の固定文だけ");
		expect(systemPrompt).toContain(FEATURE_PLAN_TRACEABILITY_STATEMENT);
		expect(systemPrompt).toContain(
			"API Contract / Blueprint / Data Model / Zod Schema artifact",
		);
		expect(systemPrompt).toContain("追加見出しは、重複になる場合は作らない");
		expect(systemPrompt).toContain("DB 変更が必要な場合");
		expect(systemPrompt).toContain("Bun 実行環境の `bun test`");
		expect(systemPrompt).not.toContain("NightWorkers の Specification writer");
		expect(systemPrompt).toContain(
			"NightWorkers / NightWorker を実装対象名として使わない",
		);
		expect(systemPrompt).toContain("実装対象は Task と Target Project Context");
		expect(systemPrompt).toContain("`verify` または `verify:base`");
		expect(systemPrompt).toContain(
			"`build` / `typecheck` / `lint` / `test` を `verify` と同列に重複列挙しない",
		);
		expect(systemPrompt).toContain(
			"または `## 実装計画` で追加すると明記した script 名だけ",
		);
		expect(systemPrompt).toContain(
			"`## 完了条件` の各項目がどう確認されるかをつなぐテストケースゴール",
		);
		expect(systemPrompt).toContain(
			"後続レビューでそのままテスト項目・検証ゴールとして使う",
		);
		expect(systemPrompt).toContain(
			"レビュー時に条件ごとのテスト有無を判定できる形",
		);
		expect(systemPrompt).toContain("テンプレート未使用でも検証を弱めず");
		expect(systemPrompt).toContain("最小の verify 系 script 追加");
	});

	it("adds requirement priority only to the Mission Pilot SystemContext", () => {
		const systemPrompt = buildSpecificationDocumentSystemPrompt({
			missionPilot: true,
		});

		expect(systemPrompt).toContain("[Mission Pilot SystemContext]");
		expect(systemPrompt).toContain("最新の明示的なユーザー指示");
		expect(systemPrompt).toContain("QuestionnaireはTaskを具体化");
		expect(systemPrompt).toContain("固定分岐、keyword判定、正規表現");
	});

	it("adds implementation plan guidance for DB/API/UI/test spanning tasks", () => {
		const context = buildSpecificationDocumentContext({
			task: {
				title: "todo list 本体を実装する",
				description: "Hono + React + SQLite 構成に todo list 本体を追加する。",
				objective: "task の作成、編集、削除、完了切り替えを実装する。",
			},
			session: null,
			workspace: {
				blueprintArtifacts: [{ id: "blueprint-1" }],
				dataModelArtifacts: [{ id: "data-model-1" }],
				dedicatedViewArtifacts: [
					{
						id: "api_io_contract-api-contract-message",
						kind: "api_io_contract",
						title: "Todo API Contract",
						sourceMessageId: "api-contract-message",
						createdAt: "2026-07-05T00:00:00.000Z",
					},
					{
						id: "zod_schema_design-zod-schema-message",
						kind: "zod_schema_design",
						title: "Todo Zod Schema",
						sourceMessageId: "zod-schema-message",
						createdAt: "2026-07-05T00:00:00.000Z",
					},
					{
						id: "user_flow-user-flow-message",
						kind: "user_flow",
						title: "Todo User Flow",
						sourceMessageId: "user-flow-message",
						createdAt: "2026-07-05T00:00:00.000Z",
					},
				],
				decisionReviews: [
					{
						id: "decision-review-message",
						kind: "decision_review",
						title: "Todo Decision Review",
						sourceMessageId: "decision-review-message",
						createdAt: "2026-07-05T00:00:00.000Z",
					},
				],
				featurePlanArtifacts: [],
				questionnaireSessions: [],
				implementationReferences: [],
			} as never,
			messages: [
				{
					id: "blueprint-message",
					metadataJson: {
						intent: "mock_blueprint",
						mockBlueprint: {
							name: "Todo List 本体",
							screens: [
								{
									name: "Todo List",
									path: "/todo",
									componentName: "Page",
									sections: [
										{
											name: "Task List",
											componentName: "DataTableSection",
											reason: "task の一覧と行単位操作を中核にするため。",
											props: {
												title: "task 一覧",
												dataset: "table",
												sample: [
													{ title: "週次の買い出しをまとめる", status: "todo" },
													{ title: "請求書の確認を終える", status: "done" },
												],
												columns: [
													{ title: "Task" },
													{ title: "Status" },
													{ title: "Updated" },
												],
											},
										},
										{
											name: "Task Form",
											componentName: "FormSection",
											props: {
												title: "task を追加・編集する",
												dataset: "form",
												items: [
													{ label: "task 名" },
													{ label: "状態" },
													{ label: "メモ" },
												],
											},
										},
									],
								},
							],
						},
					},
				},
				{
					id: "data-model-message",
					metadataJson: {
						artifactKind: "plan_mode_dedicated_view",
						view: "data_model",
						dataModelArtifact: {
							ddl: "CREATE TABLE todo_tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL);",
						},
					},
				},
				{
					id: "api-contract-message",
					metadataJson: {
						intent: "plan_mode_dedicated_view",
						artifactKind: "plan_mode_api_contract",
						view: "api_io_contract",
						title: "Todo API Contract",
						apiContract: {
							artifactKind: "plan_mode_api_contract",
							view: "api_io_contract",
							title: "Todo API Contract",
							summary: "todo task CRUD contract",
							openapi: {
								openapi: "3.1.0",
								info: { title: "Todo API", version: "0.1.0" },
								paths: {
									"/api/todos": {
										get: {
											operationId: "listTodos",
											summary: "todo task を一覧取得する",
										},
										post: {
											operationId: "createTodo",
											summary: "todo task を作成する",
										},
									},
									"/api/todos/{id}": {
										patch: {
											operationId: "updateTodo",
											summary: "todo task を更新する",
										},
										delete: {
											operationId: "deleteTodo",
											summary: "todo task を削除する",
										},
									},
								},
								components: { schemas: {} },
							},
							validation: [
								{ schemaName: "CreateTodoRequest", owner: "request" },
							],
						},
					},
				},
				{
					id: "zod-schema-message",
					metadataJson: {
						intent: "plan_mode_dedicated_view",
						artifactKind: "plan_mode_zod_schema",
						view: "zod_schema_design",
						title: "Todo Zod Schema",
						zodSchema: {
							artifactKind: "plan_mode_zod_schema",
							view: "zod_schema_design",
							title: "Todo Zod Schema",
							summary: "todo task validation schema",
							schemaName: "TodoTaskInputSchema",
							owner: "llm_json",
							zodSource:
								"const TodoTaskInputSchema = z.object({ title: z.string() });",
							fields: [
								{
									name: "title",
									type: "string",
									required: true,
									zodExpression: "z.string()",
								},
								{
									name: "status",
									type: "enum",
									required: true,
									enumOptions: ["todo", "done"],
									zodExpression: "z.enum(['todo', 'done'])",
								},
							],
						},
					},
				},
				{
					id: "user-flow-message",
					content:
						"```mermaid\nflowchart TD\n  empty[Empty state] --> create[Create task]\n```",
					metadataJson: {
						intent: "plan_mode_dedicated_view",
						artifactKind: "plan_mode_dedicated_view",
						view: "user_flow",
						title: "Todo User Flow",
						markdown:
							"```mermaid\nflowchart TD\n  empty[Empty state] --> create[Create task]\n```",
					},
				},
				{
					id: "decision-review-message",
					content: "Todo 本体は単一画面で完結させる。",
					metadataJson: {
						intent: "design_decision_review",
						title: "Todo Decision Review",
						designDecisionReview: {
							decisions: ["Todo 本体は単一画面で完結させる"],
						},
					},
				},
			],
			projectStackContext: [
				"Target Project Context",
				"- Project name: todolist",
				"- Project root: /Users/y.noguchi/Code/todolist",
				"",
				"TypeScript + React + Vite + Hono + SQLite + Drizzle ORM + Vitest + Playwright",
			].join("\n"),
		});

		expect(context.implementationPlanGuidance).toContain(
			"標準タスク（DB 変更部分は高リスク相当）",
		);
		expect(context.implementationPlanGuidance).toContain("DB/schema");
		expect(context.implementationPlanGuidance).toContain("API/backend");
		expect(context.implementationPlanGuidance).toContain("UI/frontend");
		expect(context.implementationPlanGuidance).toContain("schema/migration");
		expect(context.implementationPlanGuidance).toContain(
			"Questionnaire Decisions を優先",
		);
		expect(context.implementationPlanGuidance).toContain(
			"assembled design context を正",
		);
		expect(context.implementationPlanGuidance).toContain(
			"Feature Plan 本文に再掲しない",
		);
		expect(context.implementationPlanGuidance).toContain("Blueprint artifact");
		expect(context.blueprintSummary).toContain("Task List");
		expect(context.blueprintSummary).toContain("DataTableSection");
		expect(context.blueprintSummary).toContain("表示文言は task 一覧");
		expect(context.blueprintSummary).toContain(
			"サンプルは 週次の買い出しをまとめる / 請求書の確認を終える",
		);
		expect(context.blueprintSummary).toContain("列は Task / Status / Updated");
		expect(context.blueprintSummary).toContain("Task Form");
		expect(context.blueprintSummary).toContain(
			"表示項目は task 名 / 状態 / メモ",
		);
		expect(context.planViewReferences).toContain(
			"API Contract: Todo API Contract",
		);
		expect(context.planViewReferences).toContain("GET /api/todos (listTodos)");
		expect(context.planViewReferences).toContain(
			"PATCH /api/todos/{id} (updateTodo)",
		);
		expect(context.planViewReferences).toContain(
			"Validation: CreateTodoRequest",
		);
		expect(context.planViewReferences).toContain(
			"Zod Schema: TodoTaskInputSchema",
		);
		expect(context.planViewReferences).toContain(
			"status:enum/required(todo|done)",
		);
		expect(context.traceability).toBe(FEATURE_PLAN_TRACEABILITY_STATEMENT);
		expect(context.planModeReferences).toContain("Dedicated Views:");
		expect(context.planModeReferences).toContain("Todo User Flow");
		expect(context.planModeReferences).toContain("flowchart TD");
		expect(context.planModeReferences).toContain("Decision Reviews:");
		expect(context.planModeReferences).toContain(
			"Todo 本体は単一画面で完結させる",
		);
		expect(context.traceability).not.toContain("Plan Mode references:");
		expect(context.traceability).not.toContain(
			"user_flow:user_flow-user-flow-message",
		);

		const userPrompt = buildSpecificationDocumentUserPrompt(context);
		expect(userPrompt).toContain("## Implementation Plan Guidance");
		expect(userPrompt).toContain("## Target Project Context");
		expect(userPrompt).toContain("Project name: todolist");
		expect(userPrompt).toContain(
			"Project root: /Users/y.noguchi/Code/todolist",
		);
		expect(userPrompt).toContain("DB 変更の完了条件");
		expect(userPrompt).toContain("## Plan View References");
		expect(userPrompt).toContain("API Contract: Todo API Contract");
		expect(userPrompt).toContain("## Plan Mode References");
		expect(userPrompt).toContain("Todo User Flow");
		expect(userPrompt).toContain(
			"後続レビューでテスト項目・検証ゴールとして使う",
		);
		expect(userPrompt).toContain(
			"レビュー時に条件ごとのテスト有無を判定できる形",
		);
		expect(userPrompt).toContain("verify / verify:base がある場合は代表 gate");
		expect(userPrompt).toContain("verify 系 script 追加を実装計画に入れる");
		expect(userPrompt).toContain("同じ目的の command を重複列挙しない");
		const systemPrompt = buildSpecificationDocumentSystemPrompt();
		expect(systemPrompt).toContain("最終文書に全件列挙せず");
		expect(systemPrompt).toContain("未決定事項は極力作らず");
		expect(systemPrompt).toContain("API / UI / DB / validation の詳細");
	});

	it("removes orchestration app names from generated target wording for other projects", () => {
		const content = [
			"# Todo List 本体 実装前設計書",
			"",
			"## 目的",
			"NightWorkers に Todo List 本体を追加する。",
			"NightWorker の既存画面ではなく todo ドメインを作る。",
		].join("\n");
		const sanitized = sanitizeSpecificationTargetNaming(
			content,
			[
				"Target Project Context",
				"- Project name: todolist",
				"- Project root: /Users/y.noguchi/Code/todolist",
			].join("\n"),
		);

		expect(sanitized).not.toContain("NightWorkers");
		expect(sanitized).not.toContain("NightWorker");
		expect(sanitized).toContain(
			"対象プロジェクト（todolist） に Todo List 本体を追加する。",
		);
		expect(sanitized).toContain("対象プロジェクト（todolist） の既存画面");
	});

	it("keeps orchestration app names when the target project is NightWorkers itself", () => {
		const content = "NightWorkers の Plan Mode を修正する。";
		const sanitized = sanitizeSpecificationTargetNaming(
			content,
			[
				"Target Project Context",
				"- Project name: nightWorkers",
				"- Project root: /Users/y.noguchi/Code/nightWorkers",
			].join("\n"),
		);

		expect(sanitized).toBe(content);
	});
});
