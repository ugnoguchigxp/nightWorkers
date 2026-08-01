import { z } from "@hono/zod-openapi";
import {
	expectedEvidenceSchema,
	verificationKindSchema,
} from "../../schemas/verification-checklist.schema";
import { evidenceCheckAssuranceStatusSchema } from "./evidence-check-contract";

export const RUN_CHECK_MANAGED_EVIDENCE_DESCRIPTION_JA =
	"登録済みrepositoryで選択したcheck commandを実行し、current source snapshot、evidence kind、condition scope、取得できたstructured testcaseをmanaged evidenceとして保存します。automated conditionには対応testcaseのstructured resultが必要で、raw shellや別testの成功は代替になりません。TodoやRun statusは更新しません。";

export const COMPLETION_CHECK_ASSURANCE_DESCRIPTION_JA =
	"現在のsource、test inventory、明示mapping、structured execution、command gateを受け入れ条件ごとに再評価し、missing、stale、failed、details missingをtyped resultで返します。判定はTodoやRun statusを更新せず、次actionはCoding Agentが選びます。";

export const ACCEPTANCE_CONDITION_ASSURANCE_REASON_CODES = [
	"CONDITION_MAPPING_MISSING",
	"CONDITION_CASE_EXECUTION_MISSING",
	"CONDITION_CASE_DETAILS_MISSING",
	"CONDITION_CASE_FAILED",
	"CONDITION_CASE_SKIPPED",
	"CONDITION_EVIDENCE_KIND_MISMATCH",
	"CONDITION_EVIDENCE_STALE",
	"CONDITION_SOURCE_MUTATED",
	"CONDITION_COMMAND_SCOPE_MISSING",
	"MANUAL_CONFIRMATION_MISSING",
	"FULL_VERIFY_MISSING",
	"FULL_VERIFY_FAILED",
	"TEST_INVENTORY_MISSING",
] as const;

export const acceptanceConditionAssuranceReasonCodeSchema = z.enum(
	ACCEPTANCE_CONDITION_ASSURANCE_REASON_CODES,
);

export const acceptanceConditionEvidenceRefSchema = z
	.object({
		evidenceRunId: z.string().min(1),
		caseKey: z.string().min(1).optional(),
		evidenceKind: expectedEvidenceSchema,
		sourceStateHash: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict();

export const acceptanceConditionAssuranceSchema = z
	.object({
		conditionId: z.string().regex(/^AC-\d{3}$/),
		required: z.boolean(),
		verificationKind: verificationKindSchema,
		expectedEvidence: z.array(expectedEvidenceSchema),
		assuranceStatus: evidenceCheckAssuranceStatusSchema,
		reasonCode: acceptanceConditionAssuranceReasonCodeSchema.nullable(),
		evidenceRefs: z.array(acceptanceConditionEvidenceRefSchema),
	})
	.strict();

export type AcceptanceConditionAssuranceReasonCode = z.infer<
	typeof acceptanceConditionAssuranceReasonCodeSchema
>;
export type AcceptanceConditionEvidenceRef = z.infer<
	typeof acceptanceConditionEvidenceRefSchema
>;
export type AcceptanceConditionAssurance = z.infer<
	typeof acceptanceConditionAssuranceSchema
>;
