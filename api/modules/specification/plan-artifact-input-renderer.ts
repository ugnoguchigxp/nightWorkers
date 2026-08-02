// import { AppError } from "../../lib/errors";
import { estimateTokens } from "../../services/conversation-context/token-budget";
import { resolveStructuredLlmModelCapability } from "../../services/structured-llm/model-capability";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../services/structured-llm/settings";
import type { StructuredLlmPromptBudgetMetadata } from "../../services/structured-llm/types";
import type { PlanArtifactInputProjection } from "./plan-artifact-input.types";
import { projectPlanArtifactInput } from "./plan-artifact-input-projection";

export const PLAN_ARTIFACT_SOURCE_SUMMARY_MAX_BYTES = 12_000;
export const PLAN_ARTIFACT_PACKAGE_SCRIPT_SUMMARY_MAX_BYTES = 2_000;
export const PLAN_ARTIFACT_GENERATION_TIMEOUT_MS = 300_000;

export function buildPlanArtifactPromptBudgetMetadata(input: {
	projection: PlanArtifactInputProjection;
	systemPrompt: string;
	userPrompt: string;
	providerJsonSchema?: unknown;
	role?: StructuredLlmRole;
	routeOverride?: StructuredLlmModelTarget | null;
}): StructuredLlmPromptBudgetMetadata {
	const renderedSectionBytes = measurePlanArtifactPromptSectionBytes(
		input.userPrompt,
	);
	const capability = resolveStructuredLlmModelCapability({
		role: input.role,
		routeOverride: input.routeOverride,
	});
	const estimatedPromptTokensBefore =
		estimateTokens(input.systemPrompt) + estimateTokens(input.userPrompt);
	const serializedProviderSchema =
		input.providerJsonSchema === undefined
			? ""
			: (JSON.stringify(input.providerJsonSchema) ?? "");
	const estimatedProviderSchemaTokens = serializedProviderSchema
		? estimateTokens(serializedProviderSchema)
		: 0;
	const estimatedVisibleInputTokens =
		estimatedPromptTokensBefore + estimatedProviderSchemaTokens;
	// safe prompt budget は観測用のしきい値として扱い、超過だけでは生成を停止しない。
	// if (estimatedPromptTokensBefore > capability.safePromptBudgetTokens) {
	// 	throw new AppError(
	// 		422,
	// 		"PLAN_ARTIFACT_INPUT_BUDGET_EXCEEDED",
	// 		"Plan Artifact input exceeds the configured safe prompt budget.",
	// 		{
	// 			target: input.projection.target,
	// 			projectionVersion: input.projection.version,
	// 			projectionDigest: input.projection.diagnostics.projectionDigest,
	// 			estimatedPromptTokens: estimatedPromptTokensBefore,
	// 			safePromptBudgetTokens: capability.safePromptBudgetTokens,
	// 			sectionBytes: renderedSectionBytes,
	// 		},
	// 	);
	// }
	return {
		modelContextWindowTokens: capability.contextWindowTokens,
		safePromptBudgetTokens: capability.safePromptBudgetTokens,
		reservedOutputTokens: capability.reservedOutputTokens,
		estimatedPromptTokensBefore,
		estimatedPromptTokensAfter: estimatedPromptTokensBefore,
		systemPromptLengthBefore: input.systemPrompt.length,
		systemPromptLengthAfter: input.systemPrompt.length,
		userPromptLengthBefore: input.userPrompt.length,
		userPromptLengthAfter: input.userPrompt.length,
		providerSchemaBytes: Buffer.byteLength(serializedProviderSchema, "utf8"),
		estimatedProviderSchemaTokens,
		estimatedVisibleInputTokens,
		compressedSections: [
			...(input.projection.sourceArtifacts.some(
				(source) => source.contentMode === "canonical_summary",
			)
				? ["sourceArtifacts"]
				: []),
			...(input.projection.target !== "api_io_contract" &&
			packageScriptsNeedSummary(input.projection)
				? ["packageScripts"]
				: []),
		],
		droppedFields: apiContractDroppedFields(input.projection),
		compressionProfile:
			input.projection.target === "api_io_contract"
				? `plan-artifact-input-v${input.projection.version}-target-structural`
				: `plan-artifact-input-v${input.projection.version}-source-summary`,
		budgetExceeded:
			estimatedVisibleInputTokens > capability.safePromptBudgetTokens,
		criticalEvidencePreserved: 1,
		criticalEvidenceDropped: 0,
		artifactProjection: {
			version: input.projection.version,
			target: input.projection.target,
			digest: input.projection.diagnostics.projectionDigest,
			sectionBytes: renderedSectionBytes,
			sourceMessageIds: input.projection.provenance.sourceMessageIds,
			sourceDigests: input.projection.provenance.sourceDigests,
			sourceCount: input.projection.diagnostics.sourceCount,
			deduplicatedSourceCount:
				input.projection.diagnostics.deduplicatedSourceCount,
			questionnaireDecisionCount:
				input.projection.questionnaireDecisions.length,
			initialPromptOccurrences: countOccurrences(
				input.userPrompt,
				input.projection.task.initialPrompt,
			),
			staleSourceRejectedCount: 0,
		},
	};
}

export function renderPlanArtifactInput(
	projection: PlanArtifactInputProjection,
) {
	const task = renderTask(projection);
	const questionnaire = renderQuestionnaire(projection);
	const projectContext = renderProject(projection);
	const sections = [
		"## Generation Target",
		`${projection.target}: このArtifactだけを生成してください。`,
		"",
		"## Task Baseline",
		task,
		"",
		"## Questionnaire Decisions",
		questionnaire,
		"",
		"## Current Project State",
		projectContext,
	];
	const sources = renderSources(projection);
	if (sources) sections.push("", "## Source Artifacts", sources);
	if (projection.regenerationRequest) {
		sections.push(
			"",
			"## Regeneration Request",
			projection.regenerationRequest,
		);
	}
	const prompt = sections.join("\n");
	const sectionBytes = measurePlanArtifactPromptSectionBytes(prompt);
	return {
		task,
		questionnaire,
		projectContext,
		featurePlan: renderSourceKind(projection, "feature_plan"),
		blueprint: renderSourceKind(projection, "blueprint"),
		dataModel: renderSourceKind(projection, "data_model"),
		dedicatedViews: renderSourceKind(projection, "dedicated_view"),
		regenerationRequest: projection.regenerationRequest,
		diagnostics: {
			...projection.diagnostics,
			sectionBytes,
			sectionChars: measurePlanArtifactPromptSectionChars(prompt),
			initialPromptOccurrences: countOccurrences(
				prompt,
				projection.task.initialPrompt,
			),
		},
		prompt,
	};
}

export function renderPlanArtifactInputFromCanonical(
	canonical: Parameters<typeof projectPlanArtifactInput>[0],
) {
	return renderPlanArtifactInput(projectPlanArtifactInput(canonical));
}

function renderTask(projection: PlanArtifactInputProjection) {
	const initialPrompt = projection.task.initialPrompt;
	const normalizedInitialPrompt = initialPrompt.trim();
	const description = distinctTaskValue(
		projection.task.description,
		new Set([normalizedInitialPrompt]),
	);
	const acceptanceCriteria = distinctTaskValue(
		projection.task.acceptanceCriteria,
		new Set(
			description
				? [normalizedInitialPrompt, description.trim()]
				: [normalizedInitialPrompt],
		),
	);
	return [
		`Title: ${projection.task.title}`,
		`Initial prompt: ${initialPrompt}`,
		description ? `Description: ${description}` : "",
		acceptanceCriteria ? `Acceptance criteria: ${acceptanceCriteria}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

function renderQuestionnaire(projection: PlanArtifactInputProjection) {
	if (projection.questionnaireDecisions.length === 0)
		return "回答済みのQuestionnaire decisionはありません。";
	if (projection.target === "api_io_contract") {
		return projection.questionnaireDecisions
			.map((decision) =>
				[
					`- ${decision.question}`,
					`  - Answer: ${decision.answer}`,
					decision.deferred ? "  - Deferred: yes" : "",
				]
					.filter(Boolean)
					.join("\n"),
			)
			.join("\n");
	}
	return projection.questionnaireDecisions
		.map((decision) =>
			[
				`- ${decision.question}`,
				decision.decisionKey ? `  - Decision key: ${decision.decisionKey}` : "",
				`  - Answer: ${decision.answer}`,
				decision.why ? `  - Why: ${decision.why}` : "",
				decision.outputSection ? `  - Section: ${decision.outputSection}` : "",
				`  - Deferred: ${decision.deferred ? "yes" : "no"}`,
			]
				.filter(Boolean)
				.join("\n"),
		)
		.join("\n");
}

function renderProject(projection: PlanArtifactInputProjection) {
	const profile = projection.projectContext.detectedStack;
	const technologies = profile?.technologies
		.map((item) => `${item.name}${item.version ? `@${item.version}` : ""}`)
		.join(", ");
	if (projection.target === "api_io_contract") {
		return [
			`Repository: ${projection.projectContext.name}`,
			`Materialization state: ${projection.projectContext.materializationState}`,
			profile?.summary
				? `Detected stack: ${profile.summary}`
				: "Detected stack: 未検出",
			technologies ? `Detected technologies: ${technologies}` : "",
			"計画上の制約はQuestionnaire Decisionsを正とします。",
		]
			.filter(Boolean)
			.join("\n");
	}
	const packageScripts = packageScriptsNeedSummary(projection)
		? projection.projectContext.packageScripts
				.map((script) => script.name)
				.join(", ")
		: projection.projectContext.packageScripts
				.map((script) => `${script.name}=${script.command}`)
				.join(", ");
	return [
		`Repository: ${projection.projectContext.name}`,
		`Root: ${projection.projectContext.root}`,
		`Materialization state: ${projection.projectContext.materializationState}`,
		profile?.summary
			? `Detected stack: ${profile.summary}`
			: "Detected stack: 未検出",
		technologies ? `Detected technologies: ${technologies}` : "",
		projection.projectContext.packageScripts.length
			? `Package scripts: ${packageScripts}`
			: "",
		"計画上の制約はQuestionnaire Decisionsを正とします。",
	]
		.filter(Boolean)
		.join("\n");
}

function distinctTaskValue(
	value: string | null,
	seen: Set<string>,
): string | null {
	const source = value ?? "";
	const normalized = source.trim();
	return normalized && !seen.has(normalized) ? source : null;
}

function apiContractDroppedFields(projection: PlanArtifactInputProjection) {
	if (projection.target !== "api_io_contract") return [];
	const decisions = projection.questionnaireDecisions;
	return [
		decisions.some((decision) => Boolean(decision.decisionKey))
			? "questionnaire.decisionKey"
			: "",
		decisions.some((decision) => Boolean(decision.why))
			? "questionnaire.why"
			: "",
		decisions.some((decision) => Boolean(decision.outputSection))
			? "questionnaire.outputSection"
			: "",
		decisions.some((decision) => !decision.deferred)
			? "questionnaire.deferred=false"
			: "",
		projection.projectContext.root ? "project.root" : "",
		projection.projectContext.packageScripts.length > 0
			? "project.packageScripts"
			: "",
	].filter(Boolean);
}

function packageScriptsNeedSummary(projection: PlanArtifactInputProjection) {
	return (
		Buffer.byteLength(
			projection.projectContext.packageScripts
				.map((script) => `${script.name}=${script.command}`)
				.join(", "),
			"utf8",
		) > PLAN_ARTIFACT_PACKAGE_SCRIPT_SUMMARY_MAX_BYTES
	);
}

function renderSources(projection: PlanArtifactInputProjection) {
	return projection.sourceArtifacts
		.map((source) =>
			[
				`### ${source.kind}`,
				source.contentMode === "canonical_summary"
					? `[Source reference: messageId=${source.messageId}; digest=${source.digest}; originalBytes=${source.originalBytes ?? "unknown"}]`
					: "",
				source.renderedContent.trim(),
			]
				.filter(Boolean)
				.join("\n"),
		)
		.join("\n\n");
}

function renderSourceKind(
	projection: PlanArtifactInputProjection,
	kind: string,
) {
	return projection.sourceArtifacts
		.filter((source) => source.kind === kind)
		.map((source) => source.renderedContent.trim())
		.filter(Boolean)
		.join("\n\n");
}

function measurePlanArtifactPromptSectionBytes(prompt: string) {
	return Object.fromEntries(
		Object.entries(splitPlanArtifactPromptSections(prompt)).map(
			([key, value]) => [key, Buffer.byteLength(value, "utf8")],
		),
	);
}

function measurePlanArtifactPromptSectionChars(prompt: string) {
	return Object.fromEntries(
		Object.entries(splitPlanArtifactPromptSections(prompt)).map(
			([key, value]) => [key, value.length],
		),
	);
}

function splitPlanArtifactPromptSections(prompt: string) {
	const names: Record<string, string> = {
		"Generation Target": "generationTarget",
		"Task Baseline": "task",
		"Questionnaire Decisions": "questionnaire",
		"Current Project State": "projectContext",
		"Source Artifacts": "sourceArtifacts",
		"Regeneration Request": "regenerationRequest",
	};
	const result: Record<string, string> = {};
	for (const section of prompt.split(/(?=^## )/m)) {
		const match = section.match(/^## ([^\n]+)/);
		if (!match) continue;
		const key = names[match[1]];
		if (key) result[key] = section.trim();
	}
	return result;
}

function countOccurrences(value: string, needle: string) {
	if (!needle) return 0;
	return value.split(needle).length - 1;
}
