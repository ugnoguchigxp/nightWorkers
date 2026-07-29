import {
	type ImplementationPlan,
	implementationPlanSchema,
} from "../../../shared/modules/agentsShare";
import {
	type RepositoryMaterializationIntent,
	repositoryMaterializationIntentSchema,
} from "../../../shared/schemas/git-integration.schema";
import { digestImplementationPlan } from "./implementation-plan";

function record(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function readFeaturePlanMaterializationIntent(
	metadataJson: unknown,
): RepositoryMaterializationIntent | null {
	const metadata = record(metadataJson);
	const parsed = repositoryMaterializationIntentSchema.safeParse(
		metadata?.repositoryMaterializationIntent,
	);
	return parsed.success ? parsed.data : null;
}

export function readFeaturePlanImplementationPlan(
	metadataJson: unknown,
): ImplementationPlan | null {
	const metadata = record(metadataJson);
	const parsed = implementationPlanSchema.safeParse(
		metadata?.implementationPlan,
	);
	if (!parsed.success) return null;
	const provenance = record(metadata?.implementationPlanProvenance);
	if (
		provenance?.version !== 1 ||
		provenance.digest !== digestImplementationPlan(parsed.data)
	) {
		return null;
	}
	return parsed.data;
}

export function findLatestFeaturePlanMaterialization(
	messages: Array<{ id: string; metadataJson?: unknown }>,
) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		const metadata = record(message?.metadataJson);
		if (metadata?.intent !== "feature_plan" || !message) continue;
		return {
			featurePlanMessageId: message.id,
			intent: readFeaturePlanMaterializationIntent(message.metadataJson),
			implementationPlan: readFeaturePlanImplementationPlan(
				message.metadataJson,
			),
		};
	}
	return null;
}
