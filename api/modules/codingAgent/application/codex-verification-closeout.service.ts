import * as verificationRepository from "../../nightworkers/nightworkers.verification.repository";
import { runCompletionCheck } from "./completion-check.service";

/**
 * Finalization is read-only. The Coding Agent owns verification command
 * selection and execution during its turn; closeout only observes whether the
 * Evidence Artifact is ready.
 */
export async function executeCodexVerificationCloseout(input: {
	taskId: string;
	runId: string;
	repositoryRoot: string;
	safetyPolicy?: {
		allowedPaths?: string[];
		externalAllowedPaths?: string[];
		deniedPaths?: string[];
		blockedCommands?: string[];
		maxCommandSeconds?: number;
	};
}) {
	const document =
		await verificationRepository.getLatestActiveVerificationDocumentForTask(
			input.taskId,
		);
	if (!document) {
		return { applicability: "not_configured" as const, commands: [] };
	}
	const completionCheck = await runCompletionCheck({
		taskId: input.taskId,
		runId: input.runId,
		verificationDocumentId: document.id,
		repoRoot: input.repositoryRoot,
	});
	return {
		applicability: "active" as const,
		verificationDocumentId: document.id,
		completionCheck,
		commands: [],
		mapping: completionCheck.mapping,
		verify: completionCheck.verify,
		sourceStateHash: completionCheck.sourceStateHash,
	};
}
