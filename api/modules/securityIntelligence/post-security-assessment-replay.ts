import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
	type securityAssessmentAttempts,
	securityAssessmentSubjectBindings,
} from "../../db/security-intelligence-schema";
import { AppError } from "../../lib/errors";

export async function resolveTerminalPostAssessmentAttempt(
	attempt: typeof securityAssessmentAttempts.$inferSelect,
	implementationRunId: string,
) {
	if (
		attempt.phase !== "post_implementation" ||
		attempt.implementationRunId !== implementationRunId
	) {
		throw new AppError(
			409,
			"SECURITY_POST_ASSESSMENT_REPLAY_INTEGRITY_CONFLICT",
			"保存済みassessment attemptのRun identityが一致しません。",
		);
	}
	if (attempt.status === "not_applicable") {
		return {
			status: "not_applicable" as const,
			assessmentAttemptRef: attempt.attemptRef,
			reasonCode: attempt.reasonCode ?? "workspace_source_unchanged",
		};
	}
	if (attempt.status !== "completed") return null;
	const [binding] = await db
		.select()
		.from(securityAssessmentSubjectBindings)
		.where(
			and(
				eq(
					securityAssessmentSubjectBindings.implementationRunId,
					implementationRunId,
				),
				eq(
					securityAssessmentSubjectBindings.assessmentReceiptId,
					attempt.assessmentReceiptId ?? "",
				),
				eq(securityAssessmentSubjectBindings.phase, "post_implementation"),
			),
		)
		.limit(1);
	if (!binding) {
		throw new AppError(
			409,
			"SECURITY_POST_ASSESSMENT_REPLAY_INTEGRITY_CONFLICT",
			"completed assessment attemptのsubject bindingが見つかりません。",
		);
	}
	return {
		status: "completed" as const,
		assessmentAttemptRef: attempt.attemptRef,
		assessmentSubjectBindingRef: binding.bindingRef,
	};
}
