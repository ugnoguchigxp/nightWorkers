import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getPlanModeTask: vi.fn(),
	getPlanModeTaskMessage: vi.fn(),
	resolvePlanModeRoutingSnapshot: vi.fn(),
	renderMessageReferenceSummary: vi.fn(),
	getMessageApiContract: vi.fn(),
	getMessageBlueprint: vi.fn(),
	getMessageDataModelArtifact: vi.fn(),
	isRecord: vi.fn(),
}));

vi.mock("../api/modules/nightworkers/nightworkers.plan-mode-core.port", () => ({
	getPlanModeTask: mocks.getPlanModeTask,
	getPlanModeTaskMessage: mocks.getPlanModeTaskMessage,
}));

vi.mock("../api/modules/specification/plan-artifact-input-renderer", () => ({
	PLAN_ARTIFACT_SOURCE_SUMMARY_MAX_BYTES: 64,
}));

vi.mock("../api/modules/specification/plan-mode-routing-query", () => ({
	resolvePlanModeRoutingSnapshot: mocks.resolvePlanModeRoutingSnapshot,
}));

vi.mock(
	"../api/modules/specification/specification-plan-reference-renderer",
	() => ({
		renderMessageReferenceSummary: mocks.renderMessageReferenceSummary,
	}),
);

vi.mock(
	"../api/modules/specification/specification-schema-reference-renderer",
	() => ({
		getMessageApiContract: mocks.getMessageApiContract,
		getMessageBlueprint: mocks.getMessageBlueprint,
		getMessageDataModelArtifact: mocks.getMessageDataModelArtifact,
		isRecord: mocks.isRecord,
	}),
);

import {
	createPlanArtifactSourceSelection,
	emptyPlanArtifactSourceSelection,
	resolvePlanArtifactSources,
	selectPlanArtifactSourceContent,
} from "../api/modules/specification/plan-artifact-source-selection";

const task = { id: "task-1" };

function message(
	id: string,
	metadataJson: unknown,
	content: string | null = `content:${id}`,
) {
	return { id, taskId: task.id, metadataJson, content };
}

function selection(
	input: Partial<ReturnType<typeof emptyPlanArtifactSourceSelection>> = {},
) {
	return { ...emptyPlanArtifactSourceSelection(), ...input };
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.getPlanModeTask.mockResolvedValue(task);
	mocks.resolvePlanModeRoutingSnapshot.mockResolvedValue({ entries: [] });
	mocks.getPlanModeTaskMessage.mockResolvedValue(null);
	mocks.renderMessageReferenceSummary.mockReturnValue(
		"short canonical summary",
	);
	mocks.getMessageApiContract.mockReturnValue(null);
	mocks.getMessageBlueprint.mockReturnValue(null);
	mocks.getMessageDataModelArtifact.mockReturnValue(null);
	mocks.isRecord.mockImplementation(
		(value: unknown) =>
			Boolean(value) && typeof value === "object" && !Array.isArray(value),
	);
});

describe("plan artifact source selection extra coverage", () => {
	it("creates empty and explicit selections with all defaults and overrides", () => {
		expect(emptyPlanArtifactSourceSelection()).toEqual({
			previousTargetMessageId: null,
			featurePlanMessageId: null,
			blueprintMessageId: null,
			dataModelMessageId: null,
			dedicatedViewMessageIds: [],
			policy: "explicit_request",
		});
		expect(emptyPlanArtifactSourceSelection("routing_default")).toMatchObject({
			policy: "routing_default",
		});
		expect(createPlanArtifactSourceSelection({})).toEqual(
			emptyPlanArtifactSourceSelection(),
		);
		expect(
			createPlanArtifactSourceSelection({
				policy: "routing_default",
				previousTargetMessageId: "previous",
				featurePlanMessageId: "feature",
				blueprintMessageId: "blueprint",
				dataModelMessageId: "data",
				dedicatedViewMessageIds: ["view-1", "view-2"],
			}),
		).toEqual({
			policy: "routing_default",
			previousTargetMessageId: "previous",
			featurePlanMessageId: "feature",
			blueprintMessageId: "blueprint",
			dataModelMessageId: "data",
			dedicatedViewMessageIds: ["view-1", "view-2"],
		});
		expect(
			createPlanArtifactSourceSelection({
				previousTargetMessageId: null,
				featurePlanMessageId: null,
				blueprintMessageId: null,
				dataModelMessageId: null,
			}),
		).toEqual(emptyPlanArtifactSourceSelection());
	});

	it("returns trimmed raw content at and under the summary byte threshold", () => {
		const short = selectPlanArtifactSourceContent({
			content: "  short content  ",
			metadataJson: null,
			kind: "feature_plan",
			target: "data_model",
		});
		expect(short).toEqual({
			renderedContent: "short content",
			contentMode: "raw",
			originalBytes: 17,
		});
		const boundary = "x".repeat(64);
		expect(
			selectPlanArtifactSourceContent({
				content: boundary,
				metadataJson: {},
				kind: "dedicated_view",
				target: "plan_review",
			}),
		).toMatchObject({ renderedContent: boundary, contentMode: "raw" });
	});

	it("selects canonical summaries for every source and target renderer mode", () => {
		const content = `  ${"x".repeat(100)}  `;
		mocks.getMessageBlueprint.mockReturnValue({ blueprint: true });
		mocks.getMessageDataModelArtifact.mockReturnValue({ dataModel: true });
		mocks.getMessageApiContract.mockReturnValue({ api: true });
		const cases = [
			{ kind: "blueprint", target: "data_model", mode: "blueprint" },
			{ kind: "feature_plan", target: "data_model", mode: "feature_plan" },
			{ kind: "data_model", target: "blueprint", mode: "dedicated_view" },
			{ kind: "previous_target", target: "blueprint", mode: "blueprint" },
			{
				kind: "previous_target",
				target: "feature_plan",
				mode: "feature_plan",
			},
			{
				kind: "previous_target",
				target: "api_io_contract",
				mode: "dedicated_view",
			},
			{
				kind: "previous_target",
				target: "data_model",
				mode: "dedicated_view",
			},
			{
				kind: "dedicated_view",
				target: "plan_review",
				mode: "decision_review",
			},
			{ kind: "dedicated_view", target: "data_model", mode: "dedicated_view" },
		] as const;
		for (const value of cases) {
			mocks.renderMessageReferenceSummary.mockReturnValueOnce(
				`summary:${value.mode}`,
			);
			const selected = selectPlanArtifactSourceContent({
				content,
				metadataJson: {
					markdownDocumentData: {},
					view: value.target,
				},
				kind: value.kind,
				target: value.target,
			});
			expect(selected).toMatchObject({
				contentMode: "canonical_summary",
				renderedContent: expect.stringContaining(`summary:${value.mode}`),
			});
			expect(mocks.renderMessageReferenceSummary).toHaveBeenLastCalledWith(
				expect.objectContaining({ id: "source", content: "x".repeat(100) }),
				value.mode,
			);
		}
	});

	it("falls back to raw oversized content for absent or inefficient summaries", () => {
		const content = "x".repeat(100);
		mocks.isRecord.mockReturnValue(false);
		let selected = selectPlanArtifactSourceContent({
			content,
			metadataJson: null,
			kind: "feature_plan",
			target: "data_model",
		});
		expect(selected).toMatchObject({
			contentMode: "raw",
			renderedContent: content,
		});
		expect(mocks.renderMessageReferenceSummary).not.toHaveBeenCalled();

		mocks.isRecord.mockReturnValue(true);
		for (const summary of ["", "y".repeat(100), "z".repeat(65)]) {
			mocks.renderMessageReferenceSummary.mockReturnValueOnce(summary);
			selected = selectPlanArtifactSourceContent({
				content,
				metadataJson: {},
				kind: "dedicated_view",
				target: "data_model",
			});
			expect(selected.contentMode).toBe("raw");
		}
	});

	it("recognizes every canonical summary metadata variant", () => {
		const content = "x".repeat(100);
		mocks.renderMessageReferenceSummary.mockReturnValue("summary");
		const featureVariants = [
			{ markdownDocumentData: {} },
			{ markdown: "# Feature" },
		];
		for (const metadataJson of featureVariants) {
			expect(
				selectPlanArtifactSourceContent({
					content,
					metadataJson,
					kind: "feature_plan",
					target: "data_model",
				}).contentMode,
			).toBe("canonical_summary");
		}
		mocks.getMessageBlueprint.mockReturnValueOnce(null);
		expect(
			selectPlanArtifactSourceContent({
				content,
				metadataJson: {},
				kind: "blueprint",
				target: "data_model",
			}).contentMode,
		).toBe("raw");
		mocks.getMessageDataModelArtifact.mockReturnValueOnce(null);
		expect(
			selectPlanArtifactSourceContent({
				content,
				metadataJson: {},
				kind: "data_model",
				target: "blueprint",
			}).contentMode,
		).toBe("raw");
		mocks.getMessageApiContract.mockReturnValueOnce(null);
		expect(
			selectPlanArtifactSourceContent({
				content,
				metadataJson: {},
				kind: "previous_target",
				target: "api_io_contract",
			}).contentMode,
		).toBe("raw");
	});

	it("validates Task existence and returns no sources for an empty request", async () => {
		mocks.getPlanModeTask.mockResolvedValueOnce(null);
		await expect(
			resolvePlanArtifactSources({
				taskId: "missing",
				target: "data_model",
				selection: emptyPlanArtifactSourceSelection(),
			}),
		).rejects.toMatchObject({ statusCode: 404, code: "TASK_NOT_FOUND" });

		await expect(
			resolvePlanArtifactSources({
				taskId: task.id,
				target: "data_model",
				selection: emptyPlanArtifactSourceSelection(),
			}),
		).resolves.toEqual([]);
		expect(mocks.resolvePlanModeRoutingSnapshot).toHaveBeenCalledWith(task);
	});

	it("resolves all source kinds in precedence order, deduplicates IDs, and maps revisions", async () => {
		const messages = new Map([
			[
				"shared",
				message("shared", {
					view: "data_model",
					generation: { inputProjection: { routingRevision: 7 } },
				}),
			],
			[
				"feature",
				message("feature", {
					intent: "feature_plan",
					generation: { inputProjection: { routingRevision: 7.5 } },
				}),
			],
			[
				"blueprint",
				message("blueprint", {
					intent: "app_blueprint",
					generation: null,
				}),
			],
			[
				"data",
				message("data", {
					artifactKind: "plan_mode_dedicated_view",
					view: "data_model",
				}),
			],
			[
				"view",
				message(
					"view",
					{ artifactKind: "plan_mode_api_contract", view: "api_io_contract" },
					null,
				),
			],
		]);
		mocks.getPlanModeTaskMessage.mockImplementation(async (id: string) =>
			messages.get(id),
		);
		mocks.resolvePlanModeRoutingSnapshot.mockResolvedValue({
			entries: [
				{ view: "data_model", decision: "include", capabilityEnabled: true },
				{ view: "feature_plan", decision: "include", capabilityEnabled: true },
				{ view: "blueprint", decision: "include", capabilityEnabled: true },
				{
					view: "api_io_contract",
					decision: "include",
					capabilityEnabled: true,
				},
			],
		});
		const result = await resolvePlanArtifactSources({
			taskId: task.id,
			target: "data_model",
			currentRoutingRevision: 7,
			selection: selection({
				previousTargetMessageId: "shared",
				featurePlanMessageId: "feature",
				blueprintMessageId: "blueprint",
				dataModelMessageId: "data",
				dedicatedViewMessageIds: ["view", "shared", "view"],
			}),
		});
		expect(result.map((source) => [source.kind, source.messageId])).toEqual([
			["previous_target", "shared"],
			["feature_plan", "feature"],
			["blueprint", "blueprint"],
			["data_model", "data"],
			["dedicated_view", "view"],
		]);
		expect(result[0]).toMatchObject({
			routingRevision: 7,
			digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
			contentMode: "raw",
		});
		expect(result[1]?.routingRevision).toBeNull();
		expect(result[4]).toMatchObject({ renderedContent: "", originalBytes: 0 });
		expect(mocks.getPlanModeTaskMessage).toHaveBeenCalledTimes(5);
	});

	it("accepts every artifact metadata discriminator and previous-target mapping", async () => {
		const cases = [
			{
				target: "feature_plan",
				key: "featurePlanMessageId",
				metadata: { intent: "feature_plan" },
			},
			{
				target: "blueprint",
				key: "blueprintMessageId",
				metadata: { intent: "mock_blueprint" },
			},
			{
				target: "data_model",
				key: "dataModelMessageId",
				metadata: { source: "data-model" },
			},
			{
				target: "data_model",
				key: "dataModelMessageId",
				metadata: { artifactType: "data_model" },
			},
			{
				target: "plan_review",
				key: "dedicatedViewMessageIds",
				metadata: { artifactKind: "plan_mode_dedicated_view" },
			},
			{
				target: "plan_review",
				key: "dedicatedViewMessageIds",
				metadata: { artifactKind: "plan_mode_zod_schema" },
			},
			{
				target: "blueprint",
				key: "previousTargetMessageId",
				metadata: { intent: "app_blueprint" },
			},
			{
				target: "blueprint",
				key: "previousTargetMessageId",
				metadata: { intent: "mock_blueprint" },
			},
			{
				target: "feature_plan",
				key: "previousTargetMessageId",
				metadata: { intent: "feature_plan" },
			},
			{
				target: "data_model",
				key: "previousTargetMessageId",
				metadata: { view: "data_model" },
			},
			{
				target: "data_model",
				key: "previousTargetMessageId",
				metadata: { artifactType: "data_model" },
			},
			{
				target: "api_io_contract",
				key: "previousTargetMessageId",
				metadata: { view: "api_io_contract" },
			},
			{
				target: "api_io_contract",
				key: "previousTargetMessageId",
				metadata: { artifactKind: "plan_mode_api_contract" },
			},
			{
				target: "zod_schema_design",
				key: "previousTargetMessageId",
				metadata: { view: "zod_schema_design" },
			},
			{
				target: "zod_schema_design",
				key: "previousTargetMessageId",
				metadata: { artifactKind: "plan_mode_zod_schema" },
			},
			{
				target: "plan_review",
				key: "previousTargetMessageId",
				metadata: { view: "plan_review" },
			},
		] as const;
		for (const [index, value] of cases.entries()) {
			const id = `case-${index}`;
			mocks.getPlanModeTaskMessage.mockResolvedValueOnce(
				message(id, value.metadata),
			);
			const selected =
				value.key === "dedicatedViewMessageIds"
					? selection({ dedicatedViewMessageIds: [id] })
					: selection({ [value.key]: id });
			await expect(
				resolvePlanArtifactSources({
					taskId: task.id,
					target: value.target,
					selection: selected,
				}),
			).resolves.toHaveLength(1);
		}
	});

	it("rejects missing, cross-task, mismatched, omitted, disabled, and stale sources", async () => {
		async function resolveFeature() {
			return resolvePlanArtifactSources({
				taskId: task.id,
				target: "feature_plan",
				currentRoutingRevision: 5,
				selection: selection({ featurePlanMessageId: "source-1" }),
			});
		}

		mocks.getPlanModeTaskMessage.mockResolvedValueOnce(null);
		await expect(resolveFeature()).rejects.toMatchObject({
			statusCode: 422,
			code: "PLAN_ARTIFACT_SOURCE_NOT_FOUND",
		});

		mocks.getPlanModeTaskMessage.mockResolvedValueOnce({
			...message("source-1", { intent: "feature_plan" }),
			taskId: "other-task",
		});
		await expect(resolveFeature()).rejects.toMatchObject({
			code: "PLAN_ARTIFACT_SOURCE_NOT_FOUND",
		});

		mocks.getPlanModeTaskMessage.mockResolvedValueOnce(
			message("source-1", null),
		);
		await expect(resolveFeature()).rejects.toMatchObject({
			statusCode: 422,
			code: "PLAN_ARTIFACT_SOURCE_KIND_MISMATCH",
		});

		mocks.getPlanModeTaskMessage.mockResolvedValueOnce(
			message("source-1", { intent: "feature_plan" }),
		);
		mocks.resolvePlanModeRoutingSnapshot.mockResolvedValueOnce({
			entries: [
				{ view: "feature_plan", decision: "omit", capabilityEnabled: true },
			],
		});
		await expect(resolveFeature()).rejects.toMatchObject({
			statusCode: 409,
			code: "PLAN_ARTIFACT_CONTEXT_STALE",
		});

		mocks.getPlanModeTaskMessage.mockResolvedValueOnce(
			message("source-1", { intent: "feature_plan" }),
		);
		mocks.resolvePlanModeRoutingSnapshot.mockResolvedValueOnce({
			entries: [
				{ view: "feature_plan", decision: "include", capabilityEnabled: false },
			],
		});
		await expect(resolveFeature()).rejects.toMatchObject({
			code: "PLAN_ARTIFACT_CONTEXT_STALE",
		});

		mocks.getPlanModeTaskMessage.mockResolvedValueOnce(
			message("source-1", {
				intent: "feature_plan",
				generation: { inputProjection: { routingRevision: 4 } },
			}),
		);
		await expect(resolveFeature()).rejects.toMatchObject({
			code: "PLAN_ARTIFACT_CONTEXT_STALE",
		});
	});

	it("allows null revision and unrouted dedicated views while rejecting invalid previous targets", async () => {
		mocks.getPlanModeTaskMessage.mockResolvedValueOnce(
			message("view", {
				artifactKind: "plan_mode_dedicated_view",
				generation: { inputProjection: { routingRevision: "invalid" } },
			}),
		);
		await expect(
			resolvePlanArtifactSources({
				taskId: task.id,
				target: "plan_review",
				currentRoutingRevision: 99,
				selection: selection({ dedicatedViewMessageIds: ["view"] }),
			}),
		).resolves.toMatchObject([{ routingRevision: null }]);

		mocks.getPlanModeTaskMessage.mockResolvedValueOnce(
			message("previous", null),
		);
		await expect(
			resolvePlanArtifactSources({
				taskId: task.id,
				target: "data_model",
				selection: selection({ previousTargetMessageId: "previous" }),
			}),
		).rejects.toMatchObject({ code: "PLAN_ARTIFACT_SOURCE_KIND_MISMATCH" });
	});
});
