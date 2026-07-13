import type {
	NormalizedVerificationEvidence,
	VerificationChecklistItem,
	VerificationChecklistItemStatus,
} from "../../../shared/schemas/verification-checklist.schema";
import { isVerificationChecklistItemComplete } from "../../../shared/schemas/verification-checklist.schema";

export type ChecklistMatchResult = {
	items: VerificationChecklistItem[];
	complete: boolean;
	failedRequired: VerificationChecklistItem[];
	unknownRequired: VerificationChecklistItem[];
};

export function applyEvidenceToChecklist(input: {
	items: VerificationChecklistItem[];
	evidence: NormalizedVerificationEvidence;
	fullGate?: boolean;
}): VerificationChecklistItem[] {
	const evidenceId = input.evidence.id;
	const byCondition = new Map(
		input.items.map((item) => [item.conditionId, item]),
	);
	const next = input.items.map((item) => ({ ...item }));
	const nextByCondition = new Map(next.map((item) => [item.conditionId, item]));
	const touched = new Set<string>();
	const failedInCurrentEvidence = new Set<string>();

	for (const testCase of input.evidence.cases) {
		for (const conditionId of testCase.conditionIds) {
			const item = nextByCondition.get(conditionId);
			if (!item) continue;
			touched.add(conditionId);
			if (testCase.status === "failed") {
				failedInCurrentEvidence.add(conditionId);
			} else if (failedInCurrentEvidence.has(conditionId)) {
				continue;
			}
			const status = statusForTestCase(testCase.status);
			updateItem(item, {
				status,
				evidenceId,
				reason:
					testCase.status === "failed"
						? testCase.failureMessage || "対応する test case が失敗しました。"
						: testCase.status === "passed"
							? "対応する test case が成功しました。"
							: "対応する test case は完了証跡として扱えませんでした。",
			});
		}
	}

	for (const conditionId of input.evidence.commandLevelConditionIds) {
		const item =
			nextByCondition.get(conditionId) ?? byCondition.get(conditionId);
		if (!item) continue;
		const mutable = nextByCondition.get(conditionId);
		if (!mutable) continue;
		touched.add(conditionId);
		if (
			failedInCurrentEvidence.has(conditionId) &&
			input.evidence.exitCode === 0
		) {
			continue;
		}
		updateItem(mutable, {
			status: input.evidence.exitCode === 0 ? "covered" : "failed",
			evidenceId,
			reason:
				input.evidence.exitCode === 0
					? "対応する managed check command が成功しました。"
					: "対応する managed check command が失敗しました。",
		});
	}

	if (input.fullGate && input.evidence.exitCode === 0) {
		for (const item of next) {
			if (!item.required || touched.has(item.conditionId)) continue;
			if (
				item.status === "pending" ||
				item.status === "unknown" ||
				item.status === "verified_by_gate"
			) {
				updateItem(item, {
					status: "verified_by_gate",
					evidenceId,
					reason:
						"full gate は成功しましたが、condition 単位の test case 対応は未検出です。",
				});
			}
		}
	}

	if (input.evidence.exitCode !== 0 && touched.size === 0) {
		for (const item of next) {
			if (!item.required) continue;
			if (item.status === "pending") {
				updateItem(item, {
					status: "unknown",
					evidenceId,
					reason:
						"managed check は失敗しましたが、この condition との対応は判定できませんでした。",
				});
			}
		}
	}

	return next;
}

export function summarizeChecklist(items: VerificationChecklistItem[]) {
	const failedRequired = items.filter(
		(item) => item.required && item.status === "failed",
	);
	const unknownRequired = items.filter(
		(item) =>
			item.required &&
			item.status !== "failed" &&
			!isVerificationChecklistItemComplete(item),
	);
	const complete =
		items.some((item) => item.required) &&
		items.every(isVerificationChecklistItemComplete);
	return { items, complete, failedRequired, unknownRequired };
}

function statusForTestCase(
	status: NormalizedVerificationEvidence["cases"][number]["status"],
): VerificationChecklistItemStatus {
	if (status === "failed") return "failed";
	if (status === "passed") return "passed";
	return "unknown";
}

function updateItem(
	item: VerificationChecklistItem,
	input: {
		status: VerificationChecklistItemStatus;
		evidenceId: string;
		reason: string;
	},
) {
	const shouldReplace =
		item.status !== "failed" ||
		input.status === "failed" ||
		input.status === "passed" ||
		input.status === "covered";
	if (!shouldReplace) return;
	item.status = input.status;
	item.reason = input.reason;
	item.lastCheckedAt = new Date().toISOString();
	item.evidenceIds = Array.from(
		new Set([...item.evidenceIds, input.evidenceId]),
	);
}
