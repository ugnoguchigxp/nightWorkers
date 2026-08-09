import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
	type SecurityScanCapabilities,
	securityScanCapabilitiesSchema,
} from "../../../shared/schemas/security-scan.schema";
import { AppError } from "../../lib/errors";
import { redactSecretText } from "../../services/security/secret-redaction";
import {
	buildVulnWorkbenchCliEnv,
	resolveVulnWorkbenchBunExecutable,
} from "../../services/vulnworkbench-cli-runtime";
import type { VulnWorkbenchCliSettings } from "../review/review-vulnworkbench.service";

const execFileAsync = promisify(execFile);

const profilePlanSchema = z
	.object({
		dryRun: z.literal(true),
		profileId: z.string().min(1).max(128),
		resolvedSteps: z.array(
			z
				.object({
					kind: z.string().min(1).max(64),
					id: z.string().min(1).max(128),
					displayName: z.string().min(1).max(256),
					required: z.boolean(),
					timeoutSec: z.number().int().positive(),
				})
				.passthrough(),
		),
	})
	.passthrough();

const diffPreviewSchema = z
	.object({
		ok: z.literal(true),
		preview: z.literal(true),
		profileId: z.string().min(1).max(128),
		target: z
			.object({
				kind: z.literal("working_tree"),
				targetDigest: z.string().regex(/^[0-9a-f]{64}$/),
				baseSha: z.string().min(1).max(128),
				changedFileCount: z.number().int().nonnegative(),
			})
			.passthrough(),
		coverage: z
			.object({
				unsupported: z.number().int().nonnegative(),
				tooLarge: z.number().int().nonnegative(),
			})
			.passthrough(),
		tools: z.array(
			z
				.object({
					toolId: z.string().min(1).max(128),
					applicability: z.enum(["applicable", "not_applicable"]),
					reasonCode: z.string().max(128).nullable(),
				})
				.passthrough(),
		),
	})
	.passthrough();

export type LocalCliProfilePlan = z.infer<typeof profilePlanSchema>;
export type LocalCliDiffPreview = z.infer<typeof diffPreviewSchema>;

export async function loadVulnWorkbenchCliCapabilities(
	projectPath: string,
	settings: VulnWorkbenchCliSettings,
): Promise<SecurityScanCapabilities> {
	return securityScanCapabilitiesSchema.parse(
		await runCliJson(
			[
				"run",
				"api/cli/nightworkers-security-capabilities.ts",
				"--project-path",
				projectPath,
			],
			settings,
		),
	);
}

export async function loadVulnWorkbenchCliProfilePlan(
	profileRef: string,
	targetKind: "full" | "working_tree",
	settings: VulnWorkbenchCliSettings,
): Promise<LocalCliProfilePlan> {
	return profilePlanSchema.parse(
		await runCliJson(
			[
				"run",
				"api/cli/scan-profile.ts",
				"--profile",
				profileRef,
				"--target",
				targetKind === "working_tree" ? "working-tree" : "full",
				"--dry-run",
				"true",
			],
			settings,
		),
	);
}

export async function loadVulnWorkbenchCliDiffPreview(
	projectPath: string,
	profileRef: string,
	settings: VulnWorkbenchCliSettings,
): Promise<LocalCliDiffPreview> {
	return diffPreviewSchema.parse(
		await runCliJson(
			[
				"run",
				"api/cli/scan-profile.ts",
				"--project-path",
				projectPath,
				"--create-project",
				"true",
				"--profile",
				profileRef,
				"--target",
				"working-tree",
				"--preview",
				"true",
			],
			settings,
		),
	);
}

async function runCliJson(args: string[], settings: VulnWorkbenchCliSettings) {
	if (!settings.enabled) {
		throw new AppError(
			409,
			"SECURITY_SCAN_LOCAL_CLI_NOT_CONFIGURED",
			"vulnWorkbench CLIが無効です。",
		);
	}
	try {
		const result = await execFileAsync(
			resolveVulnWorkbenchBunExecutable(),
			args,
			{
				cwd: settings.cwd,
				env: buildVulnWorkbenchCliEnv(),
				timeout: Math.max(1, settings.timeoutSeconds) * 1_000,
				maxBuffer: 20 * 1024 * 1024,
			},
		);
		return parseLastJson(result.stdout);
	} catch (error) {
		const output = commandOutput(error);
		const payload = parseLastJson(output, false);
		const message =
			payload &&
			typeof payload === "object" &&
			"message" in payload &&
			typeof payload.message === "string"
				? payload.message
				: output.trim() ||
					(error instanceof Error ? error.message : String(error));
		throw new AppError(
			502,
			"SECURITY_SCAN_LOCAL_CLI_COMMAND_FAILED",
			redactSecretText(message).slice(0, 1024),
		);
	}
}

function parseLastJson(output: string, required = true): unknown {
	const lines = output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	for (const candidate of [...lines].reverse()) {
		try {
			return JSON.parse(candidate);
		} catch {}
	}
	if (!required) return null;
	throw new AppError(
		502,
		"SECURITY_SCAN_LOCAL_CLI_OUTPUT_INVALID",
		"vulnWorkbench CLIが有効なJSONを返しませんでした。",
	);
}

function commandOutput(error: unknown) {
	if (!error || typeof error !== "object") return "";
	const record = error as { stdout?: unknown; stderr?: unknown };
	return [record.stdout, record.stderr]
		.filter((value): value is string => typeof value === "string")
		.join("\n");
}
