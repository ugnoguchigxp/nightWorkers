import { describe, expect, it } from "vitest";
import {
	digestFeaturePlanContent,
	featurePlanMarkdownDraftSchema,
	readFeaturePlanTitle,
} from "../api/modules/specification/feature-plan-content";

describe("Feature Plan Markdown content", () => {
	const acceptanceCriteria = [
		{ title: "Todoを利用できる", category: "workflow" as const },
	];
	const markdown =
		"# Todo Feature Plan\n\n## 完了条件\n\n- [AC-001][workflow] Todoを利用できる";

	it("requires one minimal structured implementation plan beside Markdown", () => {
		const result = featurePlanMarkdownDraftSchema.parse({
			markdown,
			acceptanceCriteria,
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
			markdown,
			acceptanceCriteria,
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
				acceptanceCriteria,
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
				markdown,
				acceptanceCriteria,
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

	it("requires structured acceptance criteria for the Verification Document", () => {
		expect(
			featurePlanMarkdownDraftSchema.safeParse({
				markdown: "# Feature Plan",
				implementationPlan: {
					steps: [
						{ title: "実装する", systemContext: "仕様に沿って実装する。" },
					],
				},
				repositoryMaterializationIntent: null,
			}).success,
		).toBe(false);
	});

	it("rejects structured criteria that diverge from the Markdown authority", () => {
		expect(
			featurePlanMarkdownDraftSchema.safeParse({
				markdown,
				acceptanceCriteria: [
					{ title: "Todoを削除できる", category: "workflow" },
				],
				implementationPlan: {
					steps: [
						{ title: "実装する", systemContext: "仕様に沿って実装する。" },
					],
				},
				repositoryMaterializationIntent: null,
			}).success,
		).toBe(false);
	});

	it("rejects malformed or non-sequential completion-condition bullets", () => {
		for (const completionCondition of [
			"- Todoを利用できる",
			"- [AC-002][workflow] Todoを利用できる",
		]) {
			expect(
				featurePlanMarkdownDraftSchema.safeParse({
					markdown: `# Feature Plan\n\n## 完了条件\n\n${completionCondition}`,
					acceptanceCriteria,
					implementationPlan: {
						steps: [
							{
								title: "実装する",
								systemContext: "仕様に沿って実装する。",
							},
						],
					},
					repositoryMaterializationIntent: null,
				}).success,
			).toBe(false);
		}
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
