import {
	createAppCatalog,
	type PromptKey,
	type PromptValueMap,
} from "./generated/catalog.generated";
import catalogArtifact from "./generated/catalog.json" with { type: "json" };

export type { PromptKey as LlmFixtureKey };

const fixtureCatalog = createAppCatalog(catalogArtifact as unknown);
const fixtureText = fixtureCatalog.bindText({
	instructionLocale: "ja-JP",
	fallbackLocales: [],
	trailingNewline: false,
});

export function renderLlmFixtureText<K extends PromptKey>(
	key: K,
	values: PromptValueMap[K],
): string {
	return fixtureText.p(key, values);
}
