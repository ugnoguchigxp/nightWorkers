import type { ProjectExplorationCatalogRunPin } from "../../../../shared/schemas/project-exploration-catalog.schema";

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

const AVAILABLE_INSTRUCTIONS_JA = [
	"current Todoが実装箇所、依存関係、関連testの特定を必要とし、候補fileがまだ十分に確定していない場合は、広いlist_dirやsearch_filesより先にproject_exploration_catalogを一度だけ呼んでください。",
	"focusはTodoとTaskから意味的に選び、既知のpath、module、domain用語を指定してください。候補fileが既に明確なら呼び出しを省略できます。",
	"catalogは候補情報です。編集前に候補fileをread_file等で確認し、成功したcatalogと同じ目的の広域探索を機械的に繰り返さないでください。",
	"catalogがunavailable、stale、degraded、または不十分なら、通常のworkspace探索へfail-openしてください。",
] as const;

const UNAVAILABLE_INSTRUCTIONS_JA = [
	"このrunではproject_exploration_catalogを呼ばず、通常のworkspace toolで探索してください。",
] as const;

export function buildProjectExplorationAgentWorkflow(
	pin: ProjectExplorationCatalogRunPin | null,
): ProjectExplorationAgentWorkflow {
	if (pin?.version === 2 && pin.available) {
		return {
			version: PROJECT_EXPLORATION_AGENT_WORKFLOW_VERSION,
			capability: "project_exploration_catalog",
			availability: "available",
			instructionsJa: [...AVAILABLE_INSTRUCTIONS_JA],
		};
	}
	return {
		version: PROJECT_EXPLORATION_AGENT_WORKFLOW_VERSION,
		capability: "project_exploration_catalog",
		availability: "unavailable",
		reason: pin && !pin.available ? pin.reason : "run_capability_missing",
		instructionsJa: [...UNAVAILABLE_INSTRUCTIONS_JA],
	};
}
