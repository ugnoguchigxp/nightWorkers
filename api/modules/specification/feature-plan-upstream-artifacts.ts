import {
	findMissingPlanModeUpstreamViews,
	isPlanModeArtifactCurrentForRouting,
	PLAN_MODE_EXECUTION_VIEW_ORDER,
	resolveIncludedPlanModeViews,
} from "../../../shared/plan-mode-execution";
import type { PlanModeWorkspace } from "../../../shared/schemas/plan-mode-artifact.schema";
import { AppError } from "../../lib/errors";
import type { PlanArtifactSourceSelection } from "./plan-artifact-input.types";
import { createPlanArtifactSourceSelection } from "./plan-artifact-source-selection";

export function resolveFeaturePlanUpstreamArtifacts(input: {
	workspace: PlanModeWorkspace;
	requestedSourceSelection?: PlanArtifactSourceSelection;
}) {
	const currentRoutingRevision = input.workspace.routing?.revision;
	const blueprintArtifacts = input.workspace.blueprintArtifacts.filter(
		(artifact) =>
			isPlanModeArtifactCurrentForRouting(artifact, currentRoutingRevision),
	);
	const dataModelArtifacts = input.workspace.dataModelArtifacts.filter(
		(artifact) =>
			isPlanModeArtifactCurrentForRouting(artifact, currentRoutingRevision),
	);
	const dedicatedViewArtifacts = input.workspace.dedicatedViewArtifacts.filter(
		(artifact) =>
			isPlanModeArtifactCurrentForRouting(artifact, currentRoutingRevision),
	);
	const includedViews = resolveIncludedPlanModeViews({
		routingEntries: input.workspace.routing?.entries,
		viewDecisions: input.workspace.viewDecisions,
	});
	const missingViews = findMissingPlanModeUpstreamViews({
		includedViews,
		existingArtifactKinds: [
			...(blueprintArtifacts.length > 0 ? ["blueprint"] : []),
			...(dataModelArtifacts.length > 0 ? ["data_model"] : []),
			...dedicatedViewArtifacts.map((artifact) => artifact.kind),
		],
	});
	if (missingViews.length > 0) {
		throw new AppError(
			409,
			"PLAN_MODE_UPSTREAM_ARTIFACTS_REQUIRED",
			"選択された先行Artifactが未生成です。先に生成してください。",
			{ missingViews },
		);
	}
	return buildCurrentFeaturePlanSourceSelection({
		requested: input.requestedSourceSelection,
		includedViews,
		blueprintArtifacts,
		dataModelArtifacts,
		dedicatedViewArtifacts,
	});
}

function buildCurrentFeaturePlanSourceSelection(input: {
	requested: PlanArtifactSourceSelection | undefined;
	includedViews: ReadonlySet<string>;
	blueprintArtifacts: Array<{ sourceMessageId: string; createdAt: unknown }>;
	dataModelArtifacts: Array<{ sourceMessageId: string; createdAt: unknown }>;
	dedicatedViewArtifacts: Array<{
		kind: string;
		sourceMessageId: string;
		createdAt: unknown;
	}>;
}) {
	const latestDedicatedByKind = new Map<
		string,
		(typeof input.dedicatedViewArtifacts)[number]
	>();
	for (const artifact of input.dedicatedViewArtifacts) {
		if (
			artifact.kind === "questionnaire" ||
			artifact.kind === "blueprint" ||
			artifact.kind === "data_model" ||
			artifact.kind === "feature_plan" ||
			!input.includedViews.has(artifact.kind)
		)
			continue;
		const current = latestDedicatedByKind.get(artifact.kind);
		if (
			!current ||
			artifactCreatedAtMs(artifact) >= artifactCreatedAtMs(current)
		)
			latestDedicatedByKind.set(artifact.kind, artifact);
	}
	const blueprintMessageId = input.includedViews.has("blueprint")
		? latestArtifact(input.blueprintArtifacts)?.sourceMessageId
		: null;
	const dataModelMessageId = input.includedViews.has("data_model")
		? latestArtifact(input.dataModelArtifacts)?.sourceMessageId
		: null;
	const dedicatedViewMessageIds = PLAN_MODE_EXECUTION_VIEW_ORDER.flatMap(
		(view) => {
			const artifact = latestDedicatedByKind.get(view);
			return artifact ? [artifact.sourceMessageId] : [];
		},
	);
	assertRequestedSourceIsCurrent(
		input.requested?.blueprintMessageId,
		blueprintMessageId,
	);
	assertRequestedSourceIsCurrent(
		input.requested?.dataModelMessageId,
		dataModelMessageId,
	);
	const requestedDedicatedViewMessageIds =
		input.requested?.dedicatedViewMessageIds ?? [];
	if (
		requestedDedicatedViewMessageIds.length > 0 &&
		!sameStringSet(requestedDedicatedViewMessageIds, dedicatedViewMessageIds)
	) {
		throwStaleFeaturePlanSourceSelection();
	}
	return createPlanArtifactSourceSelection({
		policy: input.requested?.policy ?? "explicit_request",
		previousTargetMessageId: input.requested?.previousTargetMessageId,
		featurePlanMessageId: input.requested?.featurePlanMessageId,
		blueprintMessageId,
		dataModelMessageId,
		dedicatedViewMessageIds,
	});
}

function assertRequestedSourceIsCurrent(
	requested: string | null | undefined,
	current: string | null | undefined,
) {
	if (requested && requested !== current)
		throwStaleFeaturePlanSourceSelection();
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
	return (
		left.length === right.length && left.every((value) => right.includes(value))
	);
}

function throwStaleFeaturePlanSourceSelection(): never {
	throw new AppError(
		409,
		"PLAN_ARTIFACT_CONTEXT_STALE",
		"先行Artifactが更新されています。最新状態を読み直してください。",
	);
}

function latestArtifact<T extends { createdAt: unknown }>(
	artifacts: readonly T[],
) {
	let latest: T | null = null;
	for (const artifact of artifacts) {
		if (!latest || artifactCreatedAtMs(artifact) >= artifactCreatedAtMs(latest))
			latest = artifact;
	}
	return latest;
}

function artifactCreatedAtMs(artifact: { createdAt: unknown }) {
	if (artifact.createdAt instanceof Date) return artifact.createdAt.getTime();
	const value = new Date(String(artifact.createdAt)).getTime();
	return Number.isFinite(value) ? value : 0;
}
