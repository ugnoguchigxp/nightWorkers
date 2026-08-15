import { z } from "zod";
import {
	digestValue,
	rawSha256Schema,
	safeRefSchema,
	safeTextSchema,
	sha256Schema,
	timestampSchema,
} from "./security-intelligence-runtime-primitives";
import { securityScanSelectionSchema } from "./security-scan.schema";

export const requestPostSecurityAssessmentCommandV1Schema = z
	.object({
		version: z.literal(1),
		runId: safeRefSchema,
		expectedTaskRevisionSnapshotId: safeRefSchema,
		expectedWorkspaceId: safeRefSchema,
		expectedWorkspaceAllocationVersion: z.number().int().nonnegative(),
		selection: securityScanSelectionSchema,
	})
	.strict();

export const providerWorkspaceTargetGrantV1Schema = z
	.object({
		version: z.literal(1),
		grantRef: z.string().regex(/^siwg:v1:[a-f0-9]{64}$/),
		providerProjectRef: safeRefSchema,
		workspaceSubjectRef: safeRefSchema,
		expectedGitCommonDirDigest: sha256Schema,
		expectedHeadSha: safeTextSchema(128),
		providerWorkspaceStateDigest: sha256Schema,
		expiresAt: timestampSchema,
		grantDigest: sha256Schema,
	})
	.strict();

export function parseProviderWorkspaceTargetGrantV1(input: unknown) {
	const parsed = providerWorkspaceTargetGrantV1Schema.parse(input);
	const {
		grantRef: _grantRef,
		grantDigest: _grantDigest,
		...semantic
	} = parsed;
	const grantDigest = digestValue(semantic);
	if (
		parsed.grantDigest !== grantDigest ||
		parsed.grantRef !== `siwg:v1:${grantDigest.slice("sha256:".length)}`
	) {
		throw new Error("security_intelligence:workspace_grant_digest_mismatch");
	}
	return parsed;
}

export const createProviderWorkspaceTargetGrantRequestSchema = z
	.object({
		version: z.literal(1),
		providerProjectRef: z.string().uuid(),
		workspaceSubjectRef: safeRefSchema,
		workspacePath: z
			.string()
			.min(1)
			.max(4_096)
			.refine((value) => value.startsWith("/")),
		expectedGitCommonDirDigest: sha256Schema,
		expectedHeadSha: z.string().regex(/^([a-f0-9]{40}|[a-f0-9]{64})$/),
	})
	.strict();

export const providerWorkspaceTargetPreviewSchema = z
	.object({
		version: z.literal(1),
		grantRef: z.string().regex(/^siwg:v1:[a-f0-9]{64}$/),
		previewRef: z.string().regex(/^siwp:v1:[a-f0-9]{64}$/),
		resolvedProfileRef: safeRefSchema,
		target: z
			.object({
				kind: z.literal("working_tree"),
				digest: rawSha256Schema,
				canonicalDigest: sha256Schema,
				baseRevision: safeTextSchema(128),
				assessedRevision: safeTextSchema(128),
				providerWorkspaceStateDigest: sha256Schema,
				fileCount: z.number().int().nonnegative(),
			})
			.strict(),
		expiresAt: timestampSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.target.canonicalDigest !== `sha256:${value.target.digest}`) {
			ctx.addIssue({
				code: "custom",
				path: ["target", "canonicalDigest"],
				message: "security_intelligence:target_digest_mismatch",
			});
		}
	});

export const providerWorkspaceTargetStartResponseSchema = z
	.object({
		version: z.literal(1),
		grantRef: z.string().regex(/^siwg:v1:[a-f0-9]{64}$/),
		scanRunRef: z.string().uuid(),
		status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
		resolvedProfileRef: safeRefSchema,
		target: z
			.object({
				kind: z.literal("working_tree"),
				digest: rawSha256Schema,
				sourceRevision: safeTextSchema(128),
				providerWorkspaceStateDigest: sha256Schema,
			})
			.strict(),
		createdAt: timestampSchema,
		replayed: z.boolean(),
	})
	.strict();

const providerEnvelopeSchema = <T extends z.ZodType>(schema: T) =>
	z
		.object({
			contractVersion: z.literal(1),
			requestId: safeRefSchema,
			data: schema,
		})
		.strict();

export const providerWorkspaceTargetGrantEnvelopeSchema =
	providerEnvelopeSchema(providerWorkspaceTargetGrantV1Schema);
export const providerWorkspaceTargetPreviewEnvelopeSchema =
	providerEnvelopeSchema(providerWorkspaceTargetPreviewSchema);
export const providerWorkspaceTargetStartEnvelopeSchema =
	providerEnvelopeSchema(providerWorkspaceTargetStartResponseSchema);
