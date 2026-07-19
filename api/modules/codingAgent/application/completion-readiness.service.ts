import { contentDigest } from "../../agentsShare";
import * as repo from "../../nightworkers/nightworkers.repository";
import * as verificationRepository from "../../nightworkers/nightworkers.verification.repository";
import type { CompletionCheckResult } from "../../nightworkers/nightworkers.verification.service";
import { runCompletionCheck } from "../../nightworkers/nightworkers.verification.service";

export type CodingAgentCompletionReadiness = {
	ready: boolean;
	authority: {
		taskId: string;
		runId: string;
		repositoryRoot: string;
		verificationDocumentId: string | null;
	};
	task: {
		goalDigest: string;
	};
	workspace: {
		sourceStateHash: string | null;
	};
	verification: {
		applicability: "active" | "not_configured";
		checkedSourceStateHash: string | null;
		result: CompletionCheckResult | null;
	};
	candidate: {
		revision: number | null;
		digest: string | null;
	};
	discrepancies: Array<{
		code: string;
		summary: string;
		rawRef?: string;
	}>;
	satisfactionConditions: string[];
};

type CompletionReadinessDependencies = {
	getTask: typeof repo.getTask;
	getLatestActiveVerificationDocumentForTask: typeof verificationRepository.getLatestActiveVerificationDocumentForTask;
	runCompletionCheck: typeof runCompletionCheck;
};

const defaultDependencies: CompletionReadinessDependencies = {
	getTask: (...args) => repo.getTask(...args),
	getLatestActiveVerificationDocumentForTask: (...args) =>
		verificationRepository.getLatestActiveVerificationDocumentForTask(...args),
	runCompletionCheck: (...args) => runCompletionCheck(...args),
};

export async function evaluateCodingAgentCompletionReadiness(
	input: {
		taskId: string;
		runId: string;
		repositoryRoot: string;
		candidateRevision?: number;
		finalCandidate?: string;
	},
	dependencies: CompletionReadinessDependencies = defaultDependencies,
): Promise<CodingAgentCompletionReadiness> {
	const [task, document] = await Promise.all([
		dependencies.getTask(input.taskId),
		dependencies.getLatestActiveVerificationDocumentForTask(input.taskId),
	]);
	const authority = {
		taskId: input.taskId,
		runId: input.runId,
		repositoryRoot: input.repositoryRoot,
		verificationDocumentId: document?.id ?? null,
	};
	const candidate = {
		revision: input.candidateRevision ?? null,
		digest: input.finalCandidate?.trim()
			? contentDigest(input.finalCandidate.trim())
			: null,
	};
	const goalDigest = contentDigest(
		JSON.stringify({
			title: task?.title ?? null,
			description: task?.description ?? null,
			objective: task?.objective ?? null,
			acceptanceCriteria: task?.acceptanceCriteria ?? null,
		}),
	);

	if (!document) {
		return {
			ready: true,
			authority,
			task: { goalDigest },
			workspace: { sourceStateHash: null },
			verification: {
				applicability: "not_configured",
				checkedSourceStateHash: null,
				result: null,
			},
			candidate,
			discrepancies: [],
			satisfactionConditions: [],
		};
	}

	const result = await dependencies.runCompletionCheck({
		taskId: input.taskId,
		verificationDocumentId: document.id,
		repoRoot: input.repositoryRoot,
	});
	const sourceStateHash = result.qualityGate.sourceStateHash ?? null;
	const discrepancies = buildVerificationDiscrepancies(result);
	const hasFinalCandidate =
		candidate.revision !== null && candidate.digest !== null;
	if (!hasFinalCandidate) {
		discrepancies.unshift({
			code: "final_candidate_missing",
			summary:
				"active verification documentの完了判定には最終候補本文とrevisionが必要です。",
			rawRef: "completion.candidate",
		});
	}
	return {
		ready: result.ok && hasFinalCandidate,
		authority,
		task: { goalDigest },
		workspace: { sourceStateHash },
		verification: {
			applicability: "active",
			checkedSourceStateHash: sourceStateHash,
			result,
		},
		candidate,
		discrepancies,
		satisfactionConditions: [
			...(hasFinalCandidate
				? []
				: ["現在の最終候補本文と、そのrevisionを指定して再評価する。"]),
			...buildSatisfactionConditions(result),
		],
	};
}

function buildVerificationDiscrepancies(result: CompletionCheckResult) {
	const grouped = new Map<string, { summaries: string[]; rawRef?: string }>();
	const add = (code: string | undefined, summary: string, rawRef?: string) => {
		if (!code) return;
		const current = grouped.get(code);
		if (current) {
			if (!current.summaries.includes(summary)) current.summaries.push(summary);
			return;
		}
		grouped.set(code, {
			summaries: [summary],
			...(rawRef ? { rawRef } : {}),
		});
	};

	add(
		result.reason,
		`completion check: ${result.reason ?? "not ready"}`,
		"verification.completionCheck",
	);
	for (const condition of result.failedRequired) {
		add(
			condition.reason ?? "required_condition_failed",
			`${condition.conditionId}: ${condition.reason ?? condition.text}`,
			`verification.condition:${condition.conditionId}`,
		);
	}
	for (const condition of result.unknownRequired) {
		add(
			condition.reason ?? "required_condition_unknown",
			`${condition.conditionId}: ${condition.reason ?? condition.text}`,
			`verification.condition:${condition.conditionId}`,
		);
	}
	const qualityGate = result.qualityGate;
	if (qualityGate.inventory.status !== "passed") {
		add(
			qualityGate.inventory.reason ?? "test_inventory_not_ready",
			`test inventory: ${qualityGate.inventory.reason ?? qualityGate.inventory.status}`,
			"verification.qualityGate.inventory",
		);
	}
	if (qualityGate.testExecution.status !== "passed") {
		add(
			qualityGate.testExecution.reason ?? "test_execution_not_ready",
			`test execution: ${qualityGate.testExecution.reason ?? qualityGate.testExecution.status}`,
			"verification.qualityGate.testExecution",
		);
	}
	if (qualityGate.fullVerify.status !== "passed") {
		add(
			qualityGate.fullVerify.reason ?? "full_verify_not_ready",
			`full verify: ${qualityGate.fullVerify.reason ?? qualityGate.fullVerify.status}`,
			"verification.qualityGate.fullVerify",
		);
	}
	for (const condition of qualityGate.conditions) {
		if (condition.status !== "failed") continue;
		add(
			condition.reason ?? "condition_quality_gate_failed",
			`${condition.conditionId}: ${condition.reason ?? "quality gate failed"}`,
			`verification.qualityGate.condition:${condition.conditionId}`,
		);
	}
	return [...grouped.entries()].map(([code, item]) => ({
		code,
		summary: item.summaries.join(" | "),
		...(item.rawRef ? { rawRef: item.rawRef } : {}),
	}));
}

function buildSatisfactionConditions(result: CompletionCheckResult) {
	if (result.ok) return [];
	return [
		...(result.failedRequired.length
			? [
					`失敗したrequired conditionを再検証する: ${result.failedRequired
						.map((item) => item.conditionId)
						.join(", ")}`,
				]
			: []),
		...(result.unknownRequired.length
			? [
					`未確認のrequired conditionに対応する証跡を確認する: ${result.unknownRequired
						.map((item) => item.conditionId)
						.join(", ")}`,
				]
			: []),
		...(result.qualityGate.inventory.status === "passed"
			? []
			: ["現在のsourceに対するactive test inventoryを確認する。"]),
		...(result.qualityGate.testExecution.status === "passed"
			? []
			: ["現在のsourceに対するtest実行結果を確認する。"]),
		...(result.qualityGate.fullVerify.status === "passed"
			? []
			: ["現在のsourceに対するfull verify結果を確認する。"]),
	];
}
