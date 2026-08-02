import { describe, expect, it } from "vitest";
import { projectPlanArtifactInput } from "../api/modules/specification/plan-artifact-input-projection";
import {
	buildPlanArtifactPromptBudgetMetadata,
	renderPlanArtifactInput,
} from "../api/modules/specification/plan-artifact-input-renderer";
import { selectPlanArtifactSourceContent } from "../api/modules/specification/plan-artifact-source-selection";
import { createTodoListPlanArtifactCanonicalInput } from "./fixtures/plan-artifact-input/todolist-session";

describe("plan artifact input projection", () => {
	it("renders canonical sections without duplicate task prompt or broad references", () => {
		const canonical = createTodoListPlanArtifactCanonicalInput();
		const projection = projectPlanArtifactInput(canonical);
		const rendered = renderPlanArtifactInput(projection);

		expect(
			rendered.prompt.match(new RegExp(canonical.task.initialPrompt, "g")),
		).toHaveLength(1);
		expect(projection.questionnaireDecisions).toHaveLength(10);
		expect(rendered.prompt).toContain("Answer 10");
		expect(rendered.prompt).toContain("Materialization state: empty");
		expect(rendered.prompt).toContain(
			"計画上の制約はQuestionnaire Decisionsを正とします。",
		);
		expect(rendered.prompt).not.toContain("Decision key:");
		expect(rendered.prompt).not.toContain("Why:");
		expect(rendered.prompt).not.toContain("Section:");
		expect(rendered.prompt).not.toContain("Deferred: no");
		expect(rendered.prompt).not.toContain("Root:");
		expect(rendered.prompt).not.toContain("Package scripts:");
		expect(rendered.prompt).not.toContain("questionnaireSessionId");
		expect(rendered.prompt).not.toContain("unselected");
		expect(projection.provenance.sourceMessageIds).toEqual([
			"00000000-0000-4000-8000-000000000010",
			"00000000-0000-4000-8000-000000000011",
			"00000000-0000-4000-8000-000000000012",
		]);
	});

	it("keeps regeneration instructions separate and deduplicates sources", () => {
		const canonical = createTodoListPlanArtifactCanonicalInput({
			regenerationRequest: "期限の扱いを明確にして再生成する",
			sources: [
				...createTodoListPlanArtifactCanonicalInput().sources,
				createTodoListPlanArtifactCanonicalInput().sources[0],
			],
		});
		const projection = projectPlanArtifactInput(canonical);
		const rendered = renderPlanArtifactInput(projection);

		expect(rendered.prompt).toContain("## Regeneration Request");
		expect(rendered.prompt).toContain("期限の扱いを明確にして再生成する");
		expect(projection.sourceArtifacts).toHaveLength(3);
		expect(projection.diagnostics.deduplicatedSourceCount).toBe(3);
		expect(projection.diagnostics.initialPromptOccurrences).toBe(1);
	});

	it("deduplicates exact task baseline values without semantic rewriting", () => {
		const canonical = createTodoListPlanArtifactCanonicalInput();
		canonical.task.description = canonical.task.initialPrompt;
		canonical.task.acceptanceCriteria = canonical.task.initialPrompt;
		const rendered = renderPlanArtifactInput(
			projectPlanArtifactInput(canonical),
		);

		expect(
			rendered.prompt.match(new RegExp(canonical.task.initialPrompt, "g")),
		).toHaveLength(1);
		expect(rendered.prompt).not.toContain("Description:");
		expect(rendered.prompt).not.toContain("Acceptance criteria:");
	});

	it("preserves the canonical initial prompt while deduplicating by trimmed value", () => {
		const canonical = createTodoListPlanArtifactCanonicalInput();
		canonical.task.initialPrompt = "  Todo一覧に期限を追加する  ";
		canonical.task.description = "Todo一覧に期限を追加する";
		const rendered = renderPlanArtifactInput(
			projectPlanArtifactInput(canonical),
		);

		expect(rendered.prompt).toContain(
			"Initial prompt:   Todo一覧に期限を追加する  ",
		);
		expect(rendered.prompt).not.toContain("Description:");
		expect(rendered.diagnostics.initialPromptOccurrences).toBe(1);
	});

	it("removes initial prompt copies from source artifacts", () => {
		const canonical = createTodoListPlanArtifactCanonicalInput({
			sources: [
				{
					...createTodoListPlanArtifactCanonicalInput().sources[0],
					renderedContent:
						"Blueprint\nTodo一覧に期限と完了状態を追加する\nTodo一覧に期限と完了状態を追加する",
				},
			],
		});
		const projection = projectPlanArtifactInput(canonical);
		const rendered = renderPlanArtifactInput(projection);

		expect(
			rendered.prompt.match(new RegExp(canonical.task.initialPrompt, "g")),
		).toHaveLength(1);
		expect(rendered.prompt).not.toContain(
			"Blueprint\nTodo一覧に期限と完了状態を追加する",
		);
	});

	it("does not drop accepted questionnaire decisions when stack detection is empty", () => {
		const projection = projectPlanArtifactInput(
			createTodoListPlanArtifactCanonicalInput({
				target: "data_model",
				project: {
					...createTodoListPlanArtifactCanonicalInput().project,
					materializationState: "empty",
					detectedStack: null,
				},
			}),
		);

		expect(projection.questionnaireDecisions).toHaveLength(10);
		expect(projection.projectContext.detectedStack).toBeNull();
		const metadata = buildPlanArtifactPromptBudgetMetadata({
			projection,
			systemPrompt: "system",
			userPrompt: "user",
		});
		expect(metadata.compressionProfile).toBe(
			"plan-artifact-input-v1-source-summary",
		);
	});

	it("records projection diagnostics without rejecting an over-budget prompt", () => {
		const baseline = createTodoListPlanArtifactCanonicalInput();
		const projection = projectPlanArtifactInput(
			createTodoListPlanArtifactCanonicalInput({
				project: {
					...baseline.project,
					packageScripts: [{ name: "test", command: "vitest run" }],
				},
				sources: [
					{
						kind: "blueprint",
						messageId: "00000000-0000-4000-8000-000000000099",
						digest: "sha256:large",
						routingRevision: 4,
						renderedContent: "x".repeat(40_000),
					},
				],
			}),
		);
		const metadata = buildPlanArtifactPromptBudgetMetadata({
			projection,
			systemPrompt: "system",
			userPrompt: "small",
			providerJsonSchema: {
				type: "object",
				additionalProperties: false,
				properties: {},
			},
		});

		expect(metadata.artifactProjection).toMatchObject({
			version: 1,
			target: "api_io_contract",
			sourceCount: 1,
			deduplicatedSourceCount: 1,
			questionnaireDecisionCount: 10,
			initialPromptOccurrences: 0,
			staleSourceRejectedCount: 0,
		});
		expect(metadata.droppedFields).toEqual(
			expect.arrayContaining([
				"questionnaire.decisionKey",
				"questionnaire.why",
				"project.root",
				"project.packageScripts",
			]),
		);
		expect(metadata.providerSchemaBytes).toBeGreaterThan(0);
		expect(metadata.estimatedVisibleInputTokens).toBe(
			metadata.estimatedPromptTokensBefore +
				(metadata.estimatedProviderSchemaTokens ?? 0),
		);
		const overBudgetPrompt = "x".repeat(
			(metadata.safePromptBudgetTokens + 1) * 4,
		);
		const overBudgetMetadata = buildPlanArtifactPromptBudgetMetadata({
			projection,
			systemPrompt: "system",
			userPrompt: overBudgetPrompt,
		});

		expect(overBudgetMetadata.budgetExceeded).toBe(true);
		expect(overBudgetMetadata.estimatedPromptTokensBefore).toBeGreaterThan(
			overBudgetMetadata.safePromptBudgetTokens,
		);
		const schemaOverBudgetMetadata = buildPlanArtifactPromptBudgetMetadata({
			projection,
			systemPrompt: "system",
			userPrompt: "small",
			providerJsonSchema: { description: "x".repeat(1_000_000) },
		});

		expect(schemaOverBudgetMetadata.estimatedPromptTokensBefore).toBeLessThan(
			schemaOverBudgetMetadata.safePromptBudgetTokens,
		);
		expect(schemaOverBudgetMetadata.budgetExceeded).toBe(true);
	});

	it("does not silently truncate oversized source bodies before the budget gate", () => {
		const baselineProjection = projectPlanArtifactInput(
			createTodoListPlanArtifactCanonicalInput(),
		);
		const safePromptBudgetTokens = buildPlanArtifactPromptBudgetMetadata({
			projection: baselineProjection,
			systemPrompt: "system",
			userPrompt: "small",
		}).safePromptBudgetTokens;
		const projection = projectPlanArtifactInput(
			createTodoListPlanArtifactCanonicalInput({
				sources: [
					{
						...createTodoListPlanArtifactCanonicalInput().sources[0],
						renderedContent: `# Blueprint\n${"detail\n".repeat(
							safePromptBudgetTokens,
						)}`,
					},
				],
			}),
		);
		const rendered = renderPlanArtifactInput(projection);

		expect(rendered.prompt).toContain("detail\ndetail\ndetail");
		expect(rendered.prompt).not.toContain("Artifact summary omitted bytes");
		const metadata = buildPlanArtifactPromptBudgetMetadata({
			projection,
			systemPrompt: "system",
			userPrompt: rendered.prompt,
		});

		expect(metadata.budgetExceeded).toBe(true);
		expect(metadata.criticalEvidenceDropped).toBe(0);
	});

	it("uses a type-aware canonical summary for oversized structured sources", () => {
		const selected = selectPlanArtifactSourceContent({
			content: "raw blueprint body\n".repeat(2_000),
			metadataJson: {
				mockBlueprint: {
					name: "Todo App",
					summary: "期限と完了状態を扱うTodoアプリ",
					pages: [{ name: "Todo List", purpose: "Todoを管理する" }],
				},
			},
			kind: "blueprint",
			target: "data_model",
		});

		expect(selected.contentMode).toBe("canonical_summary");
		expect(selected.renderedContent).toContain("Artifact canonical summary");
		expect(selected.renderedContent).toContain("Todo App");
		expect(selected.renderedContent).not.toContain("raw blueprint body");
		expect(selected.renderedContent).not.toContain("Artifact original bytes");
		expect(Buffer.byteLength(selected.renderedContent, "utf8")).toBeLessThan(
			selected.originalBytes,
		);
	});

	it("preserves an oversized API Contract source without a canonical summary", () => {
		const content = "unstructured source\n".repeat(2_000);
		const selected = selectPlanArtifactSourceContent({
			content,
			metadataJson: null,
			kind: "feature_plan",
			target: "api_io_contract",
		});

		expect(selected.contentMode).toBe("raw");
		expect(selected.renderedContent).toContain("unstructured source");
		expect(selected.originalBytes).toBe(Buffer.byteLength(content, "utf8"));
	});

	it("reports rendered prompt section sizes after source compression", () => {
		const canonical = createTodoListPlanArtifactCanonicalInput();
		canonical.sources[0] = {
			...canonical.sources[0],
			contentMode: "canonical_summary",
			originalBytes: 20_000,
			renderedContent: "[Artifact canonical summary]\nshort source",
		};
		const projection = projectPlanArtifactInput(canonical);
		const rendered = renderPlanArtifactInput(projection);
		const metadata = buildPlanArtifactPromptBudgetMetadata({
			projection,
			systemPrompt: "system",
			userPrompt: rendered.prompt,
		});

		expect(metadata.compressedSections).toContain("sourceArtifacts");
		expect(metadata.artifactProjection?.sectionBytes).toEqual(
			rendered.diagnostics.sectionBytes,
		);
		expect(
			metadata.artifactProjection?.sectionBytes.sourceArtifacts,
		).toBeLessThan(projection.diagnostics.sectionBytes.sourceArtifacts);
		expect(rendered.prompt).toContain("messageId=");
		expect(rendered.prompt).toContain("digest=");
	});
});
