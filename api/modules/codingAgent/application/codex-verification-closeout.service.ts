import { specificationVerificationDocumentSchema } from "../../../../shared/schemas/verification-checklist.schema";
import { runCheckTool } from "../../../services/worker-tools/run-check";
import * as verificationRepository from "../../nightworkers/nightworkers.verification.repository";
import { collectTestInventory } from "../verification/test-inventory.service";
import { captureWorkspaceSourceSnapshot } from "../verification/workspace-source-snapshot";

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
	const plan = specificationVerificationDocumentSchema.parse(
		document.documentJson,
	);
	const policy = input.safetyPolicy ?? {};
	const inventory = await collectTestInventory({
		taskId: input.taskId,
		runId: input.runId,
		repoRoot: input.repositoryRoot,
		...policy,
	});
	const commands = [];
	for (const command of plan.commands) {
		const result = await runCheckTool({
			taskId: input.taskId,
			runId: input.runId,
			verificationDocumentId: document.id,
			repoRoot: input.repositoryRoot,
			cwd: command.cwd,
			command: command.command,
			checkKind: "verify",
			conditionIds: command.conditionIds,
			displayMode: "error_excerpt",
			...policy,
		});
		commands.push({
			id: command.id,
			label: command.label,
			conditionIds: command.conditionIds,
			exitCode: result.payload.exitCode,
			ok: result.ok,
			managedEvidence: result.payload.managedEvidence,
			llmSummary: result.payload.llmSummary,
		});
	}
	const sourceSnapshotAfter = await captureWorkspaceSourceSnapshot(
		input.repositoryRoot,
	);
	const successfulConditionIds = new Set(
		commands
			.filter((command) => command.ok && command.exitCode === 0)
			.flatMap((command) => command.conditionIds),
	);
	const requiredConditionIds = plan.conditions
		.filter((condition) => condition.required)
		.map((condition) => condition.id);
	return {
		applicability: "active" as const,
		verificationDocumentId: document.id,
		inventoryId: inventory.id,
		activeCaseCount: inventory.cases.filter(
			(testCase) => testCase.discoveryLevel === "active",
		).length,
		requiresAutomatedTests: plan.conditions.some(
			(condition) =>
				condition.required && condition.verificationKind === "automated_test",
		),
		requiredConditionIds,
		successfulConditionIds: [...successfulConditionIds],
		missingRequiredConditionIds: requiredConditionIds.filter(
			(conditionId) => !successfulConditionIds.has(conditionId),
		),
		sourceStateHashBefore: inventory.sourceSnapshot.sourceStateHash,
		sourceStateHashAfter: sourceSnapshotAfter.sourceStateHash,
		sourceMutatedDuringCloseout:
			inventory.sourceSnapshot.sourceStateHash !==
			sourceSnapshotAfter.sourceStateHash,
		commands,
	};
}
