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
	});

	it("records projection diagnostics and rejects an over-budget prompt", () => {
		const projection = projectPlanArtifactInput(
			createTodoListPlanArtifactCanonicalInput({
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
		expect(() =>
			buildPlanArtifactPromptBudgetMetadata({
				projection,
				systemPrompt: "system",
				userPrompt: "x".repeat(40_000),
			}),
		).toThrowError(
			"Plan Artifact input exceeds the configured safe prompt budget.",
		);
	});

	it("does not silently truncate oversized source bodies before the budget gate", () => {
		const projection = projectPlanArtifactInput(
			createTodoListPlanArtifactCanonicalInput({
				sources: [
					{
						...createTodoListPlanArtifactCanonicalInput().sources[0],
						renderedContent: [
							"# Blueprint",
							...Array(20_000).fill("detail"),
						].join("\n"),
					},
				],
			}),
		);
		const rendered = renderPlanArtifactInput(projection);

		expect(rendered.prompt).toContain("detail\ndetail\ndetail");
		expect(rendered.prompt).not.toContain("Artifact summary omitted bytes");
		expect(() =>
			buildPlanArtifactPromptBudgetMetadata({
				projection,
				systemPrompt: "system",
				userPrompt: rendered.prompt,
			}),
		).toThrowError(
			"Plan Artifact input exceeds the configured safe prompt budget.",
		);
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
		expect(Buffer.byteLength(selected.renderedContent, "utf8")).toBeLessThan(
			selected.originalBytes,
		);
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
	});
});
