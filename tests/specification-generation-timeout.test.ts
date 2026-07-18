import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppError } from "../api/lib/errors";
import { createPlanModeTaskMessage } from "../api/modules/nightworkers/nightworkers.plan-mode-core.port";
import {
	FEATURE_PLAN_LLM_TIMEOUT_MS,
	generateFeaturePlanArtifact,
} from "../api/modules/specification/specification-generation.service";
import { callStructuredOutputWithRepair } from "../api/services/structured-generation/structured-output-repair.service";
import { StructuredLlmTimeoutError } from "../api/services/structured-llm";

vi.mock(
	"../api/services/structured-generation/structured-output-repair.service",
	() => ({ callStructuredOutputWithRepair: vi.fn() }),
);

vi.mock(
	"../api/modules/nightworkers/nightworkers.verification.repository",
	() => ({
		createVerificationDocument: vi.fn(async () => ({})),
	}),
);

vi.mock("../api/modules/nightworkers/nightworkers.plan-mode-core.port", () => ({
	getPlanModeTask: vi.fn(async () => ({
		id: "task-1",
		repositoryId: "repo-1",
		title: "todo list 本体を実装する",
		description: "Hono + React + SQLite 構成に todo list 本体を追加する。",
		objective: "task の作成、編集、削除、完了切り替えを実装する。",
		status: "draft",
	})),
	listPlanModeTaskMessages: vi.fn(async () => []),
	createPlanModeTaskMessage: vi.fn(async (input) => ({
		id: "message-1",
		taskId: input.taskId,
		role: input.role,
		content: input.content,
		messageType: input.messageType,
		metadataJson: input.payloadJson,
		createdAt: new Date().toISOString(),
	})),
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getRepository: vi.fn(async () => ({
		id: "repo-1",
		name: "todolist",
		localPath: "/tmp/missing-todolist-repository",
	})),
}));

vi.mock(
	"../api/modules/nightworkers/nightworkers.plan-mode-settings.service",
	() => ({
		assertPlanModeCapabilityEnabled: vi.fn(),
	}),
);

vi.mock("../api/modules/specification/specification-mutability", () => ({
	assertPlanModeMutable: vi.fn(),
}));

vi.mock(
	"../api/modules/specification/specification-questionnaire-session",
	() => ({
		resolveOptionalReadyQuestionnaireSession: vi.fn(async () => null),
	}),
);

vi.mock("../api/modules/specification/plan-mode-project-stack-context", () => ({
	resolvePlanModeProjectStackContext: vi.fn(async () =>
		[
			"Target Project Context",
			"- Project name: todolist",
			"- Project root: /Users/y.noguchi/Code/todolist",
			"",
			"- 既存 Project stack: TypeScript + React + Vite + Hono",
		].join("\n"),
	),
}));

vi.mock("../api/modules/specification/plan-mode-workspace.service", () => ({
	getPlanModeWorkspace: vi.fn(async () => ({
		blueprintArtifacts: [],
		dataModelArtifacts: [],
		dedicatedViewArtifacts: [],
		featurePlanArtifacts: [],
	})),
}));

describe("Feature Plan generation timeout handling", () => {
	beforeEach(() => {
		vi.mocked(callStructuredOutputWithRepair).mockReset();
		vi.mocked(createPlanModeTaskMessage).mockClear();
	});

	it("uses an extended timeout for specification document generation", async () => {
		expect(FEATURE_PLAN_LLM_TIMEOUT_MS).toBe(180_000);
		vi.mocked(callStructuredOutputWithRepair).mockResolvedValueOnce({
			value: {
				title: "Todo List Feature Plan",
				contentTemplate:
					"# Todo List Feature Plan\n\n{{IMPLEMENTATION_PLAN}}\n\n## 検証計画\n- Run tests\n\n## 完了条件\n{{ACCEPTANCE_CRITERIA}}",
				acceptanceCriteria: fixtureAcceptanceCriteria(),
				implementationPlan: {
					version: 1,
					requiresDataMigration: false,
					steps: [
						{
							key: "todo-api",
							title: "Todo APIを実装する",
							description: "既存契約に沿ってTodo APIを追加する。",
							taskType: "implementation",
							dependsOnKeys: [],
						},
					],
				},
			},
			attempts: [],
		});

		await generateFeaturePlanArtifact("task-1");

		expect(callStructuredOutputWithRepair).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.any(String),
				userPrompt: expect.any(String),
				options: expect.objectContaining({
					role: "plan",
					timeoutMs: FEATURE_PLAN_LLM_TIMEOUT_MS,
				}),
			}),
		);
		const call = vi.mocked(callStructuredOutputWithRepair).mock.calls[0]?.[0];
		expect(call.options.contract.name).toBe("specification_document");
	});

	it("keeps sanitized implementation text identical in metadata and Markdown", async () => {
		vi.mocked(callStructuredOutputWithRepair).mockResolvedValueOnce({
			value: {
				title: "Todo List Feature Plan",
				contentTemplate:
					"## 目的\nNightWorkersへTodoを追加する。\n\n{{IMPLEMENTATION_PLAN}}\n\n## 完了条件\n{{ACCEPTANCE_CRITERIA}}",
				acceptanceCriteria: fixtureAcceptanceCriteria(),
				implementationPlan: {
					version: 1,
					requiresDataMigration: false,
					steps: [
						{
							key: "todo-api",
							title: "NightWorkers APIを実装する",
							description: "NightWorkersの既存契約へTodo APIを追加する。",
							taskType: "implementation",
							dependsOnKeys: [],
						},
					],
				},
			},
			attempts: [],
		});

		await generateFeaturePlanArtifact("task-1");

		const featurePlanCall = vi
			.mocked(createPlanModeTaskMessage)
			.mock.calls.find(
				([input]) => input.payloadJson?.intent === "feature_plan",
			)?.[0];
		if (!featurePlanCall)
			throw new Error("Feature Plan message was not created");
		const metadata = featurePlanCall.payloadJson?.implementationPlan as {
			steps: Array<{ title: string; description: string }>;
		};
		expect(metadata.steps[0]).toMatchObject({
			title: "対象プロジェクト APIを実装する",
			description: "対象プロジェクトの既存契約へTodo APIを追加する。",
		});
		expect(featurePlanCall.content).toContain(metadata.steps[0].title);
		expect(featurePlanCall.content).toContain(metadata.steps[0].description);
		expect(featurePlanCall.content).not.toMatch(/NightWorkers?/i);
	});

	it("returns a gateway timeout error when the provider aborts", async () => {
		vi.mocked(callStructuredOutputWithRepair).mockRejectedValueOnce(
			new StructuredLlmTimeoutError(FEATURE_PLAN_LLM_TIMEOUT_MS),
		);

		await expect(generateFeaturePlanArtifact("task-1")).rejects.toMatchObject({
			statusCode: 504,
			code: "SPECIFICATION_DOCUMENT_TIMEOUT",
			details: {
				failureKind: "provider_timeout",
				retryable: true,
				timeoutMs: 180_000,
			},
		} satisfies Partial<AppError>);
	});
});

function fixtureAcceptanceCriteria() {
	return [
		{
			title: "Todoを作成できる",
			category: "api" as const,
		},
	];
}
