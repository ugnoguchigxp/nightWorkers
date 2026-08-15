import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalStringifySecurityIntelligenceValue } from "../security-intelligence-assessment-contract";
import {
	type SecurityIntelligenceAssessmentV1,
	securityIntelligenceAssessmentV1Schema,
} from "./security-intelligence-assessment.schema";
import {
	securityIntelligenceCanonicalReasonCodesSchema,
	securityIntelligenceOpaqueRefSchema,
	securityIntelligenceSha256DigestSchema,
	securityIntelligenceTargetSchema,
} from "./security-intelligence-assessment-components.schema";

export const NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION = 1 as const;
export const NIGHTWORKERS_SECURITY_INTELLIGENCE_IDENTITY_MAPPING_VERSION =
	1 as const;

const bundleRefSchema = z.string().regex(/^sib:v1:[a-f0-9]{64}$/);
const requestIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/);
const projectRefSchema = securityIntelligenceOpaqueRefSchema.refine(
	(value) => value.startsWith("project:"),
	"security_intelligence:nightworkers_project_ref_invalid",
);
const scanRunRefSchema = securityIntelligenceOpaqueRefSchema.refine(
	(value) => value.startsWith("scan-run:"),
	"security_intelligence:nightworkers_scan_run_ref_invalid",
);
const authorizationStateLimitationCodes = [
	"authorization_shadow_disabled",
	"authorization_shadow_only",
	"authorization_shadow_unavailable",
] as const;

export const nightworkersSecurityIntelligenceCapabilitiesSchema = z
	.object({
		contractVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
		),
		identityMappingVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_IDENTITY_MAPPING_VERSION,
		),
		available: z.literal(true),
		supportedTransports: z.tuple([z.literal("http_service")]),
		supportedTargetKinds: z.tuple([z.literal("working_tree")]),
		unsupportedTransports: z.tuple([z.literal("local_cli")]),
		unsupportedTargetKinds: z.tuple([z.literal("full")]),
		maxResponseBytes: z
			.number()
			.int()
			.positive()
			.max(2 * 1024 * 1024),
		workspaceTargetGrant: z.discriminatedUnion("available", [
			z
				.object({
					available: z.literal(true),
					maxRequestBytes: z
						.number()
						.int()
						.positive()
						.max(64 * 1024),
					ttlSeconds: z.number().int().positive().max(3_600),
				})
				.strict(),
			z
				.object({
					available: z.literal(false),
					reasonCode: z.literal("workspace_target_grant_unavailable"),
					maxRequestBytes: z
						.number()
						.int()
						.positive()
						.max(64 * 1024),
					ttlSeconds: z.number().int().positive().max(3_600),
				})
				.strict(),
		]),
	})
	.strict();
export type NightworkersSecurityIntelligenceCapabilities = z.infer<
	typeof nightworkersSecurityIntelligenceCapabilitiesSchema
>;

const rawSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const revisionSchema = z
	.string()
	.min(1)
	.max(128)
	.refine(
		(value) =>
			!value.includes("://") &&
			!value.startsWith("/") &&
			!/^[A-Za-z]:[\\/]/.test(value),
		"security_intelligence:absolute_path_forbidden",
	);

export const securityIntelligenceBindingProofSchema = z
	.object({
		version: z.literal(1),
		identityMappingVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_IDENTITY_MAPPING_VERSION,
		),
		rawProviderProjectRef: z.string().uuid(),
		canonicalProjectRef: z.string().regex(/^project:[0-9a-f-]{36}$/),
		rawScanRunRef: z.string().uuid(),
		canonicalScanRunRef: z.string().regex(/^scan-run:[0-9a-f-]{36}$/),
		target: z
			.object({
				kind: z.literal("diff"),
				baseRevision: revisionSchema,
				assessedRevision: revisionSchema,
				rawTargetDigest: rawSha256Schema,
				canonicalTargetDigest: securityIntelligenceSha256DigestSchema,
			})
			.strict(),
		proofRef: z.string().regex(/^sibp:v1:[a-f0-9]{64}$/),
		proofDigest: securityIntelligenceSha256DigestSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (
			value.canonicalProjectRef !== `project:${value.rawProviderProjectRef}`
		) {
			ctx.addIssue({
				code: "custom",
				path: ["canonicalProjectRef"],
				message: "security_intelligence:project_ref_mismatch",
			});
		}
		if (value.canonicalScanRunRef !== `scan-run:${value.rawScanRunRef}`) {
			ctx.addIssue({
				code: "custom",
				path: ["canonicalScanRunRef"],
				message: "security_intelligence:scan_run_ref_mismatch",
			});
		}
		if (
			value.target.canonicalTargetDigest !==
			`sha256:${value.target.rawTargetDigest}`
		) {
			ctx.addIssue({
				code: "custom",
				path: ["target", "canonicalTargetDigest"],
				message: "security_intelligence:target_digest_mismatch",
			});
		}
	});
export type SecurityIntelligenceBindingProof = z.infer<
	typeof securityIntelligenceBindingProofSchema
>;

export const nightworkersSecurityIntelligenceCapabilitiesEnvelopeSchema = z
	.object({
		contractVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
		),
		requestId: requestIdSchema,
		data: nightworkersSecurityIntelligenceCapabilitiesSchema,
	})
	.strict();

export const nightworkersSecurityIntelligenceBindingProofEnvelopeSchema = z
	.object({
		contractVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
		),
		requestId: requestIdSchema,
		data: securityIntelligenceBindingProofSchema,
	})
	.strict();

export function deriveSecurityIntelligenceBindingProof(
	semantic: Omit<SecurityIntelligenceBindingProof, "proofRef" | "proofDigest">,
): SecurityIntelligenceBindingProof {
	const digest = createHash("sha256")
		.update(canonicalStringifySecurityIntelligenceValue(semantic))
		.digest("hex");
	return securityIntelligenceBindingProofSchema.parse({
		...semantic,
		proofRef: `sibp:v1:${digest}`,
		proofDigest: `sha256:${digest}`,
	});
}

export function parseSecurityIntelligenceBindingProof(
	input: unknown,
): SecurityIntelligenceBindingProof {
	const parsed = securityIntelligenceBindingProofSchema.parse(input);
	const {
		proofRef: _proofRef,
		proofDigest: _proofDigest,
		...semantic
	} = parsed;
	const expected = deriveSecurityIntelligenceBindingProof(semantic);
	if (
		parsed.proofRef !== expected.proofRef ||
		parsed.proofDigest !== expected.proofDigest
	) {
		throw new Error("security_intelligence:binding_proof_digest_mismatch");
	}
	return parsed;
}

export const nightworkersAuthorizationShadowStateSchema = z.discriminatedUnion(
	"status",
	[
		z
			.object({
				status: z.literal("disabled"),
				reasonCode: z.literal("authorization_shadow_disabled"),
			})
			.strict(),
		z
			.object({
				status: z.literal("unavailable"),
				reasonCode: z.literal("authorization_shadow_unavailable"),
			})
			.strict(),
		z
			.object({
				status: z.literal("available"),
				assessment: securityIntelligenceAssessmentV1Schema,
			})
			.strict(),
	],
);
export type NightworkersAuthorizationShadowState = z.infer<
	typeof nightworkersAuthorizationShadowStateSchema
>;

export const nightworkersSecurityIntelligenceBundleSchema = z
	.object({
		contractVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
		),
		bundleRef: bundleRefSchema,
		projectRef: projectRefSchema,
		scanRunRef: scanRunRefSchema,
		target: securityIntelligenceTargetSchema,
		dependencyAssessment: securityIntelligenceAssessmentV1Schema,
		authorizationShadow: nightworkersAuthorizationShadowStateSchema,
		limitationCodes: securityIntelligenceCanonicalReasonCodesSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		assertAssessmentBinding({
			assessment: value.dependencyAssessment,
			projectRef: value.projectRef,
			scanRunRef: value.scanRunRef,
			target: value.target,
			path: ["dependencyAssessment"],
			targetMode: "exact",
			ctx,
		});
		if (value.dependencyAssessment.target.kind !== "diff") {
			ctx.addIssue({
				code: "custom",
				path: ["dependencyAssessment", "target", "kind"],
				message: "security_intelligence:nightworkers_dependency_diff_required",
			});
		}
		if (
			value.dependencyAssessment.verifications.length === 0 ||
			!value.dependencyAssessment.verifications.every((verification) =>
				verification.capabilityRef.startsWith("dependency-vulnerability:"),
			)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["dependencyAssessment", "verifications"],
				message:
					"security_intelligence:nightworkers_dependency_assessment_required",
			});
		}
		if (value.authorizationShadow.status === "available") {
			assertAssessmentBinding({
				assessment: value.authorizationShadow.assessment,
				projectRef: value.projectRef,
				scanRunRef: value.scanRunRef,
				target: value.target,
				path: ["authorizationShadow", "assessment"],
				targetMode: "shared_identity",
				ctx,
			});
			const authorization = value.authorizationShadow.assessment;
			if (
				authorization.target.baseRevision === undefined ||
				authorization.target.headRevision === undefined ||
				authorization.target.baseTargetDigest === undefined ||
				authorization.verifications.length === 0 ||
				!authorization.verifications.every((verification) =>
					verification.capabilityRef.startsWith("authorization-boundary:"),
				)
			) {
				ctx.addIssue({
					code: "custom",
					path: ["authorizationShadow", "assessment"],
					message:
						"security_intelligence:nightworkers_authorization_assessment_required",
				});
			}
		}
		const expectedLimitation =
			value.authorizationShadow.status === "disabled"
				? "authorization_shadow_disabled"
				: value.authorizationShadow.status === "unavailable"
					? "authorization_shadow_unavailable"
					: "authorization_shadow_only";
		for (const code of authorizationStateLimitationCodes) {
			if (
				value.limitationCodes.includes(code) !==
				(code === expectedLimitation)
			) {
				ctx.addIssue({
					code: "custom",
					path: ["limitationCodes"],
					message:
						"security_intelligence:nightworkers_authorization_state_limitation_mismatch",
				});
				break;
			}
		}
	});
export type NightworkersSecurityIntelligenceBundle = z.infer<
	typeof nightworkersSecurityIntelligenceBundleSchema
>;

export const nightworkersSecurityIntelligenceSuccessEnvelopeSchema = z
	.object({
		contractVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
		),
		requestId: requestIdSchema,
		data: nightworkersSecurityIntelligenceBundleSchema,
	})
	.strict();

export function deriveNightworkersSecurityIntelligenceBundleRef(
	bundle: Omit<NightworkersSecurityIntelligenceBundle, "bundleRef">,
): `sib:v1:${string}` {
	return `sib:v1:${createHash("sha256")
		.update(canonicalStringifySecurityIntelligenceValue(bundle))
		.digest("hex")}`;
}

export function parseNightworkersSecurityIntelligenceBundle(
	input: unknown,
): NightworkersSecurityIntelligenceBundle {
	const parsed = nightworkersSecurityIntelligenceBundleSchema.parse(input);
	const { bundleRef: _bundleRef, ...semantic } = parsed;
	if (
		deriveNightworkersSecurityIntelligenceBundleRef(semantic) !==
		parsed.bundleRef
	) {
		throw new Error(
			"security_intelligence:nightworkers_bundle_digest_mismatch",
		);
	}
	return parsed;
}

function assertAssessmentBinding(params: {
	assessment: SecurityIntelligenceAssessmentV1;
	projectRef: string;
	scanRunRef: string;
	target: SecurityIntelligenceAssessmentV1["target"];
	path: Array<string | number>;
	targetMode: "exact" | "shared_identity";
	ctx: z.RefinementCtx;
}): void {
	const { assessment, target } = params;
	const targetMatches =
		params.targetMode === "exact"
			? canonicalStringifySecurityIntelligenceValue(assessment.target) ===
				canonicalStringifySecurityIntelligenceValue(target)
			: assessment.target.kind === target.kind &&
				assessment.target.sourceRevision === target.sourceRevision &&
				assessment.target.targetDigest === target.targetDigest;
	if (
		assessment.projectRef !== params.projectRef ||
		assessment.source.scanRunRef !== params.scanRunRef ||
		!targetMatches
	) {
		params.ctx.addIssue({
			code: "custom",
			path: params.path,
			message: "security_intelligence:nightworkers_assessment_binding_mismatch",
		});
	}
}
