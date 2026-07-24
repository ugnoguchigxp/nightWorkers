import type { ProjectExplorationCatalogRunPin } from "../../../../shared/schemas/project-exploration-catalog.schema";
import {
	p as defaultP,
	type SystemContextP,
} from "../../../systemContexts/catalog";

export const PROJECT_EXPLORATION_AGENT_WORKFLOW_VERSION = 1;

export type ProjectExplorationAgentWorkflow =
	| {
			version: 1;
			capability: "project_exploration_catalog";
			availability: "available";
			instructionsJa: string[];
	  }
	| {
			version: 1;
			capability: "project_exploration_catalog";
			availability: "unavailable";
			reason: string;
			instructionsJa: string[];
	  };

export function buildProjectExplorationAgentWorkflow(
	pin: ProjectExplorationCatalogRunPin | null,
	p: SystemContextP = defaultP,
): ProjectExplorationAgentWorkflow {
	if (pin?.version === 2 && pin.available) {
		return {
			version: PROJECT_EXPLORATION_AGENT_WORKFLOW_VERSION,
			capability: "project_exploration_catalog",
			availability: "available",
			instructionsJa: p("codingAgent.project-exploration-available", {})
				.trimEnd()
				.split("\n"),
		};
	}
	return {
		version: PROJECT_EXPLORATION_AGENT_WORKFLOW_VERSION,
		capability: "project_exploration_catalog",
		availability: "unavailable",
		reason: pin && !pin.available ? pin.reason : "run_capability_missing",
		instructionsJa: [
			p("codingAgent.project-exploration-unavailable", {}).trimEnd(),
		],
	};
}
