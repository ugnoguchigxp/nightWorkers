import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppError } from "../api/lib/errors";
import {
	FEATURE_PLAN_LLM_TIMEOUT_MS,
	generateFeaturePlanArtifact,
} from "../api/modules/specification/specification-generation.service";
import { callStructuredJsonLLM } from "../api/services/structured-llm";

vi.mock("../api/services/structured-llm", () => ({
	callStructuredJsonLLM: vi.fn(),
}));

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
		vi.mocked(callStructuredJsonLLM).mockReset();
	});

	it("uses an extended timeout for specification document generation", async () => {
		vi.mocked(callStructuredJsonLLM).mockResolvedValueOnce(
			JSON.stringify({
				title: "Todo List Feature Plan",
				content:
					"# Todo List Feature Plan\n\n## DDL\nData Model DDL reference は未生成です。",
			}),
		);

		await generateFeaturePlanArtifact("task-1");

		expect(callStructuredJsonLLM).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(String),
			expect.objectContaining({
				schemaName: "specification_document",
				role: "plan",
				timeoutMs: FEATURE_PLAN_LLM_TIMEOUT_MS,
			}),
		);
	});

	it("returns a gateway timeout error when the provider aborts", async () => {
		const abortError = new Error("The operation was aborted.");
		abortError.name = "AbortError";
		vi.mocked(callStructuredJsonLLM).mockRejectedValueOnce(abortError);

		await expect(generateFeaturePlanArtifact("task-1")).rejects.toMatchObject({
			statusCode: 504,
			code: "SPECIFICATION_DOCUMENT_TIMEOUT",
		} satisfies Partial<AppError>);
	});
});
