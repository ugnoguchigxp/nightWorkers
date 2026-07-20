import { createHash } from "node:crypto";
import { z } from "zod";
import { repositoryMaterializationIntentSchema } from "../../../shared/schemas/git-integration.schema";

export const featurePlanMarkdownDraftSchema = z
	.object({
		markdown: z
			.string()
			.min(1)
			.refine((value) => value.trim().length > 0, {
				message: "Feature Plan Markdown must not be blank.",
			}),
		repositoryMaterializationIntent: repositoryMaterializationIntentSchema
			.nullable()
			.default(null),
	})
	.passthrough();

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
