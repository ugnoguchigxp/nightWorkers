import type {
	MissionDecompositionPlanningResult,
	MissionDeterministicCheckReport,
} from "../../../shared/schemas/mission-planner.schema";

type CheckStatus = MissionDeterministicCheckReport["checks"][number]["status"];

function resultStatus(checks: MissionDeterministicCheckReport["checks"]) {
	if (checks.some((check) => check.status === "fail")) return "fail";
	if (checks.some((check) => check.status === "warning")) return "warning";
	return "pass";
}

function addCheck(
	checks: MissionDeterministicCheckReport["checks"],
	key: string,
	status: CheckStatus,
	message: string,
	targetId: string | null = null,
) {
	checks.push({ key, status, message, targetId });
}

function hasManualConfirmation(gates: string[]) {
	return gates.some((gate) => /manual|human|承認|確認|レビュー/.test(gate));
}

function detectsDestructiveWork(text: string) {
	return /drop|truncate|destroy|migration|migrate|destructive|破壊|移行|マイグレーション/i.test(
		text,
	);
}

function detectDependencyCycle(edges: Map<string, string[]>) {
	const visiting = new Set<string>();
	const visited = new Set<string>();

	function visit(id: string): string | null {
		if (visiting.has(id)) return id;
		if (visited.has(id)) return null;
		visiting.add(id);
		for (const dependency of edges.get(id) ?? []) {
			const cycle = visit(dependency);
			if (cycle) return cycle;
		}
		visiting.delete(id);
		visited.add(id);
		return null;
	}

	for (const id of edges.keys()) {
		const cycle = visit(id);
		if (cycle) return cycle;
	}
	return null;
}

export function validateMissionPlanningResult(
	result: MissionDecompositionPlanningResult,
): MissionDeterministicCheckReport {
	const checks: MissionDeterministicCheckReport["checks"] = [];
	const objectiveIds = new Set(
		result.objectives.map((objective) => objective.id),
	);
	const workPackageIds = new Set(
		result.workPackages.map((workPackage) => workPackage.id),
	);
	const proposalIds = new Set(
		result.taskProposals.map((proposal) => proposal.id),
	);

	addCheck(
		checks,
		"objective_count_bounds",
		result.objectives.length >= 1 && result.objectives.length <= 8
			? "pass"
			: "fail",
		"Objectives must be between 1 and 8.",
	);
	addCheck(
		checks,
		"work_package_count_bounds",
		result.workPackages.length >= 1 && result.workPackages.length <= 10
			? "pass"
			: "fail",
		"Work Packages must be between 1 and 10.",
	);
	addCheck(
		checks,
		"task_proposal_count_bounds",
		result.taskProposals.length >= 1 && result.taskProposals.length <= 20
			? "pass"
			: "fail",
		"Task Proposals must be between 1 and 20.",
	);

	const proposalsByWorkPackage = new Map<string, number>();
	for (const proposal of result.taskProposals) {
		proposalsByWorkPackage.set(
			proposal.workPackageId,
			(proposalsByWorkPackage.get(proposal.workPackageId) ?? 0) + 1,
		);
	}
	for (const [workPackageId, count] of proposalsByWorkPackage) {
		addCheck(
			checks,
			"task_proposal_count_bounds",
			count <= 8 ? "pass" : "fail",
			"Each Work Package must have at most 8 Task Proposals.",
			workPackageId,
		);
	}

	for (const proposal of result.taskProposals) {
		addCheck(
			checks,
			"work_package_references",
			workPackageIds.has(proposal.workPackageId) ? "pass" : "fail",
			"Every Task Proposal must reference an existing Work Package.",
			proposal.id,
		);
		addCheck(
			checks,
			"initial_prompt_required",
			proposal.initialPrompt.trim().length > 0 ? "pass" : "fail",
			"Every Task Proposal must include a non-empty initial prompt.",
			proposal.id,
		);
		addCheck(
			checks,
			"expected_outcome_required",
			proposal.expectedOutcome.trim().length > 0 ? "pass" : "fail",
			"Every Task Proposal must include an expected outcome.",
			proposal.id,
		);
		addCheck(
			checks,
			"verification_gate_required",
			proposal.verificationGate.length > 0 ||
				hasManualConfirmation(proposal.acceptanceCriteria)
				? "pass"
				: "fail",
			"Every Task Proposal must include a verification gate or explicit manual confirmation.",
			proposal.id,
		);
		for (const dependencyId of proposal.dependencies) {
			addCheck(
				checks,
				"dependency_references",
				proposalIds.has(dependencyId) ? "pass" : "fail",
				"Task Proposal dependencies must reference existing proposal ids.",
				proposal.id,
			);
		}
		if (proposal.scheduling.executionType === "sequence") {
			addCheck(
				checks,
				"sequence_consistency",
				proposal.scheduling.sequenceGroupId !== null &&
					proposal.scheduling.sequenceOrder !== null
					? "pass"
					: "fail",
				"Sequence scheduling requires a sequenceGroupId and sequenceOrder.",
				proposal.id,
			);
		}
		const proposalText = [
			proposal.title,
			proposal.summary,
			proposal.purpose,
			proposal.initialPrompt,
			proposal.expectedOutcome,
			...proposal.implementationFocus,
		].join("\n");
		addCheck(
			checks,
			"approval_required_for_high_risk",
			proposal.risk !== "high" && !detectsDestructiveWork(proposalText)
				? "pass"
				: proposal.approvalRequired
					? "pass"
					: "fail",
			"High-risk or destructive/data-migration-like proposals must require approval.",
			proposal.id,
		);
		addCheck(
			checks,
			"scheduling_consistency",
			proposal.risk === "high" || proposal.approvalRequired
				? proposal.scheduling.executionType === "normal"
					? "fail"
					: "pass"
				: "pass",
			"Approval-required high-risk proposals must not use normal scheduling.",
			proposal.id,
		);
	}

	for (const workPackage of result.workPackages) {
		const missingObjective = workPackage.relatedObjectiveIds.find(
			(id) => !objectiveIds.has(id),
		);
		addCheck(
			checks,
			"objective_references",
			!missingObjective ? "pass" : "fail",
			"Every Work Package must reference at least one existing Objective.",
			workPackage.id,
		);
	}

	for (const objective of result.objectives) {
		addCheck(
			checks,
			"verification_gate_required",
			objective.verificationGate.length > 0 ||
				hasManualConfirmation(objective.completionCriteria)
				? "pass"
				: "fail",
			"Every Objective must include a verification gate or explicit manual confirmation.",
			objective.id,
		);
	}

	for (const workPackage of result.workPackages) {
		addCheck(
			checks,
			"verification_gate_required",
			workPackage.verificationGate.length > 0 ||
				hasManualConfirmation([workPackage.purpose])
				? "pass"
				: "fail",
			"Every Work Package must include a verification gate or explicit manual confirmation.",
			workPackage.id,
		);
	}

	const dependencyCycle = detectDependencyCycle(
		new Map(
			result.taskProposals.map((proposal) => [
				proposal.id,
				proposal.dependencies,
			]),
		),
	);
	addCheck(
		checks,
		"dependency_cycle",
		dependencyCycle ? "fail" : "pass",
		dependencyCycle
			? "Task Proposal dependencies must not contain a cycle."
			: "Task Proposal dependencies do not contain a cycle.",
		dependencyCycle,
	);

	const sequenceOrders = new Map<string, Set<number>>();
	for (const proposal of result.taskProposals) {
		const { sequenceGroupId, sequenceOrder } = proposal.scheduling;
		if (
			proposal.scheduling.executionType !== "sequence" ||
			!sequenceGroupId ||
			sequenceOrder === null
		) {
			continue;
		}
		const orders = sequenceOrders.get(sequenceGroupId) ?? new Set<number>();
		const duplicate = orders.has(sequenceOrder);
		orders.add(sequenceOrder);
		sequenceOrders.set(sequenceGroupId, orders);
		addCheck(
			checks,
			"sequence_consistency",
			duplicate ? "fail" : "pass",
			"Sequence scheduling must not duplicate sequenceOrder inside one group.",
			proposal.id,
		);
	}

	const titles = new Set<string>();
	for (const proposal of result.taskProposals) {
		const normalized = proposal.title.trim().toLowerCase();
		const duplicate = titles.has(normalized);
		titles.add(normalized);
		addCheck(
			checks,
			"duplicate_titles",
			duplicate ? "warning" : "pass",
			duplicate
				? "Duplicate Task Proposal titles should be reviewed before approval."
				: "Task Proposal title is unique in this planning result.",
			proposal.id,
		);
	}

	return {
		status: resultStatus(checks),
		checks,
	};
}
