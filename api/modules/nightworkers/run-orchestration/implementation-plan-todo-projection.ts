import { AppError } from "../../../lib/errors";
import {
	projectFeaturePlanImplementationTodos,
	readFeaturePlanImplementationPlanMetadata,
} from "../../specification/feature-plan-implementation-plan";
import type { ImplementationPlanConstraint } from "./start-task-run-types";

type ImplementationHandoffMessage = {
	id: string;
	metadataJson: unknown;
};

export function resolveImplementationPlanTodoProjection(
	message: ImplementationHandoffMessage | null | undefined,
	constraint?: ImplementationPlanConstraint,
) {
	if (!message) {
		if (constraint) {
			throw new AppError(
				422,
				"IMPLEMENTATION_PLAN_SOURCE_MISSING",
				"Reviewed Feature Plan message is missing.",
			);
		}
		return null;
	}
	if (constraint && message.id !== constraint.sourceMessageId) {
		throw new AppError(
			422,
			"IMPLEMENTATION_PLAN_SOURCE_MISMATCH",
			"Implementation Plan source does not match the reviewed Feature Plan.",
		);
	}
	const metadata = readMetadataRecord(message.metadataJson);
	const intent = typeof metadata?.intent === "string" ? metadata.intent : null;
	if (intent !== "feature_plan" && intent !== "implementation_plan") {
		if (constraint) {
			throw new AppError(
				422,
				"IMPLEMENTATION_PLAN_SOURCE_MISMATCH",
				"Reviewed source is not an Implementation Plan or Feature Plan.",
			);
		}
		return null;
	}
	const implementationPlan = readFeaturePlanImplementationPlanMetadata(
		message.metadataJson,
	);
	if (!implementationPlan) {
		if (intent === "feature_plan" || constraint) {
			throw new AppError(
				422,
				"IMPLEMENTATION_PLAN_TODO_PROJECTION_INVALID",
				"Feature Plan implementation plan metadata is missing or invalid.",
			);
		}
		return null;
	}
	if (constraint && implementationPlan.digest !== constraint.digest) {
		throw new AppError(
			422,
			"IMPLEMENTATION_PLAN_DIGEST_MISMATCH",
			"Implementation Plan digest does not match the reviewed Feature Plan.",
		);
	}
	return {
		initialTodos: projectFeaturePlanImplementationTodos(implementationPlan),
		requireDataMigrationGates: implementationPlan.requiresDataMigration,
		implementationPlanProvenance: {
			version: 1 as const,
			sourceMessageId: message.id,
			digest: implementationPlan.digest,
		},
	};
}

function readMetadataRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}
