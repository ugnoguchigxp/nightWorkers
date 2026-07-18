import { z } from "zod";

export const verificationConditionCategorySchema = z.enum([
	"api",
	"ui",
	"db",
	"validation",
	"auth",
	"workflow",
	"migration",
	"quality",
	"other",
]);

export const verificationKindSchema = z.enum([
	"automated_test",
	"command_gate",
	"manual",
	"not_applicable",
]);

export const expectedEvidenceSchema = z.enum([
	"unit_test",
	"integration_test",
	"e2e_test",
	"typecheck",
	"lint",
	"format_check",
	"build",
	"coverage",
	"migration_check",
	"manual_evidence",
]);

export const verificationRunnerSchema = z.enum([
	"vitest",
	"jest",
	"pytest",
	"cargo-test",
	"cargo-nextest",
	"go-test",
	"playwright",
	"junit",
	"unknown",
]);

/**
 * Discovery is intentionally distinct from execution.  A filename candidate is
 * useful to the Coding Agent, but can never by itself satisfy a quality gate.
 */
export const testDiscoveryLevelSchema = z.enum([
	"active",
	"candidate",
	"unknown",
]);

export const testDefinitionSourceSchema = z.enum([
	"declared_in_test",
	"coding_agent_assessment",
]);

export const workspaceSourceSnapshotSchema = z
	.object({
		sourceStateHash: z.string().regex(/^[a-f0-9]{64}$/),
		gitHead: z.string().trim().min(1).nullable(),
		fileCount: z.number().int().nonnegative(),
		capturedAt: z.string().datetime(),
	})
	.strict();

export const testInventoryCaseSchema = z
	.object({
		caseKey: z.string().trim().min(1),
		name: z.string().trim().min(1),
		filePath: z.string().trim().min(1),
		runner: verificationRunnerSchema,
		discoveryLevel: testDiscoveryLevelSchema,
		declaredConditionIds: z.array(z.string().regex(/^AC-\d{3}$/)),
	})
	.strict();

export const testInventorySchema = z
	.object({
		id: z.string().trim().min(1),
		taskId: z.string().trim().min(1),
		runId: z.string().trim().min(1).optional(),
		cwd: z.string().trim().min(1),
		sourceSnapshot: workspaceSourceSnapshotSchema,
		createdAt: z.string().datetime(),
		cases: z.array(testInventoryCaseSchema),
		warnings: z.array(z.string().trim().min(1)),
	})
	.strict();

export const testConditionMappingSchema = z
	.object({
		id: z.string().trim().min(1),
		taskId: z.string().trim().min(1),
		verificationDocumentId: z.string().trim().min(1),
		inventoryId: z.string().trim().min(1),
		caseKey: z.string().trim().min(1),
		conditionId: z.string().regex(/^AC-\d{3}$/),
		source: testDefinitionSourceSchema,
		rationale: z.string().trim().min(1).max(4_000).optional(),
		sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
		createdAt: z.string().datetime(),
	})
	.strict()
	.superRefine((mapping, ctx) => {
		if (mapping.source === "coding_agent_assessment" && !mapping.rationale) {
			ctx.addIssue({
				code: "custom",
				path: ["rationale"],
				message: "coding_agent_assessment requires rationale",
			});
		}
	});

export const verificationCommandScopeSchema = z.enum([
	"focused",
	"full_gate",
	"manual",
]);

export const verificationConditionSchema = z
	.object({
		id: z.string().regex(/^AC-\d{3}$/),
		text: z.string().trim().min(1),
		category: verificationConditionCategorySchema,
		verificationKind: verificationKindSchema,
		expectedEvidence: z.array(expectedEvidenceSchema).min(1),
		expectedResult: z.string().trim().min(1),
		failureMeaning: z.string().trim().min(1),
		required: z.boolean(),
		status: z.literal("pending"),
	})
	.strict()
	.superRefine((condition, ctx) => {
		if (condition.required && condition.verificationKind === "not_applicable") {
			ctx.addIssue({
				code: "custom",
				path: ["verificationKind"],
				message: "required condition must be verifiable",
			});
		}
	});

export const verificationCommandPlanSchema = z
	.object({
		id: z.string().trim().min(1),
		label: z.string().trim().min(1),
		command: z.string().trim().min(1),
		cwd: z.string().trim().min(1).optional(),
		conditionIds: z.array(z.string().regex(/^AC-\d{3}$/)),
		scope: verificationCommandScopeSchema,
		runnerHint: verificationRunnerSchema.optional(),
	})
	.strict();

export const specificationVerificationDocumentSchema = z
	.object({
		version: z.literal(1),
		specId: z.string().trim().min(1),
		specPath: z.string().trim().min(1),
		generatedAt: z.string().datetime(),
		source: z
			.object({
				taskId: z.string().trim().min(1),
				sourceMessageIds: z.array(z.string().trim().min(1)),
				workspaceArtifactIds: z.array(z.string().trim().min(1)),
			})
			.strict(),
		conditions: z.array(verificationConditionSchema),
		commands: z.array(verificationCommandPlanSchema),
		nonGoals: z.array(z.string()),
	})
	.strict()
	.superRefine((document, ctx) => {
		const ids = new Set<string>();
		for (const [index, condition] of document.conditions.entries()) {
			if (ids.has(condition.id)) {
				ctx.addIssue({
					code: "custom",
					path: ["conditions", index, "id"],
					message: `duplicate condition id: ${condition.id}`,
				});
			}
			ids.add(condition.id);
		}
		for (const [commandIndex, command] of document.commands.entries()) {
			for (const [
				conditionIndex,
				conditionId,
			] of command.conditionIds.entries()) {
				if (!ids.has(conditionId)) {
					ctx.addIssue({
						code: "custom",
						path: ["commands", commandIndex, "conditionIds", conditionIndex],
						message: `unknown condition id: ${conditionId}`,
					});
				}
			}
		}
	});

export const verificationChecklistItemStatusSchema = z.enum([
	"pending",
	"covered",
	"passed",
	"failed",
	"verified_by_gate",
	"manual",
	"unknown",
	"not_applicable",
]);

export const verificationChecklistItemSchema = z
	.object({
		id: z.string().trim().min(1),
		conditionId: z.string().regex(/^AC-\d{3}$/),
		text: z.string().trim().min(1),
		required: z.boolean(),
		verificationKind: verificationKindSchema.optional(),
		expectedEvidence: z.array(expectedEvidenceSchema).optional(),
		status: verificationChecklistItemStatusSchema,
		evidenceIds: z.array(z.string().trim().min(1)),
		lastCheckedAt: z.string().datetime().optional(),
		reason: z.string().optional(),
	})
	.strict();

export const normalizedTestCaseEvidenceSchema = z
	.object({
		id: z.string().trim().min(1),
		name: z.string().trim().min(1),
		filePath: z.string().trim().min(1).optional(),
		status: z.enum(["passed", "failed", "skipped", "unknown"]),
		durationMs: z.number().nonnegative().optional(),
		conditionIds: z.array(z.string().regex(/^AC-\d{3}$/)),
		failureMessage: z.string().optional(),
	})
	.strict();

export const normalizedVerificationEvidenceSchema = z
	.object({
		id: z.string().trim().min(1),
		runId: z.string().trim().min(1),
		taskId: z.string().trim().min(1),
		command: z.string().trim().min(1),
		cwd: z.string().trim().min(1),
		startedAt: z.string().datetime(),
		finishedAt: z.string().datetime(),
		durationMs: z.number().nonnegative(),
		exitCode: z.number().int(),
		runner: verificationRunnerSchema,
		rawStdoutArtifactId: z.string().trim().min(1),
		rawStderrArtifactId: z.string().trim().min(1),
		parsedArtifactId: z.string().trim().min(1).optional(),
		summary: z
			.object({
				passed: z.number().int().nonnegative().nullable(),
				failed: z.number().int().nonnegative().nullable(),
				skipped: z.number().int().nonnegative().nullable(),
				total: z.number().int().nonnegative().nullable(),
			})
			.strict(),
		cases: z.array(normalizedTestCaseEvidenceSchema),
		commandLevelConditionIds: z.array(z.string().regex(/^AC-\d{3}$/)),
		sourceSnapshot: workspaceSourceSnapshotSchema.optional(),
		testExecutionObserved: z.boolean().optional(),
		sourceMutatedDuringCheck: z.boolean().optional(),
	})
	.strict();

export type SpecificationVerificationDocument = z.infer<
	typeof specificationVerificationDocumentSchema
>;
export type VerificationCondition = z.infer<typeof verificationConditionSchema>;
export type ExpectedEvidence = z.infer<typeof expectedEvidenceSchema>;
export type VerificationCommandPlan = z.infer<
	typeof verificationCommandPlanSchema
>;
export type VerificationChecklistItemStatus = z.infer<
	typeof verificationChecklistItemStatusSchema
>;
export type VerificationChecklistItem = z.infer<
	typeof verificationChecklistItemSchema
>;
export type NormalizedVerificationEvidence = z.infer<
	typeof normalizedVerificationEvidenceSchema
>;
export type NormalizedTestCaseEvidence = z.infer<
	typeof normalizedTestCaseEvidenceSchema
>;
export type WorkspaceSourceSnapshot = z.infer<
	typeof workspaceSourceSnapshotSchema
>;
export type TestInventoryCase = z.infer<typeof testInventoryCaseSchema>;
export type TestInventory = z.infer<typeof testInventorySchema>;
export type TestConditionMapping = z.infer<typeof testConditionMappingSchema>;

const COMPLETE_STATUSES = new Set<VerificationChecklistItemStatus>([
	"covered",
	"passed",
	"manual",
	"not_applicable",
]);

export function isVerificationChecklistItemComplete(item: {
	required: boolean;
	status: unknown;
}): boolean {
	if (!item.required) return true;
	const status = verificationChecklistItemStatusSchema.safeParse(item.status);
	return status.success && COMPLETE_STATUSES.has(status.data);
}
