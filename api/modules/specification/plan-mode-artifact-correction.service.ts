import type { PlanModeRegenerationTarget } from "../../../shared/schemas/plan-mode-artifact.schema";
import type { PlanModeArtifactFocus } from "../../../shared/schemas/plan-mode-artifact-correction.schema";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../services/structured-llm/settings";
import type { StructuredProviderExecutionPolicy } from "../agentsShare";
import { generateBlueprintArtifact } from "../blueprint";
import { generateDataModelArtifact } from "../dataModel/dataModel-generation.service";
import { generatePlanViewArtifact } from "../planViews/planView-generation.service";
import type { PlanArtifactSourceSelection } from "./plan-artifact-input.types";
import { generateFeaturePlanArtifact } from "./specification-generation.service";

export type PlanModeArtifactCorrectionInput = {
	taskId: string;
	target: PlanModeRegenerationTarget;
	prompt: string;
	focus?: PlanModeArtifactFocus;
	correlationId?: string | null;
	questionnaireSessionId?: string | null;
	sourceSelection: PlanArtifactSourceSelection;
	routeOverride?: StructuredLlmModelTarget | null;
	role?: StructuredLlmRole;
	executionPolicy?: StructuredProviderExecutionPolicy;
	trace?: TraceProvenance;
	llmUsageTrace?: TraceProvenance;
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
		"現在のArtifactで指摘されていない判断と内容は維持し、変更要求を満たす最小差分として再生成してください。",
		"repository source codeを編集せず、対象Plan Artifactだけを再生成してください。",
	].join("\n");
}

export async function executePlanModeArtifactCorrection(
	input: PlanModeArtifactCorrectionInput,
) {
	const prompt = renderCorrectionPrompt(input);
	const sourceSelection = input.sourceSelection;
	switch (input.target) {
		case "feature_plan":
			return generateFeaturePlanArtifact(input.taskId, {
				prompt,
				questionnaireSessionId: input.questionnaireSessionId,
				sourceSelection,
				routeOverride: input.routeOverride,
				role: input.role,
				executionPolicy: input.executionPolicy,
				trace: input.trace,
				llmUsageTrace: input.llmUsageTrace,
			});
		case "blueprint":
			return generateBlueprintArtifact(input.taskId, {
				prompt,
				questionnaireSessionId: input.questionnaireSessionId,
				sourceSelection,
				routeOverride: input.routeOverride,
				role: input.role,
				executionPolicy: input.executionPolicy,
				trace: input.trace,
				llmUsageTrace: input.llmUsageTrace,
			});
		case "data_model":
			return generateDataModelArtifact(input.taskId, {
				prompt,
				questionnaireSessionId: input.questionnaireSessionId,
				sourceSelection,
				routeOverride: input.routeOverride,
				role: input.role,
				executionPolicy: input.executionPolicy,
				trace: input.trace,
				llmUsageTrace: input.llmUsageTrace,
			});
		case "user_flow":
		case "api_io_contract":
		case "activity_flow":
		case "sequence_flow":
		case "zod_schema_design":
			return generatePlanViewArtifact(input.taskId, input.target, {
				prompt,
				questionnaireSessionId: input.questionnaireSessionId,
				sourceSelection,
				routeOverride: input.routeOverride,
				role: input.role,
				executionPolicy: input.executionPolicy,
				trace: input.trace,
				llmUsageTrace: input.llmUsageTrace,
			});
	}
}
