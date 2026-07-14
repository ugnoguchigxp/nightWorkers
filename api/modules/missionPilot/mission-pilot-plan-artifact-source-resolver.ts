import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { missionPilotSessions } from "../../db/mission-pilot-schema";
import { AppError } from "../../lib/errors";
import type {
	PlanArtifactGenerationTarget,
	PlanArtifactSourceSelection,
} from "../specification/plan-artifact-input.types";
import { createPlanArtifactSourceSelection } from "../specification/plan-artifact-source-selection";
import * as planRepo from "./mission-pilot-plan.repository";

export async function resolveMissionPilotPlanArtifactSources(input: {
	sessionId: string;
	stepId: string;
	target: PlanArtifactGenerationTarget;
}): Promise<{
	selection: PlanArtifactSourceSelection;
	expectedState: {
		missionPilotSessionId: string;
		contextRevision: number;
		contextDigest: string;
		routingRevision: number;
	};
}> {
	const session = await db.query.missionPilotSessions.findFirst({
		where: eq(missionPilotSessions.id, input.sessionId),
	});
	if (!session) {
		throw new AppError(
			409,
			"PLAN_ARTIFACT_CONTEXT_STALE",
			"Mission Pilot session is missing.",
		);
	}
	const context = await planRepo.getPlanContextSnapshot(
		session.id,
		session.contextRevision,
	);
	if (!context || context.digest !== session.contextDigest) {
		throw new AppError(
			409,
			"PLAN_ARTIFACT_CONTEXT_STALE",
			"Mission Pilot context snapshot is missing or stale.",
		);
	}
	const steps = await planRepo.listPlanSteps(input.sessionId);
	const step = steps.find((candidate) => candidate.id === input.stepId);
	if (step?.status !== "running") {
		throw new AppError(
			409,
			"PLAN_ARTIFACT_DEPENDENCY_NOT_READY",
			"Mission Pilot plan step is not running.",
		);
	}
	const candidates = steps
		.filter((candidate) => candidate.ordinal < step.ordinal)
		.filter((candidate) => candidate.status === "completed")
		.filter((candidate) => Boolean(candidate.artifactMessageId))
		.filter(
			(candidate) =>
				Number(candidate.evidenceJson.artifactRoutingRevision ?? -1) ===
				session.planRoutingRevision,
		)
		.filter(
			(candidate) =>
				candidate.evidenceJson.decision !== "omit" &&
				candidate.evidenceJson.invalidatedByRoutingRevision !==
					session.planRoutingRevision,
		);
	const byKind = new Map<string, (typeof candidates)[number]>();
	for (const candidate of candidates) {
		const kind = String(candidate.evidenceJson.kind || "");
		const view = String(candidate.evidenceJson.view || "");
		byKind.set(kind === "dedicated_view" ? `view:${view}` : kind, candidate);
	}
	const required = missionPilotRequiredArtifactDependencyKeys({
		target: input.target,
		stepOrdinal: step.ordinal,
		steps,
	});
	for (const dependencyKey of required) {
		if (!byKind.get(dependencyKey)?.artifactMessageId) {
			throw new AppError(
				409,
				"PLAN_ARTIFACT_DEPENDENCY_NOT_READY",
				`Dependency is not ready: ${dependencyKey}`,
			);
		}
	}
	const dedicatedViewMessageIds = candidates
		.filter((candidate) => candidate.evidenceJson.kind === "dedicated_view")
		.map((candidate) => candidate.artifactMessageId)
		.filter((id): id is string => Boolean(id));
	return {
		selection: createPlanArtifactSourceSelection({
			policy: "mission_pilot_step",
			blueprintMessageId: byKind.get("blueprint")?.artifactMessageId,
			dataModelMessageId: byKind.get("data_model")?.artifactMessageId,
			featurePlanMessageId: byKind.get("feature_plan")?.artifactMessageId,
			dedicatedViewMessageIds,
		}),
		expectedState: {
			missionPilotSessionId: session.id,
			contextRevision: session.contextRevision,
			contextDigest: session.contextDigest,
			routingRevision: session.planRoutingRevision,
		},
	};
}

export function missionPilotRequiredArtifactDependencyKeys(input: {
	target: PlanArtifactGenerationTarget;
	stepOrdinal: number;
	steps: Array<{
		ordinal: number;
		stepKey: string;
		evidenceJson: Record<string, unknown>;
	}>;
}) {
	const scheduled = input.steps
		.filter((step) => step.ordinal < input.stepOrdinal)
		.filter((step) => step.evidenceJson.decision !== "omit")
		.map((step) => {
			const kind = String(step.evidenceJson.kind || "");
			const view = String(step.evidenceJson.view || "");
			if (kind === "dedicated_view" && view) return `view:${view}`;
			if (["blueprint", "data_model"].includes(kind)) return kind;
			if (step.stepKey === "blueprint") return "blueprint";
			return null;
		})
		.filter((key): key is string => Boolean(key));
	const requiredKinds =
		input.target === "data_model"
			? new Set(["blueprint"])
			: input.target === "api_io_contract"
				? new Set(["blueprint", "data_model"])
				: input.target === "feature_plan"
					? new Set(scheduled)
					: new Set<string>();
	return [...new Set(scheduled.filter((key) => requiredKinds.has(key)))];
}
