import { z } from "@hono/zod-openapi";

export const repositoryKindSchema = z.enum(["git", "non_git"]);
export const repositoryIdentityStatusSchema = z.enum([
	"ready",
	"materialization_pending",
	"invalid",
	"mismatch",
]);

export const projectRepositoryIdentitySchema = z.object({
	repositoryKind: repositoryKindSchema,
	status: repositoryIdentityStatusSchema,
	registeredRootCanonical: z.string(),
	gitCommonDirCanonical: z.string().nullable(),
	baseWorktreePathCanonical: z.string().nullable(),
	baseWorktreeId: z.string().nullable(),
	digest: z.string().nullable(),
	revision: z.number().int().positive(),
	verifiedAt: z.string(),
	observedBranch: z.string().nullable(),
	observedHeadSha: z.string().nullable(),
	baseWorktreeDirty: z.boolean(),
	failureCode: z.string().nullable(),
});

export type RepositoryKind = z.infer<typeof repositoryKindSchema>;
export type RepositoryIdentityStatus = z.infer<
	typeof repositoryIdentityStatusSchema
>;
export type ProjectRepositoryIdentity = z.infer<
	typeof projectRepositoryIdentitySchema
>;

export const workspaceArtifactRefSchema = z.object({
	workspaceId: z.string().min(1),
	allocationVersion: z.number().int().positive(),
	relativePath: z
		.string()
		.min(1)
		.refine((value) => !value.startsWith("/") && !value.includes("\\"), {
			message: "relativePath must use repository-relative POSIX syntax",
		})
		.refine((value) => !value.split("/").some((segment) => segment === ".."), {
			message: "relativePath must not contain ..",
		}),
	contentDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
	observedHeadSha: z.string().regex(/^[0-9a-f]{40,64}$/),
	source: z.enum([
		"workspace_file",
		"workspace_diff",
		"verification_projection",
	]),
});

export type WorkspaceArtifactRef = z.infer<typeof workspaceArtifactRefSchema>;
