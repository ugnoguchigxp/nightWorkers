import { createHash } from "node:crypto";
import { z } from "zod";
import { implementationPlanSchema } from "../../../shared/modules/agentsShare";
import { repositoryMaterializationIntentSchema } from "../../../shared/schemas/git-integration.schema";

const featurePlanMarkdownSchema = z
	.string()
	.min(1)
	.refine((value) => value.trim().length > 0, {
		message: "Feature Plan Markdown must not be blank.",
	});

export function createFeaturePlanMarkdownDraftSchema(input?: {
	requiresRepositoryMaterialization?: boolean;
}) {
	const materializationIntent = input?.requiresRepositoryMaterialization
		? repositoryMaterializationIntentSchema.refine(
				(intent) => intent.kind !== "existing_git",
				{
					message:
						"A starter_template or git_import intent is required when Git HEAD is missing.",
				},
			)
		: repositoryMaterializationIntentSchema.nullable().default(null);
	return z
		.object({
			markdown: featurePlanMarkdownSchema,
			implementationPlan: implementationPlanSchema,
			repositoryMaterializationIntent: materializationIntent,
		})
		.strict();
}

export const featurePlanMarkdownDraftSchema =
	createFeaturePlanMarkdownDraftSchema();

export function digestFeaturePlanContent(content: string) {
	return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function readFeaturePlanTitle(
	markdown: string,
	fallback = "Feature Plan",
) {
	const heading = markdown
		.split(/\r?\n/)
		.map((line) => line.match(/^#\s+(.+?)\s*$/)?.[1]?.trim())
		.find((title): title is string => Boolean(title));
	return heading || fallback;
}
