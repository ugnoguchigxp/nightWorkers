import { eq } from "drizzle-orm";
import type { SecurityFinalJudgmentV1 } from "../../../shared/schemas/security-intelligence-runtime.schema";
import { db } from "../../db/client";
import { taskRuns } from "../../db/schema-task-runs";
import {
	findSecurityFinalJudgment,
	submitSecurityFinalJudgment,
} from "./security-final-judgment.service";
import {
	getCurrentCompletionConditions,
	getCurrentSecurityContract,
} from "./security-intelligence.repository";

type GateResult =
	| {
			required: false;
			valid: true;
			judgment: null;
			conditionRefs: [];
			contractRef: string | null;
	  }
	| {
			required: true;
			valid: true;
			judgment: SecurityFinalJudgmentV1;
			conditionRefs: string[];
			contractRef: string;
	  }
	| {
			required: true;
			valid: false;
			judgment: null;
			conditionRefs: string[];
			contractRef: string | null;
			reasonCode: string;
			message: string;
			invalidJudgment?: SecurityFinalJudgmentV1;
	  };

function errorCode(error: unknown) {
	return error && typeof error === "object" && "code" in error
		? String(error.code)
		: "SECURITY_FINAL_JUDGMENT_INVALID";
}

export async function evaluateSecurityFinalizationGate(input: {
	runId: string;
	proposedJudgment?: SecurityFinalJudgmentV1;
}): Promise<GateResult> {
	const [run] = await db
		.select()
		.from(taskRuns)
		.where(eq(taskRuns.id, input.runId))
		.limit(1);
	if (!run?.taskRevisionSnapshotId) {
		return {
			required: false,
			valid: true,
			judgment: null,
			conditionRefs: [],
			contractRef: null,
		};
	}
	const [contractHead, conditions] = await Promise.all([
		getCurrentSecurityContract(run.taskRevisionSnapshotId),
		getCurrentCompletionConditions(run.taskRevisionSnapshotId),
	]);
	const conditionRefs = conditions
		.map((entry) => entry.condition)
		.filter((condition) => condition.state === "adopted")
		.map((condition) => condition.conditionRef)
		.sort();
	if (conditionRefs.length === 0) {
		return {
			required: false,
			valid: true,
			judgment: null,
			conditionRefs: [],
			contractRef: contractHead?.contract.contractRef ?? null,
		};
	}
	if (!contractHead) {
		return {
			required: true,
			valid: false,
			judgment: null,
			conditionRefs,
			contractRef: null,
			reasonCode: "SECURITY_FINAL_JUDGMENT_CONTRACT_MISSING",
			message:
				"採用済みcompletion conditionに対応するcurrent Security Contractがありません。",
		};
	}
	if (!["running", "finalizing", "verifying"].includes(run.status)) {
		return {
			required: true,
			valid: false,
			judgment: null,
			conditionRefs,
			contractRef: contractHead.contract.contractRef,
			reasonCode: "SECURITY_FINAL_JUDGMENT_RUN_STATUS_CONFLICT",
			message: `Final Judgmentを受理できないRun statusです: ${run.status}`,
		};
	}
	const existing = await findSecurityFinalJudgment(run.id);
	const judgment = existing ?? input.proposedJudgment;
	if (!judgment) {
		return {
			required: true,
			valid: false,
			judgment: null,
			conditionRefs,
			contractRef: contractHead.contract.contractRef,
			reasonCode: "SECURITY_FINAL_JUDGMENT_MISSING",
			message:
				"採用済みcompletion conditionに対するFinal Judgmentがありません。",
		};
	}
	try {
		const accepted = await submitSecurityFinalJudgment({
			version: 1,
			runId: run.id,
			expectedRunStatus: run.status,
			expectedTaskRevisionSnapshotId: run.taskRevisionSnapshotId,
			expectedSecurityContractRef: contractHead.contract.contractRef,
			expectedConditionRefs: conditionRefs,
			judgment,
		});
		return {
			required: true,
			valid: true,
			judgment: accepted,
			conditionRefs,
			contractRef: contractHead.contract.contractRef,
		};
	} catch (error) {
		return {
			required: true,
			valid: false,
			judgment: null,
			conditionRefs,
			contractRef: contractHead.contract.contractRef,
			reasonCode: errorCode(error),
			message:
				error instanceof Error ? error.message : "Final Judgmentが不正です。",
			invalidJudgment: judgment,
		};
	}
}

export function buildSecurityFinalJudgmentContinuation(input: {
	contractRef: string | null;
	conditionRefs: string[];
	reasonCode: string;
	message: string;
}) {
	return [
		"Security Final Judgmentの構造的closeoutが未完了です。",
		"最終本文から値を補完せず、現在のSecurity Contract Contextを確認してください。",
		"必要なassessmentまたはverificationを実行し、submit_security_final_judgment toolで厳密なstructured judgmentを提出してください。",
		`contractRef: ${input.contractRef ?? "missing"}`,
		`conditionRefs: ${JSON.stringify(input.conditionRefs)}`,
		`reasonCode: ${input.reasonCode}`,
		`detail: ${input.message}`,
	].join("\n");
}
