import { describe, expect, it } from "vitest";
import {
	digestFeaturePlanContent,
	featurePlanMarkdownDraftSchema,
	readFeaturePlanTitle,
} from "../api/modules/specification/feature-plan-content";

describe("Feature Plan Markdown content", () => {
	it("accepts Markdown as the only required generated value", () => {
		const result = featurePlanMarkdownDraftSchema.parse({
			markdown: "# Todo Feature Plan\n\n## 実装計画\n\n1. Todoを実装する",
		});

		expect(result.markdown).toContain("## 実装計画");
	});

	it("does not reject transport metadata that is unrelated to the document", () => {
		const result = featurePlanMarkdownDraftSchema.parse({
			markdown: "# Feature Plan",
			providerNote: "ignored by the artifact writer",
		});

		expect(result.providerNote).toBe("ignored by the artifact writer");
	});

	it("rejects blank Markdown", () => {
		expect(
			featurePlanMarkdownDraftSchema.safeParse({ markdown: "   " }).success,
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
