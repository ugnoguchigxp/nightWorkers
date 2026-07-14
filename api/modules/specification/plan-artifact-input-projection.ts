import crypto from "node:crypto";
import type {
	PlanArtifactCanonicalInput,
	PlanArtifactGenerationTarget,
	PlanArtifactInputProjection,
} from "./plan-artifact-input.types";
import { PLAN_ARTIFACT_INPUT_PROJECTION_VERSION } from "./plan-artifact-input.types";

export function projectPlanArtifactInput(
	canonical: PlanArtifactCanonicalInput,
): PlanArtifactInputProjection {
	const sourceArtifacts = canonical.sources
		.filter((source) => isSourceRelevant(canonical.target, source.kind))
		.map((source) => ({
			...source,
			renderedContent: removeRepeatedInitialPrompt(
				source.renderedContent,
				canonical.task.initialPrompt,
			),
		}));
	const uniqueSources = deduplicateSources(sourceArtifacts);
	const projectionBase = {
		version: PLAN_ARTIFACT_INPUT_PROJECTION_VERSION,
		target: canonical.target,
		task: canonical.task,
		questionnaireDecisions: canonical.questionnaire?.decisions ?? [],
		projectContext: canonical.project,
		sourceArtifacts: uniqueSources,
		regenerationRequest: canonical.regenerationRequest,
		provenance: {
			contextRevision: canonical.provenance.contextRevision,
			contextDigest: canonical.provenance.contextDigest,
			routingRevision: canonical.provenance.routingRevision,
			questionnaireDigest: canonical.questionnaire?.digest ?? null,
			sourceMessageIds: uniqueSources.map((source) => source.messageId),
			sourceDigests: uniqueSources.map((source) => source.digest),
		},
	};
	const serialized = JSON.stringify(projectionBase);
	const initialPromptOccurrences = countOccurrences(
		serialized,
		canonical.task.initialPrompt,
	);
	const sectionChars = {
		task: JSON.stringify(projectionBase.task).length,
		questionnaire: JSON.stringify(projectionBase.questionnaireDecisions).length,
		projectContext: JSON.stringify(projectionBase.projectContext).length,
		sourceArtifacts: JSON.stringify(projectionBase.sourceArtifacts).length,
		regenerationRequest: projectionBase.regenerationRequest?.length ?? 0,
	};
	const sectionBytes = Object.fromEntries(
		Object.entries({
			task: JSON.stringify(projectionBase.task),
			questionnaire: JSON.stringify(projectionBase.questionnaireDecisions),
			projectContext: JSON.stringify(projectionBase.projectContext),
			sourceArtifacts: JSON.stringify(projectionBase.sourceArtifacts),
			regenerationRequest: projectionBase.regenerationRequest ?? "",
		}).map(([key, value]) => [key, Buffer.byteLength(value, "utf8")]),
	);
	const projectionDigest = `sha256:${crypto.createHash("sha256").update(serialized).digest("hex")}`;
	return {
		...projectionBase,
		diagnostics: {
			sectionChars,
			sectionBytes,
			sourceCount: sourceArtifacts.length,
			deduplicatedSourceCount: uniqueSources.length,
			initialPromptOccurrences,
			projectionDigest,
		},
	};
}

export function isSourceRelevant(
	target: PlanArtifactGenerationTarget,
	kind: string,
) {
	if (target === "blueprint") return kind === "previous_target";
	if (target === "data_model")
		return ["blueprint", "previous_target"].includes(kind);
	if (target === "feature_plan") {
		return [
			"blueprint",
			"data_model",
			"dedicated_view",
			"previous_target",
		].includes(kind);
	}
	if (target === "api_io_contract") {
		return [
			"blueprint",
			"data_model",
			"feature_plan",
			"previous_target",
		].includes(kind);
	}
	if (target === "zod_schema_design") {
		return [
			"blueprint",
			"data_model",
			"feature_plan",
			"dedicated_view",
			"previous_target",
		].includes(kind);
	}
	if (target === "plan_review") return kind !== "previous_target";
	return [
		"blueprint",
		"data_model",
		"feature_plan",
		"dedicated_view",
		"previous_target",
	].includes(kind);
}

function deduplicateSources(sources: PlanArtifactCanonicalInput["sources"]) {
	const seen = new Set<string>();
	return sources.filter((source) => {
		if (seen.has(source.messageId)) return false;
		seen.add(source.messageId);
		return true;
	});
}

function countOccurrences(value: string, needle: string) {
	if (!needle) return 0;
	let count = 0;
	let offset = 0;
	while (true) {
		const found = value.indexOf(needle, offset);
		if (found < 0) return count;
		count += 1;
		offset = found + needle.length;
	}
}

function removeRepeatedInitialPrompt(content: string, initialPrompt: string) {
	if (!content || !initialPrompt) return content;
	return content.replaceAll(
		initialPrompt,
		"[Task BaselineのInitial promptを参照]",
	);
}
