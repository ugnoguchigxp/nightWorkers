import { z } from "zod";

export const securityOracleResultSchema = z
	.object({
		ok: z.boolean(),
		status: z.enum([
			"completed",
			"security_action_required",
			"inconclusive",
			"config_error",
			"runtime_error",
		]),
		project: z
			.object({
				id: z.string(),
				repoPath: z.string(),
				created: z.boolean(),
			})
			.strict()
			.nullable(),
		scan: z
			.object({
				scanRunId: z.string(),
				profile: z.string(),
				findingCount: z.number().int().nonnegative(),
				highOrCriticalCount: z.number().int().nonnegative(),
				findingsTruncated: z.boolean(),
				blockingFingerprints: z.array(z.string()),
				findings: z.array(
					z
						.object({
							id: z.string(),
							fingerprint: z.string(),
							severity: z.string(),
							tool: z.string(),
							ruleId: z.string(),
							title: z.string(),
							location: z
								.object({
									path: z.string(),
									line: z.number().int().nullable(),
								})
								.strict()
								.nullable(),
							recommendation: z.string(),
						})
						.strict(),
				),
			})
			.strict()
			.nullable(),
		review: z
			.object({
				status: z.enum(["not_requested", "completed", "failed", "skipped"]),
				reviewId: z.string().optional(),
				improvementRequest: z.string().optional(),
				error: z.string().optional(),
			})
			.strict(),
		nextAction: z.enum([
			"none",
			"apply_security_fix",
			"run_scan_review",
			"configure_provider",
			"inspect_diagnostic_failure",
		]),
		error: z
			.object({ code: z.string(), message: z.string() })
			.strict()
			.optional(),
	})
	.strict();
export type SecurityOracleResult = z.infer<typeof securityOracleResultSchema>;

export const securityGateResultSchema = z
	.object({
		version: z.literal(1),
		status: z.enum(["passed", "continue", "needs_human"]),
		allowFinalize: z.boolean(),
		scanRunId: z.string().nullable(),
		previousScanRunId: z.string().nullable(),
		blockingFingerprints: z.array(z.string()),
		previousBlockingFingerprints: z.array(z.string()),
		comparison: z.enum([
			"initial",
			"resolved",
			"still_present",
			"changed",
			"scanner_failed",
		]),
		iteration: z.number().int().positive(),
		maxIterations: z.number().int().positive(),
		message: z.string(),
		findingCount: z.number().int().nonnegative(),
		highOrCriticalCount: z.number().int().nonnegative(),
		securityFixTodoId: z.string().nullable(),
	})
	.strict();
export type SecurityGateResult = z.infer<typeof securityGateResultSchema>;
