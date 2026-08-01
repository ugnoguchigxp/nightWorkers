import { evaluateAcceptanceConditionAssurance } from "./acceptance-condition-assurance.service";

export type QualityGateResult = {
	passed: boolean;
	sourceStateHash?: string;
	inventory: {
		status: "passed" | "failed" | "unknown";
		reason?: string;
		activeCaseCount: number;
	};
	testExecution: { status: "passed" | "failed" | "unknown"; reason?: string };
	fullVerify: { status: "passed" | "failed" | "unknown"; reason?: string };
	conditions: Array<{
		conditionId: string;
		required: boolean;
		status: "passed" | "failed" | "not_required";
		reason?: string;
	}>;
};

export async function evaluateQualityGate(input: {
	taskId: string;
	runId: string;
	verificationDocumentId: string;
	repoRoot?: string;
}): Promise<QualityGateResult> {
	if (!input.repoRoot) return unknownGate("missing_repository_context");
	const evaluation = await evaluateAcceptanceConditionAssurance({
		...input,
		repoRoot: input.repoRoot,
	});
	return {
		passed: evaluation.qualityGate.passed,
		sourceStateHash: evaluation.sourceStateHash,
		inventory: evaluation.qualityGate.inventory,
		testExecution: evaluation.qualityGate.testExecution,
		fullVerify: {
			status: evaluation.qualityGate.fullVerify.status,
			...(evaluation.qualityGate.fullVerify.reason
				? { reason: evaluation.qualityGate.fullVerify.reason }
				: {}),
		},
		conditions: evaluation.conditions.map((condition) => ({
			conditionId: condition.conditionId,
			required: condition.required,
			status: !condition.required
				? "not_required"
				: condition.assuranceStatus === "safe_pass"
					? "passed"
					: "failed",
			...(condition.reasonCode ? { reason: condition.reasonCode } : {}),
		})),
	};
}

function unknownGate(reason: string): QualityGateResult {
	return {
		passed: false,
		inventory: { status: "unknown", activeCaseCount: 0, reason },
		testExecution: { status: "unknown", reason },
		fullVerify: { status: "unknown", reason },
		conditions: [],
	};
}
