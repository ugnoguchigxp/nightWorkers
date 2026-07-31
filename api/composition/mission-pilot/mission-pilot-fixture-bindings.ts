import { renderLlmFixtureText } from "../../e2eFixtures/llmCatalog/catalog";
import { registerFixtureProviderToolTurns } from "../../services/structured-llm/fixture-tool-provider";

export function createMissionPilotFixtureBindings() {
	return {
		registerFixtureProviderToolTurns,
		renderLlmFixtureText,
	};
}
