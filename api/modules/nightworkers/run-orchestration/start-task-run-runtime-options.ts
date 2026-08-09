import { buildInteractiveReviewRuntimeOptions } from "../../review/review-runtime-profile";

export type TaskRunRuntimeOptions = Record<string, unknown> & {
	securityOracle: {
		enabled: boolean;
		configured: boolean;
		reason: string;
		maxIterations: number;
		ontologyToolProfile: "standard" | "ontology_extended";
	};
	reviewRun?: unknown;
	reviewCorrection?: unknown;
	reviewRuntime?: unknown;
	runtimeResume?: unknown;
};

export function buildTaskRunRuntimeOptions(input: {
	runtimeLaneOptions: Record<string, unknown>;
	runtimeOptionsPatch?: Record<string, unknown>;
	interactiveReview: {
		reviewedRunId: string | null;
		gitCommonDir: string;
	} | null;
	workspaceRuntimeEnvironment: Record<string, string>;
	securityIntelligence: {
		securityOracle: {
			effectiveEnabled: boolean;
			configured: boolean;
			reason: string;
		};
		settings: { securityMaxIterations: number };
		ontology: {
			toolProfile: "standard" | "ontology_extended";
		};
	};
}): TaskRunRuntimeOptions {
	return {
		...input.runtimeLaneOptions,
		...(input.runtimeOptionsPatch ?? {}),
		...(input.interactiveReview
			? {
					reviewRuntime: buildInteractiveReviewRuntimeOptions({
						reviewedRunId: input.interactiveReview.reviewedRunId,
						gitCommonDir: input.interactiveReview.gitCommonDir,
					}),
				}
			: {}),
		workspaceRuntimeEnvironment: input.workspaceRuntimeEnvironment,
		securityOracle: {
			enabled: input.securityIntelligence.securityOracle.effectiveEnabled,
			configured: input.securityIntelligence.securityOracle.configured,
			reason: input.securityIntelligence.securityOracle.reason,
			maxIterations: input.securityIntelligence.settings.securityMaxIterations,
			ontologyToolProfile: input.securityIntelligence.ontology.toolProfile,
		},
	};
}
