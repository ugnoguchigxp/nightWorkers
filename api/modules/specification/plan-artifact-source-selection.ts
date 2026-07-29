import crypto from "node:crypto";
import { AppError } from "../../lib/errors";
import {
	getPlanModeTask,
	getPlanModeTaskMessage,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import type {
	PlanArtifactGenerationTarget,
	PlanArtifactSourceSelection,
} from "./plan-artifact-input.types";
import { PLAN_ARTIFACT_SOURCE_SUMMARY_MAX_BYTES } from "./plan-artifact-input-renderer";
import { resolvePlanModeRoutingSnapshot } from "./plan-mode-routing-query";
import { renderMessageReferenceSummary } from "./specification-plan-reference-renderer";

type SourceKind =
	| "feature_plan"
	| "blueprint"
	| "data_model"
	| "dedicated_view"
	| "previous_target";

export type ResolvedPlanArtifactSource = {
	kind: SourceKind;
	messageId: string;
	digest: string;
	routingRevision: number | null;
	renderedContent: string;
	contentMode: "raw" | "canonical_summary";
	originalBytes: number;
};

export async function resolvePlanArtifactSources(input: {
	taskId: string;
	target: PlanArtifactGenerationTarget;
	selection: PlanArtifactSourceSelection;
	currentRoutingRevision?: number;
}) {
	const task = await getPlanModeTask(input.taskId);
	if (!task) throw new AppError(404, "TASK_NOT_FOUND", "Task not found.");
	const routing = await resolvePlanModeRoutingSnapshot(task);
	const requested = [
		input.selection.previousTargetMessageId
			? {
					kind: "previous_target" as const,
					id: input.selection.previousTargetMessageId,
				}
			: null,
		input.selection.featurePlanMessageId
			? {
					kind: "feature_plan" as const,
					id: input.selection.featurePlanMessageId,
				}
			: null,
		input.selection.blueprintMessageId
			? { kind: "blueprint" as const, id: input.selection.blueprintMessageId }
			: null,
		input.selection.dataModelMessageId
			? { kind: "data_model" as const, id: input.selection.dataModelMessageId }
			: null,
		...input.selection.dedicatedViewMessageIds.map((id) => ({
			kind: "dedicated_view" as const,
			id,
		})),
	].filter((item): item is { kind: SourceKind; id: string } => Boolean(item));

	const seen = new Set<string>();
	const sources: ResolvedPlanArtifactSource[] = [];
	for (const item of requested) {
		if (seen.has(item.id)) continue;
		seen.add(item.id);
		const message = await getPlanModeTaskMessage(item.id);
		if (!message || message.taskId !== task.id) {
			throw new AppError(
				422,
				"PLAN_ARTIFACT_SOURCE_NOT_FOUND",
				`Plan Artifact source message not found: ${item.id}`,
			);
		}
		const metadata = record(message.metadataJson);
		if (!matchesSourceKind(metadata, item.kind, input.target)) {
			throw new AppError(
				422,
				"PLAN_ARTIFACT_SOURCE_KIND_MISMATCH",
				`Source message ${item.id} does not match ${item.kind}.`,
			);
		}
		const generation = record(metadata?.generation);
		const projection = record(generation?.inputProjection);
		const routingRevision = numberOrNull(projection?.routingRevision);
		const routingView = sourceRoutingView(item.kind, input.target, metadata);
		const routingEntry = routingView
			? routing.entries.find((entry) => entry.view === routingView)
			: null;
		if (
			routingEntry &&
			(routingEntry.decision === "omit" || !routingEntry.capabilityEnabled)
		) {
			throw new AppError(
				409,
				"PLAN_ARTIFACT_CONTEXT_STALE",
				`Plan Artifact source ${item.id} is omitted or disabled in the current routing.`,
			);
		}
		if (
			input.currentRoutingRevision !== undefined &&
			routingRevision !== null &&
			routingRevision !== input.currentRoutingRevision
		) {
			throw new AppError(
				409,
				"PLAN_ARTIFACT_CONTEXT_STALE",
				`Plan Artifact source ${item.id} belongs to routing revision ${routingRevision}.`,
			);
		}
		const sourceContent = selectPlanArtifactSourceContent({
			content: message.content || "",
			metadataJson: message.metadataJson,
			kind: item.kind,
			target: input.target,
		});
		sources.push({
			kind: item.kind,
			messageId: message.id,
			digest: digestFromMessage(message.content || ""),
			routingRevision,
			renderedContent: sourceContent.renderedContent,
			contentMode: sourceContent.contentMode,
			originalBytes: sourceContent.originalBytes,
		});
	}
	return sources;
}

export function selectPlanArtifactSourceContent(input: {
	content: string;
	metadataJson: unknown;
	kind: SourceKind;
	target: PlanArtifactGenerationTarget;
}) {
	const content = input.content.trim();
	const originalBytes = Buffer.byteLength(content, "utf8");
	if (originalBytes <= PLAN_ARTIFACT_SOURCE_SUMMARY_MAX_BYTES) {
		return {
			renderedContent: content,
			contentMode: "raw" as const,
			originalBytes,
		};
	}
	const mode = sourceSummaryMode(input.kind, input.target);
	const summary = renderMessageReferenceSummary(
		{ id: "source", content, metadataJson: input.metadataJson },
		mode,
	).trim();
	const summaryBytes = Buffer.byteLength(summary, "utf8");
	if (
		summary &&
		summaryBytes < originalBytes &&
		summaryBytes <= PLAN_ARTIFACT_SOURCE_SUMMARY_MAX_BYTES
	) {
		return {
			renderedContent: [
				"[Artifact canonical summary: 型別rendererにより圧縮済みです。]",
				summary,
				`[Artifact original bytes: ${originalBytes}]`,
			].join("\n"),
			contentMode: "canonical_summary" as const,
			originalBytes,
		};
	}
	return {
		renderedContent: content,
		contentMode: "raw" as const,
		originalBytes,
	};
}

function sourceSummaryMode(
	kind: SourceKind,
	target: PlanArtifactGenerationTarget,
): "feature_plan" | "blueprint" | "dedicated_view" | "decision_review" {
	if (
		kind === "blueprint" ||
		(kind === "previous_target" && target === "blueprint")
	)
		return "blueprint";
	if (
		kind === "feature_plan" ||
		(kind === "previous_target" && target === "feature_plan")
	)
		return "feature_plan";
	if (target === "plan_review") return "decision_review";
	return "dedicated_view";
}

function sourceRoutingView(
	kind: SourceKind,
	target: PlanArtifactGenerationTarget,
	metadata: Record<string, unknown> | null,
) {
	if (kind === "previous_target") return target;
	if (kind === "blueprint") return "blueprint";
	if (kind === "data_model") return "data_model";
	if (kind === "feature_plan") return "feature_plan";
	if (kind === "dedicated_view" && typeof metadata?.view === "string") {
		return metadata.view;
	}
	return null;
}

export function emptyPlanArtifactSourceSelection(
	policy: PlanArtifactSourceSelection["policy"] = "explicit_request",
): PlanArtifactSourceSelection {
	return {
		previousTargetMessageId: null,
		featurePlanMessageId: null,
		blueprintMessageId: null,
		dataModelMessageId: null,
		dedicatedViewMessageIds: [],
		policy,
	};
}

export function createPlanArtifactSourceSelection(input: {
	policy?: PlanArtifactSourceSelection["policy"];
	previousTargetMessageId?: string | null;
	featurePlanMessageId?: string | null;
	blueprintMessageId?: string | null;
	dataModelMessageId?: string | null;
	dedicatedViewMessageIds?: string[];
}): PlanArtifactSourceSelection {
	return {
		previousTargetMessageId: input.previousTargetMessageId ?? null,
		featurePlanMessageId: input.featurePlanMessageId ?? null,
		blueprintMessageId: input.blueprintMessageId ?? null,
		dataModelMessageId: input.dataModelMessageId ?? null,
		dedicatedViewMessageIds: input.dedicatedViewMessageIds ?? [],
		policy: input.policy ?? "explicit_request",
	};
}

function matchesSourceKind(
	metadata: Record<string, unknown> | null,
	kind: SourceKind,
	target: PlanArtifactGenerationTarget,
) {
	if (kind === "previous_target") {
		return matchesTargetArtifact(metadata, target);
	}
	if (kind === "feature_plan") return metadata?.intent === "feature_plan";
	if (kind === "blueprint") {
		return (
			metadata?.intent === "app_blueprint" ||
			metadata?.intent === "mock_blueprint"
		);
	}
	if (kind === "data_model") {
		return (
			(metadata?.artifactKind === "plan_mode_dedicated_view" &&
				metadata?.view === "data_model") ||
			metadata?.source === "data-model" ||
			metadata?.artifactType === "data_model"
		);
	}
	if (kind === "dedicated_view") {
		return (
			metadata?.artifactKind === "plan_mode_dedicated_view" ||
			metadata?.artifactKind === "plan_mode_api_contract" ||
			metadata?.artifactKind === "plan_mode_zod_schema"
		);
	}
	return false;
}

function matchesTargetArtifact(
	metadata: Record<string, unknown> | null,
	target: PlanArtifactGenerationTarget,
) {
	if (!metadata) return false;
	if (target === "blueprint")
		return (
			metadata.intent === "app_blueprint" ||
			metadata.intent === "mock_blueprint"
		);
	if (target === "feature_plan") return metadata.intent === "feature_plan";
	if (target === "data_model")
		return (
			metadata.view === "data_model" || metadata.artifactType === "data_model"
		);
	if (target === "api_io_contract")
		return (
			metadata.view === "api_io_contract" ||
			metadata.artifactKind === "plan_mode_api_contract"
		);
	if (target === "zod_schema_design")
		return (
			metadata.view === "zod_schema_design" ||
			metadata.artifactKind === "plan_mode_zod_schema"
		);
	return metadata.view === target;
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function numberOrNull(value: unknown) {
	return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function digestFromMessage(content: string) {
	return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}
