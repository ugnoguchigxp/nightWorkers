import { describe, expect, it } from "vitest";
import {
	digestFeaturePlanContent,
	featurePlanMarkdownDraftSchema,
	readFeaturePlanTitle,
} from "../api/modules/specification/feature-plan-content";

describe("Feature Plan Markdown content", () => {
	it("requires one minimal structured implementation plan beside Markdown", () => {
		const result = featurePlanMarkdownDraftSchema.parse({
			markdown: "# Todo Feature Plan\n\n## 目的\nTodoを実装する。",
			implementationPlan: {
				steps: [
					{
						title: "Todoを実装する",
						systemContext: "既存のTodo契約に沿って実装する。",
					},
				],
			},
			repositoryMaterializationIntent: null,
		});

		expect(result.implementationPlan.steps[0]?.title).toBe("Todoを実装する");
	});

	it("rejects unrelated generated fields", () => {
		const result = featurePlanMarkdownDraftSchema.safeParse({
			markdown: "# Feature Plan",
			implementationPlan: {
				steps: [{ title: "実装する", systemContext: "仕様に沿って実装する。" }],
			},
			repositoryMaterializationIntent: null,
			providerNote: "ignored by the artifact writer",
		});

		expect(result.success).toBe(false);
	});

	it("rejects blank Markdown", () => {
		expect(
			featurePlanMarkdownDraftSchema.safeParse({
				markdown: "   ",
				implementationPlan: {
					steps: [
						{ title: "実装する", systemContext: "仕様に沿って実装する。" },
					],
				},
				repositoryMaterializationIntent: null,
			}).success,
		).toBe(false);
	});

	it("rejects line breaks in minimal plan fields", () => {
		expect(
			featurePlanMarkdownDraftSchema.safeParse({
				markdown: "# Feature Plan",
				implementationPlan: {
					steps: [
						{
							title: "実装する\n## 完了条件",
							systemContext: "仕様に沿って実装する。",
						},
					],
				},
				repositoryMaterializationIntent: null,
			}).success,
		).toBe(false);
	});

	it("derives title and content digest from the canonical Markdown", () => {
		const markdown = "# Todo Feature Plan\n\n## 目的\nTodoを実装する。";

		expect(readFeaturePlanTitle(markdown)).toBe("Todo Feature Plan");
		expect(digestFeaturePlanContent(markdown)).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(digestFeaturePlanContent(`${markdown}\n`)).not.toBe(
			digestFeaturePlanContent(markdown),
		);
	});
});
