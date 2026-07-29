import { describe, expect, it } from "vitest";
import { renderLlmFixtureText } from "../api/e2eFixtures/llmCatalog/catalog";
import { createAppCatalog } from "../api/e2eFixtures/llmCatalog/generated/catalog.generated";
import artifact from "../api/e2eFixtures/llmCatalog/generated/catalog.json" with {
	type: "json",
};

describe("test-only LLM fixture catalog", () => {
	it("renders ja-JP without adding a terminal newline", () => {
		const text = renderLlmFixtureText(
			"missionPilot.questionnaire.read-current",
			{},
		);
		expect(text).toBe("現在のTaskとQuestionnaireを確認します。");
		expect(Buffer.from(text).at(-1)).not.toBe(0x0a);
	});

	it("fails closed for an untranslated locale", () => {
		const catalog = createAppCatalog(artifact as unknown);
		const english = catalog.bindText({
			instructionLocale: "en-US",
			fallbackLocales: [],
			trailingNewline: false,
		});
		expect(() =>
			english.p("missionPilot.questionnaire.read-current", {}),
		).toThrow();
	});

	it("rejects an artifact whose digest no longer matches the generated factory", () => {
		const changed = structuredClone(artifact) as Record<string, unknown>;
		changed.catalogDigest = "sha256:invalid";
		expect(() => createAppCatalog(changed)).toThrow();
	});

	it("preserves intentional structured response bytes", () => {
		expect(renderLlmFixtureText("structured.plain-text", {})).toBe(
			"plain fixture text",
		);
		expect(renderLlmFixtureText("structured.malformed-json", {})).toBe(
			'{"answer":"ok"',
		);
	});
});
