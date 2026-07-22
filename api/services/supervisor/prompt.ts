import { bindSystemContextTextCatalog } from "../../systemContexts/catalog";
import { renderCodexAgentsGuidance } from "../codex-global-config/agents-guidance";
import {
	renderSupervisorSystemPrompt,
	type SupervisorPromptPacket,
} from "./prompt-packet";
import {
	jobTypeDescriptions,
	jobTypes,
	renderToolDefinitions,
	toolRegistry,
} from "./prompt-tool-registry";

export {
	getAllowedToolsForJobType,
	getExecutableWorkerToolName,
	initiallyImplementedJobTypes,
	type JobType,
	jobTypeDescriptions,
	jobTypes,
	renderToolDefinitions,
	type SupervisorToolName,
	type TodoToolName,
	type ToolDefinition,
	toolRegistry,
	validateToolCallForJobType,
} from "./prompt-tool-registry";

export function buildRound1JobTypePrompt(projectRoot: string): string {
	return renderSupervisorSystemPrompt(buildRound1PromptPacket(projectRoot));
}

export function buildRound1PromptPacket(
	projectRoot: string,
): SupervisorPromptPacket {
	const { p } = bindSystemContextTextCatalog();
	const codexGuidance = renderCodexAgentsGuidance(projectRoot, p).text;
	return {
		basePolicy: [
			p("supervisor.round1", {
				projectRoot,
				codexGuidance,
				jobTypes: jobTypes
					.map((jobType) => `- ${jobType}: ${jobTypeDescriptions[jobType]}`)
					.join("\n"),
				toolOverview: renderToolDefinitions(Object.values(toolRegistry)),
			}).trimEnd(),
		],
		roundPolicy: [],
		projectContext: [],
		runtimeContext: [],
		userRequest: [],
		executionEvidence: [],
		outputContract: [],
		diagnostics: {
			round: 1,
			projectRoot,
		},
	};
}
