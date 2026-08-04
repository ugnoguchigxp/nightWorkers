import { contentDigest } from "../../agentsShare";
import * as repo from "../../nightworkers/nightworkers.repository";
import * as verificationRepository from "../../nightworkers/nightworkers.verification.repository";
import {
	type CompletionCheckResult,
	runCompletionCheck,
} from "./completion-check.service";

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
		runId: input.runId,
		verificationDocumentId: document.id,
		repoRoot: input.repositoryRoot,
	});
	const sourceStateHash = result.sourceStateHash;
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
	if (result.verify.status !== "passed") {
		add(
			`project_verify_${result.verify.status}`,
			`project verify: ${result.verify.status}`,
			"verification.verify",
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
	if (result.suggestedAction === "start_new_run") {
		return [
			"Evidence Check確認時のsourceまたはVerification Documentが変わったため、既存Receiptを保持したまま新しいimplementation Runで再検証する。",
		];
	}
	if (result.suggestedAction === "record_mapping") {
		return [
			"current sourceのrequired automated conditionとactive testcaseの明示mappingを記録する。",
		];
	}
	if (
		result.suggestedAction === "run_check" ||
		result.suggestedAction === "run_structured_tests"
	) {
		return [
			"mappingされた同一testcaseをstructured resultが保存されるmanaged checkで実行する。",
		];
	}
	if (result.suggestedAction === "fix_test_failure") {
		return [
			"失敗したmapping対象testcaseまたはproduction実装を修正し、current sourceでmanaged checkを再実行する。",
		];
	}
	if (result.suggestedAction === "recover_test_evidence") {
		return [
			"typed recoveryに従ってtest command、inventory、mapping、runnerのいずれかを修正し、同じRunでmanaged checkを再実行する。",
		];
	}
	if (result.suggestedAction === "report_test_evidence_failure") {
		return [
			"test evidenceのcaptureまたはidentityに関するnon-retryableなhost障害を、typed reasonとともに報告する。",
		];
	}
	if (result.suggestedAction === "request_human_confirmation") {
		return ["required manual conditionにhuman reviewerの確認証跡を追加する。"];
	}
	if (result.confirmation.status === "awaiting_confirmation") {
		return [
			"required conditionのmanaged evidenceとProject正本verifyが揃った状態でEvidence Checkを一度だけ確認する。",
		];
	}
	if (result.confirmation.status === "confirmed") {
		return ["Evidence Check確認後のProject正本verifyを一度実行する。"];
	}
	return [
		...(result.verify.status === "passed"
			? []
			: ["Questionnaireの範囲内でProject正本verifyを一度実行する。"]),
	];
}
