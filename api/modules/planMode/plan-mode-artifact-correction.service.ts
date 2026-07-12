import type { PlanModeRegenerationTarget } from "../../../shared/schemas/plan-mode-artifact.schema";
import type { PlanModeArtifactFocus } from "../../../shared/schemas/plan-mode-artifact-correction.schema";
import type { StructuredLlmModelTarget } from "../../services/structured-llm/settings";
import { generateBlueprintArtifact } from "../blueprint/blueprint-generation.service";
import { generateDataModelArtifact } from "../dataModel/dataModel-generation.service";
import { generatePlanViewArtifact } from "../planViews/planView-generation.service";
import { generateFeaturePlanArtifact } from "../specification/specification-generation.service";

export type PlanModeArtifactCorrectionInput = {
	taskId: string;
	target: PlanModeRegenerationTarget;
	prompt: string;
	focus?: PlanModeArtifactFocus;
	correlationId?: string | null;
	questionnaireSessionId?: string | null;
	featurePlanMessageId?: string | null;
	sourceBlueprintMessageId?: string | null;
	sourceDataModelMessageId?: string | null;
	routeOverride?: StructuredLlmModelTarget | null;
};

function renderCorrectionPrompt(input: PlanModeArtifactCorrectionInput) {
	const focus = input.focus ?? { kind: "artifact" as const };
	const focusText =
		focus.kind === "artifact"
			? "Artifact全体"
			: focus.kind === "screen"
				? `画面: ${focus.screenIds.join(", ")}`
				: `画面: ${focus.screenIds.join(", ")} / Section: ${focus.sectionIds.join(", ")}`;
	return [
		"[対象Artifact]",
		input.target,
		"[フォーカス]",
		focusText,
		"[変更要求]",
		input.prompt.trim(),
		"[不変条件]",
		"確定QuestionnaireとTask acceptance criteriaは変更しないでください。",
		"対象外のArtifact、画面、Sectionを変更せず、ついで対応や過剰拡張を行わないでください。",
		"repository source codeを編集せず、対象Plan Artifactだけを再生成してください。",
	].join("\n");
}

export async function executePlanModeArtifactCorrection(
	input: PlanModeArtifactCorrectionInput,
) {
	const prompt = renderCorrectionPrompt(input);
	switch (input.target) {
		case "feature_plan":
			return generateFeaturePlanArtifact(input.taskId, {
				prompt,
				questionnaireSessionId: input.questionnaireSessionId,
				sourceBlueprintMessageId: input.sourceBlueprintMessageId,
				routeOverride: input.routeOverride,
			});
		case "blueprint":
			return generateBlueprintArtifact(input.taskId, {
				prompt,
				questionnaireSessionId: input.questionnaireSessionId,
				sourceBlueprintMessageId: input.sourceBlueprintMessageId,
				routeOverride: input.routeOverride,
			});
		case "data_model":
			return generateDataModelArtifact(input.taskId, {
				prompt,
				questionnaireSessionId: input.questionnaireSessionId,
				featurePlanMessageId: input.featurePlanMessageId,
				sourceBlueprintMessageId: input.sourceBlueprintMessageId,
				routeOverride: input.routeOverride,
			});
		case "user_flow":
		case "api_io_contract":
		case "activity_flow":
		case "sequence_flow":
		case "zod_schema_design":
			return generatePlanViewArtifact(input.taskId, input.target, {
				prompt,
				questionnaireSessionId: input.questionnaireSessionId,
				featurePlanMessageId: input.featurePlanMessageId,
				sourceBlueprintMessageId: input.sourceBlueprintMessageId,
				sourceDataModelMessageId: input.sourceDataModelMessageId,
				routeOverride: input.routeOverride,
			});
	}
}
