import {
	type NightworkersSecurityIntelligenceBundle,
	parseNightworkersSecurityIntelligenceBundle,
	parseSecurityIntelligenceBindingProof,
	type SecurityIntelligenceBindingProof,
} from "./schemas/nightworkers-security-intelligence.schema";
import {
	canonicalProjectRef,
	canonicalScanRunRef,
	equalSecurityIntelligenceDigest,
} from "./schemas/security-intelligence-identity-mapping.schema";
import type { ProviderScanBindingV2 } from "./schemas/security-intelligence-runtime.schema";
import {
	type SecurityScanStartResponse,
	securityScanStartResponseSchema,
} from "./schemas/security-scan.schema";

export type VerifiedSecurityIntelligenceScanTriple = {
	providerProjectRef: string;
	startResponse: SecurityScanStartResponse;
	bindingProof: SecurityIntelligenceBindingProof;
	assessmentBundle: NightworkersSecurityIntelligenceBundle;
	normalizedTarget: {
		kind: "diff";
		baseRevision: string;
		assessedRevision: string;
		targetDigest: `sha256:${string}`;
	};
};

export function verifySecurityIntelligenceScanTriple(input: {
	providerProjectRef: string;
	startResponse: unknown;
	bindingProof: unknown;
	assessmentBundle: unknown;
}): VerifiedSecurityIntelligenceScanTriple {
	const startResponse = securityScanStartResponseSchema.parse(
		input.startResponse,
	);
	const bindingProof = parseSecurityIntelligenceBindingProof(
		input.bindingProof,
	);
	const assessmentBundle = parseNightworkersSecurityIntelligenceBundle(
		input.assessmentBundle,
	);
	if (bindingProof.identityMappingVersion !== 1) {
		throw new Error(
			"security_intelligence:identity_mapping_version_unsupported",
		);
	}
	if (
		bindingProof.rawProviderProjectRef !== input.providerProjectRef ||
		bindingProof.canonicalProjectRef !==
			canonicalProjectRef(input.providerProjectRef) ||
		assessmentBundle.projectRef !== bindingProof.canonicalProjectRef
	) {
		throw new Error("security_intelligence:project_ref_mismatch");
	}
	if (
		startResponse.scanRunRef !== bindingProof.rawScanRunRef ||
		bindingProof.canonicalScanRunRef !==
			canonicalScanRunRef(startResponse.scanRunRef) ||
		assessmentBundle.scanRunRef !== bindingProof.canonicalScanRunRef
	) {
		throw new Error("security_intelligence:scan_run_ref_mismatch");
	}
	if (
		startResponse.target.kind !== "working_tree" ||
		bindingProof.target.kind !== "diff" ||
		assessmentBundle.target.kind !== "diff"
	) {
		throw new Error("security_intelligence:target_kind_unsupported");
	}
	if (
		startResponse.target.sourceRevision !== bindingProof.target.baseRevision ||
		assessmentBundle.target.sourceRevision !==
			bindingProof.target.assessedRevision
	) {
		throw new Error("security_intelligence:revision_role_mismatch");
	}
	if (
		!equalSecurityIntelligenceDigest(
			startResponse.target.digest,
			bindingProof.target.canonicalTargetDigest,
		) ||
		bindingProof.target.rawTargetDigest !== startResponse.target.digest ||
		assessmentBundle.target.targetDigest !==
			bindingProof.target.canonicalTargetDigest
	) {
		throw new Error("security_intelligence:target_digest_mismatch");
	}
	return {
		providerProjectRef: input.providerProjectRef,
		startResponse,
		bindingProof,
		assessmentBundle,
		normalizedTarget: {
			kind: "diff",
			baseRevision: bindingProof.target.baseRevision,
			assessedRevision: bindingProof.target.assessedRevision,
			targetDigest: bindingProof.target
				.canonicalTargetDigest as `sha256:${string}`,
		},
	};
}

export function verifySecurityIntelligenceDurableBinding(input: {
	binding: ProviderScanBindingV2;
	bindingProof: unknown;
	assessmentBundle: unknown;
}) {
	const bindingProof = parseSecurityIntelligenceBindingProof(
		input.bindingProof,
	);
	const assessmentBundle = parseNightworkersSecurityIntelligenceBundle(
		input.assessmentBundle,
	);
	if (
		input.binding.version !== 2 ||
		input.binding.identityMappingVersion !== 1 ||
		bindingProof.identityMappingVersion !== 1
	) {
		throw new Error(
			"security_intelligence:identity_mapping_version_unsupported",
		);
	}
	if (
		bindingProof.rawProviderProjectRef !== input.binding.providerProjectRef ||
		bindingProof.canonicalProjectRef !==
			canonicalProjectRef(input.binding.providerProjectRef) ||
		assessmentBundle.projectRef !== bindingProof.canonicalProjectRef
	) {
		throw new Error("security_intelligence:project_ref_mismatch");
	}
	if (
		bindingProof.rawScanRunRef !== input.binding.scanRunRef ||
		bindingProof.canonicalScanRunRef !==
			canonicalScanRunRef(input.binding.scanRunRef) ||
		assessmentBundle.scanRunRef !== bindingProof.canonicalScanRunRef
	) {
		throw new Error("security_intelligence:scan_run_ref_mismatch");
	}
	if (
		input.binding.resolvedTarget.kind !== "working_tree" ||
		input.binding.resolvedTarget.sourceRevisionRole !== "base_revision" ||
		bindingProof.target.kind !== "diff" ||
		assessmentBundle.target.kind !== "diff"
	) {
		throw new Error("security_intelligence:target_kind_unsupported");
	}
	if (
		input.binding.resolvedTarget.sourceRevision !==
			bindingProof.target.baseRevision ||
		assessmentBundle.target.sourceRevision !==
			bindingProof.target.assessedRevision
	) {
		throw new Error("security_intelligence:revision_role_mismatch");
	}
	if (
		!equalSecurityIntelligenceDigest(
			input.binding.resolvedTarget.targetDigest,
			bindingProof.target.canonicalTargetDigest,
		) ||
		bindingProof.target.rawTargetDigest !==
			input.binding.resolvedTarget.targetDigest ||
		assessmentBundle.target.targetDigest !==
			bindingProof.target.canonicalTargetDigest
	) {
		throw new Error("security_intelligence:target_digest_mismatch");
	}
	return {
		binding: input.binding,
		bindingProof,
		assessmentBundle,
		normalizedTarget: {
			kind: "diff" as const,
			baseRevision: bindingProof.target.baseRevision,
			sourceRevision: bindingProof.target.assessedRevision,
			targetDigest: bindingProof.target.canonicalTargetDigest,
		},
	};
}
