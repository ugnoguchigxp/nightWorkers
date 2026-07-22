import { z } from "@hono/zod-openapi";
import {
	isStarterOverlayForStack,
	isStarterVariantForStack,
	STARTER_OVERLAYS,
	STARTER_STACKS,
	STARTER_VARIANTS,
} from "../starter-template-contract";

export const gitMergeStrategySchema = z.enum([
	"merge_commit",
	"squash",
	"fast_forward_only",
]);
export const gitWorkspaceStatusSchema = z.enum([
	"planned",
	"waiting_for_repository_initialization",
	"provisioning",
	"ready",
	"active",
	"reviewing",
	"integration_pending",
	"merged",
	"provision_failed",
	"attention",
	"retired",
]);
const starterTemplateMaterializationIntentSchema = z
	.object({
		kind: z.literal("starter_template"),
		source: z.literal("starter"),
		stack: z.enum(STARTER_STACKS),
		variant: z.enum(STARTER_VARIANTS).optional(),
		overlays: z.array(z.enum(STARTER_OVERLAYS)).optional(),
		initialize: z.literal(true),
	})
	.superRefine((intent, context) => {
		if (
			intent.variant &&
			!isStarterVariantForStack(intent.stack, intent.variant)
		) {
			context.addIssue({
				code: "custom",
				path: ["variant"],
				message: `Unknown ${intent.stack} starter variant: ${intent.variant}`,
			});
		}
		for (const overlay of intent.overlays ?? []) {
			if (isStarterOverlayForStack(intent.stack, overlay)) continue;
			context.addIssue({
				code: "custom",
				path: ["overlays"],
				message: `Unknown ${intent.stack} starter overlay: ${overlay}`,
			});
		}
	});

export const repositoryMaterializationIntentSchema = z.union([
	z.object({ kind: z.literal("existing_git") }),
	starterTemplateMaterializationIntentSchema,
	z.object({
		kind: z.literal("git_import"),
		source: z.literal("git"),
		repoUrl: z.string().min(1),
		ref: z.string().optional(),
		depth: z.number().int().positive().optional(),
		stripGitDir: z.boolean().optional(),
		initialize: z.literal(true),
	}),
]);
export const projectGitIntegrationPolicySchema = z.object({
	version: z.literal(1),
	remoteName: z.string().min(1).nullable(),
	defaultMergeStrategy: gitMergeStrategySchema,
	sourcePushPolicy: z.enum(["optional", "required_before_merge"]),
	targetPushPolicy: z.enum(["manual", "after_merge"]),
	ciGate: z.enum(["none", "external_ci_required"]),
});
export const defaultProjectGitIntegrationPolicy = {
	version: 1,
	remoteName: null,
	defaultMergeStrategy: "merge_commit",
	sourcePushPolicy: "optional",
	targetPushPolicy: "manual",
	ciGate: "none",
} as const;
export const taskGitWorkspaceSchema = z
	.object({
		id: z.string().uuid(),
		taskId: z.string().uuid(),
		repositoryId: z.string().uuid(),
		planReviewId: z.string().uuid().nullable().optional(),
		admissionKey: z.string().nullable().optional(),
		status: gitWorkspaceStatusSchema,
		materializationKind: z.enum([
			"existing_git",
			"starter_template",
			"git_import",
			"legacy_adopted",
		]),
		integrationPolicySnapshotJson: projectGitIntegrationPolicySchema,
		sourceBranch: z.string(),
		targetBranch: z.string(),
		targetBaseSha: z.string().nullable().optional(),
		worktreePath: z.string().nullable().optional(),
		worktreeId: z.string().nullable().optional(),
		expectedHeadSha: z.string().nullable().optional(),
		allocationVersion: z.number().int().positive(),
	})
	.superRefine((value, context) => {
		if (
			![
				"ready",
				"active",
				"reviewing",
				"integration_pending",
				"merged",
			].includes(value.status)
		)
			return;
		for (const field of [
			"targetBaseSha",
			"worktreePath",
			"worktreeId",
			"expectedHeadSha",
		] as const) {
			if (!value[field])
				context.addIssue({
					code: "custom",
					path: [field],
					message: `${field} is required for a ready workspace`,
				});
		}
	});

export type ProjectGitIntegrationPolicy = z.infer<
	typeof projectGitIntegrationPolicySchema
>;
export type RepositoryMaterializationIntent = z.infer<
	typeof repositoryMaterializationIntentSchema
>;
export type TaskGitWorkspace = z.infer<typeof taskGitWorkspaceSchema>;
