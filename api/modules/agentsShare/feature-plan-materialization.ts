import {
	type RepositoryMaterializationIntent,
	repositoryMaterializationIntentSchema,
} from "../../../shared/schemas/git-integration.schema";

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
		};
	}
	return null;
}
