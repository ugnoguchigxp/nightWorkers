import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppError } from "../api/lib/errors";
import {
	createPlanModeTaskMessage,
	getPlanModeTaskMessage,
} from "../api/modules/nightworkers/nightworkers.plan-mode-core.port";
import { createVerificationDocument } from "../api/modules/nightworkers/nightworkers.verification.repository";
import { digestFeaturePlanContent } from "../api/modules/specification/feature-plan-content";
import { resolvePlanModeRoutingSnapshot } from "../api/modules/specification/plan-mode-routing-query";
import { getPlanModeWorkspace } from "../api/modules/specification/plan-mode-workspace.service";
import {
	FEATURE_PLAN_LLM_TIMEOUT_MS,
	generateFeaturePlanArtifact,
} from "../api/modules/specification/specification-generation.service";
import { callStructuredOutputWithRepair } from "../api/services/structured-generation/structured-output-repair.service";
import { StructuredLlmTimeoutError } from "../api/services/structured-llm";

vi.mock("../api/modules/gitworktree/repository-state.service", () => ({
	repositoryHasGitHead: vi.fn(async () => true),
}));

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
	getPlanModeRepository: vi.fn(async () => ({
		id: "repo-1",
		name: "todolist",
		localPath: "/tmp/missing-todolist-repository",
	})),
	getPlanModeTask: vi.fn(async () => ({
		id: "task-1",
		repositoryId: "repo-1",
		title: "todo list 本体を実装する",
		description: "Hono + React + SQLite 構成に todo list 本体を追加する。",
		objective: "task の作成、編集、削除、完了切り替えを実装する。",
		status: "draft",
	})),
	listPlanModeTaskMessages: vi.fn(async () => []),
	getPlanModeTaskMessage: vi.fn(),
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

vi.mock("../api/modules/specification/plan-mode-routing-query", () => ({
	resolvePlanModeRoutingSnapshot: vi.fn(async () => ({
		revision: 0,
		entries: [],
		editable: true,
		lockedReason: null,
		updatedBy: null,
		updatedAt: null,
	})),
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
		vi.mocked(createVerificationDocument).mockClear();
	});

	it("rejects generation before calling the LLM when a routed upstream Artifact is missing or stale", async () => {
		vi.mocked(getPlanModeWorkspace).mockResolvedValueOnce({
			blueprintArtifacts: [],
			dataModelArtifacts: [],
			dedicatedViewArtifacts: [{ kind: "api_io_contract", routingRevision: 2 }],
			featurePlanArtifacts: [],
			viewDecisions: [],
			routing: {
				revision: 3,
				entries: [
					{
						view: "api_io_contract",
						decision: "include",
						capabilityEnabled: true,
					},
				],
			},
		} as never);

		await expect(generateFeaturePlanArtifact("task-1")).rejects.toMatchObject({
			statusCode: 409,
			code: "PLAN_MODE_UPSTREAM_ARTIFACTS_REQUIRED",
			details: { missingViews: ["api_io_contract"] },
		});
		expect(callStructuredOutputWithRepair).not.toHaveBeenCalled();
	});

	it("rejects stale source ids instead of silently ignoring them", async () => {
		vi.mocked(getPlanModeWorkspace).mockResolvedValueOnce({
			blueprintArtifacts: [],
			dataModelArtifacts: [],
			dedicatedViewArtifacts: [
				{
					kind: "api_io_contract",
					sourceMessageId: "44444444-4444-4444-8444-444444444444",
					createdAt: "2026-08-01T00:00:00Z",
					routingRevision: 3,
				},
			],
			featurePlanArtifacts: [],
			viewDecisions: [],
			routing: {
				revision: 3,
				entries: [
					{
						view: "api_io_contract",
						decision: "include",
						capabilityEnabled: true,
					},
				],
			},
		} as never);

		await expect(
			generateFeaturePlanArtifact("task-1", {
				sourceSelection: {
					previousTargetMessageId: null,
					featurePlanMessageId: null,
					blueprintMessageId: null,
					dataModelMessageId: null,
					dedicatedViewMessageIds: ["55555555-5555-4555-8555-555555555555"],
					policy: "explicit_request",
				},
			}),
		).rejects.toMatchObject({
			statusCode: 409,
			code: "PLAN_ARTIFACT_CONTEXT_STALE",
		});
		expect(callStructuredOutputWithRepair).not.toHaveBeenCalled();
	});

	it("uses every current routed upstream Artifact even when the request omits source ids", async () => {
		const apiContractMessageId = "44444444-4444-4444-8444-444444444444";
		vi.mocked(getPlanModeWorkspace).mockResolvedValueOnce({
			blueprintArtifacts: [],
			dataModelArtifacts: [],
			dedicatedViewArtifacts: [
				{
					id: `api-io-contract-${apiContractMessageId}`,
					kind: "api_io_contract",
					title: "Todo API Contract",
					sourceMessageId: apiContractMessageId,
					createdAt: "2026-08-01T00:00:00Z",
					routingRevision: 3,
				},
			],
			featurePlanArtifacts: [],
			viewDecisions: [],
			routing: {
				revision: 3,
				entries: [
					{
						view: "api_io_contract",
						decision: "include",
						capabilityEnabled: true,
					},
				],
			},
		} as never);
		vi.mocked(resolvePlanModeRoutingSnapshot).mockResolvedValueOnce({
			revision: 3,
			entries: [
				{
					view: "api_io_contract",
					decision: "include",
					capabilityEnabled: true,
				},
			],
		} as never);
		vi.mocked(getPlanModeTaskMessage).mockResolvedValueOnce({
			id: apiContractMessageId,
			taskId: "task-1",
			content: '{"openapi":"3.1.0","paths":{"/api/todos":{}}}',
			metadataJson: {
				artifactKind: "plan_mode_api_contract",
				view: "api_io_contract",
				generation: { inputProjection: { routingRevision: 3 } },
			},
		} as never);
		vi.mocked(callStructuredOutputWithRepair).mockResolvedValueOnce({
			value: {
				markdown:
					"# Todo API Feature Plan\n\n## 完了条件\n\n- [AC-001][api] Todo APIを利用できる",
				implementationPlan: {
					steps: [
						{
							title: "Todo APIを実装する",
							systemContext: "API Contractに従って実装する。",
						},
					],
				},
				repositoryMaterializationIntent: null,
			},
			attempts: [],
		});

		await generateFeaturePlanArtifact("task-1");

		const request = vi.mocked(callStructuredOutputWithRepair).mock
			.calls[0]?.[0];
		expect(request?.userPrompt).toContain('"/api/todos"');
		expect(createPlanModeTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				payloadJson: expect.objectContaining({
					generation: expect.objectContaining({
						context: expect.objectContaining({
							inputProjection: expect.objectContaining({
								sourceMessageIds: [apiContractMessageId],
							}),
						}),
					}),
				}),
			}),
		);
	});

	it("uses an extended timeout for specification document generation", async () => {
		expect(FEATURE_PLAN_LLM_TIMEOUT_MS).toBe(300_000);
		const validDraft = {
			markdown:
				"# Todo List Feature Plan\n\n## 実装計画\n\n1. Todo APIを実装する\n\n## 検証計画\n\n- Run tests\n\n## 完了条件\n\n- [AC-001][api] Todoを作成できる",
			implementationPlan: {
				steps: [
					{
						title: "Todo APIを実装する",
						systemContext: "既存契約に従ってTodo APIを実装する。",
					},
				],
			},
		};
		vi.mocked(callStructuredOutputWithRepair).mockResolvedValueOnce({
			value: validDraft,
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
		expect(call.options.contract.name).toBe("feature_plan_markdown");
		expect(call.options.contract.providerJsonSchema).toMatchObject({
			type: "object",
			required: [
				"markdown",
				"implementationPlan",
				"repositoryMaterializationIntent",
			],
			additionalProperties: false,
			properties: {
				markdown: expect.objectContaining({ type: "string" }),
				implementationPlan: expect.any(Object),
				repositoryMaterializationIntent: expect.any(Object),
			},
		});
		expect(
			Object.keys(
				(
					call.options.contract.providerJsonSchema as {
						properties: Record<string, unknown>;
					}
				).properties,
			),
		).toEqual([
			"markdown",
			"implementationPlan",
			"repositoryMaterializationIntent",
		]);
		expect(
			call.options.contract.runtimeSchema.safeParse(validDraft).success,
		).toBe(true);
		expect(
			call.options.contract.runtimeSchema.safeParse({ markdown: " " }).success,
		).toBe(false);
	});

	it("stores one canonical Markdown document and only its digest in metadata", async () => {
		vi.mocked(callStructuredOutputWithRepair).mockResolvedValueOnce({
			value: {
				markdown:
					"# Todo List Feature Plan\n\n## 目的\nNightWorkersへTodoを追加する。\n\n## 実装計画\n\n1. NightWorkers APIを実装する\n\n## 完了条件\n\n- [AC-001][api] Todoを作成できる",
				implementationPlan: {
					steps: [
						{
							title: "NightWorkers APIを実装する",
							systemContext: "対象ProjectのAPI契約を実装する。",
						},
					],
				},
				repositoryMaterializationIntent: {
					kind: "starter_template",
					source: "starter",
					stack: "hono",
					initialize: true,
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
		expect(featurePlanCall.payloadJson?.implementationPlan).toEqual({
			steps: [
				{
					title: "対象プロジェクト APIを実装する",
					systemContext: "対象ProjectのAPI契約を実装する。",
				},
			],
		});
		expect(featurePlanCall.payloadJson).not.toHaveProperty(
			"acceptanceCriteria",
		);
		expect(featurePlanCall.payloadJson?.featurePlanContent).toEqual({
			version: 1,
			digest: digestFeaturePlanContent(featurePlanCall.content),
		});
		expect(
			featurePlanCall.payloadJson?.repositoryMaterializationIntent,
		).toEqual({
			kind: "starter_template",
			source: "starter",
			stack: "hono",
			initialize: true,
		});
		expect(featurePlanCall.content).toContain("対象プロジェクト APIを実装する");
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
				timeoutMs: 300_000,
			},
		} satisfies Partial<AppError>);
	});

	it("keeps the canonical Markdown when verification sidecar persistence fails", async () => {
		const markdown =
			"# Todo Feature Plan\n\n## 実装計画\n\n1. Todoを実装する\n\n## 完了条件\n\n- [AC-001][workflow] Todoを利用できる";
		vi.mocked(callStructuredOutputWithRepair).mockResolvedValueOnce({
			value: {
				markdown,
				implementationPlan: {
					steps: [
						{
							title: "Todoを実装する",
							systemContext: "確定済み仕様に従ってTodoを実装する。",
						},
					],
				},
			},
			attempts: [],
		});
		vi.mocked(createVerificationDocument).mockRejectedValueOnce(
			new Error("verification storage unavailable"),
		);

		const result = await generateFeaturePlanArtifact("task-1");

		expect(result.message.content).toContain("## 実装計画");
		expect(result.message.content).toContain("1. Todoを実装する");
		const featurePlanCall = vi
			.mocked(createPlanModeTaskMessage)
			.mock.calls.find(
				([input]) => input.payloadJson?.intent === "feature_plan",
			)?.[0];
		expect(featurePlanCall).toMatchObject({
			payloadJson: {
				verificationSidecarStatus: "pending",
			},
		});
	});
});
