import { createHash } from "node:crypto";
import { z } from "zod";
import { implementationPlanSchema } from "../../../shared/modules/agentsShare";
import { repositoryMaterializationIntentSchema } from "../../../shared/schemas/git-integration.schema";
import {
	type SpecificationAcceptanceCriterion,
	specificationAcceptanceCriterionSchema,
} from "../../../shared/schemas/verification-checklist.schema";

const featurePlanMarkdownSchema = z
	.string()
	.min(1)
	.refine((value) => value.trim().length > 0, {
		message: "Feature Plan Markdown must not be blank.",
	});

const acceptanceCriterionLinePattern =
	/^\[?(AC-\d{3})\]?\s*\[(api|ui|db|validation|auth|workflow|migration|other)\]\s+(.+)$/;

type ParsedAcceptanceCriteria = {
	criteria: Array<SpecificationAcceptanceCriterion & { id: string }>;
	invalidLines: string[];
};

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
			acceptanceCriteria: z
				.array(specificationAcceptanceCriterionSchema)
				.min(1)
				.max(30),
			implementationPlan: implementationPlanSchema,
			repositoryMaterializationIntent: materializationIntent,
		})
		.strict()
		.superRefine((draft, context) => {
			const parsed = parseFeaturePlanAcceptanceCriteria(draft.markdown);
			if (parsed.invalidLines.length > 0) {
				context.addIssue({
					code: "custom",
					path: ["markdown"],
					message:
						"Every completion-condition bullet must use [AC-NNN][category] followed by its condition text.",
				});
			}
			if (parsed.criteria.length !== draft.acceptanceCriteria.length) {
				context.addIssue({
					code: "custom",
					path: ["acceptanceCriteria"],
					message:
						"acceptanceCriteria must contain exactly the same conditions as the Markdown completion section.",
				});
				return;
			}
			for (const [index, criterion] of draft.acceptanceCriteria.entries()) {
				const markdownCriterion = parsed.criteria[index];
				const expectedId = `AC-${String(index + 1).padStart(3, "0")}`;
				if (
					markdownCriterion?.id !== expectedId ||
					markdownCriterion.category !== criterion.category ||
					markdownCriterion.title !== criterion.title
				) {
					context.addIssue({
						code: "custom",
						path: ["acceptanceCriteria", index],
						message: `${expectedId} must match the Markdown completion condition in id, category, order, and text.`,
					});
				}
			}
		});
}

export const featurePlanMarkdownDraftSchema =
	createFeaturePlanMarkdownDraftSchema();

function parseFeaturePlanAcceptanceCriteria(
	markdown: string,
): ParsedAcceptanceCriteria {
	const criteria: ParsedAcceptanceCriteria["criteria"] = [];
	const invalidLines: string[] = [];
	let inCompletionSection = false;
	for (const line of markdown.split(/\r?\n/)) {
		const heading = line.match(/^(#{2,6})\s+(.+?)\s*$/);
		if (heading) {
			const title = heading[2] ?? "";
			inCompletionSection =
				/完了条件|completion conditions?|acceptance criteria/i.test(title) &&
				!/(非対象|out of scope)/i.test(title);
			continue;
		}
		if (!inCompletionSection) continue;
		const bullet = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
		if (!bullet) continue;
		const text = (bullet[1] ?? "").trim().replace(/^\[\s\]\s*/, "");
		const match = text.match(acceptanceCriterionLinePattern);
		if (!match) {
			invalidLines.push(line);
			continue;
		}
		criteria.push({
			id: match[1] ?? "",
			category: match[2] as SpecificationAcceptanceCriterion["category"],
			title: (match[3] ?? "").trim(),
		});
	}
	return { criteria, invalidLines };
}

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
