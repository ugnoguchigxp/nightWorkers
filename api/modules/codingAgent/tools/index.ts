export * from "./todo-list";

/**
 * Coding Agent exposes only repository tools and explicit Todo mutations.
 * Planning, Questionnaire, routing, and Artifact mutations are deliberately
 * absent from this catalog.
 */
export const codingAgentForbiddenPlanTools = Object.freeze([
	"plan_mode",
	"request_input",
	"update_routing",
	"generate_artifact",
]);
