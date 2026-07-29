import { z } from "zod";

export const WORKSPACE_BOOTSTRAP_ADAPTER_IDS = [
	"bun",
	"npm",
	"pnpm",
	"yarn",
	"uv",
	"poetry",
	"pip",
	"bundler",
	"composer",
	"go",
	"cargo",
	"dotnet",
	"maven",
	"gradle",
] as const;

export type WorkspaceBootstrapAdapterId =
	(typeof WORKSPACE_BOOTSTRAP_ADAPTER_IDS)[number];

export type WorkspaceBootstrapComponent = {
	adapterId: WorkspaceBootstrapAdapterId;
	rootRelativePath: string;
	evidencePaths: string[];
};

export type WorkspaceBootstrapCommand = {
	executable: string;
	args: string[];
	env: Record<string, string>;
};

export type WorkspaceBootstrapStamp = {
	schemaVersion: 1;
	adapterId: WorkspaceBootstrapAdapterId;
	adapterContractVersion: 1;
	componentRoot: string;
	inputDigest: string;
	toolVersion: string;
	platform: string;
	architecture: string;
	environmentDigest: string;
	validationKind: string;
	completedAt: string;
};

export type WorkspaceBootstrapComponentEvidence = {
	component: WorkspaceBootstrapComponent;
	status: "installed" | "skipped";
	durationMs: number;
	commands: Array<{ executable: string; args: string[] }>;
	stamp: WorkspaceBootstrapStamp;
};

export type WorkspaceDependencyBootstrapEvidence = {
	version: 1;
	status: "ready" | "not_required";
	startedAt: string;
	completedAt: string;
	components: WorkspaceBootstrapComponentEvidence[];
};

const workspaceBootstrapComponentSchema = z
	.object({
		adapterId: z.enum(WORKSPACE_BOOTSTRAP_ADAPTER_IDS),
		rootRelativePath: z.string().min(1),
		evidencePaths: z.array(z.string().min(1)),
	})
	.strict();

const workspaceBootstrapStampSchema = z
	.object({
		schemaVersion: z.literal(1),
		adapterId: z.enum(WORKSPACE_BOOTSTRAP_ADAPTER_IDS),
		adapterContractVersion: z.literal(1),
		componentRoot: z.string().min(1),
		inputDigest: z.string().min(1),
		toolVersion: z.string().min(1).max(256),
		platform: z.string().min(1),
		architecture: z.string().min(1),
		environmentDigest: z.string().min(1),
		validationKind: z.string().min(1),
		completedAt: z.string().datetime(),
	})
	.strict();

const workspaceBootstrapComponentEvidenceSchema = z
	.object({
		component: workspaceBootstrapComponentSchema,
		status: z.enum(["installed", "skipped"]),
		durationMs: z.number().nonnegative(),
		commands: z.array(
			z
				.object({
					executable: z.string().min(1),
					args: z.array(z.string()),
				})
				.strict(),
		),
		stamp: workspaceBootstrapStampSchema,
	})
	.strict();

export const workspaceDependencyBootstrapEvidenceSchema: z.ZodType<WorkspaceDependencyBootstrapEvidence> =
	z
		.object({
			version: z.literal(1),
			status: z.enum(["ready", "not_required"]),
			startedAt: z.string().datetime(),
			completedAt: z.string().datetime(),
			components: z.array(workspaceBootstrapComponentEvidenceSchema),
		})
		.strict();

export const WORKSPACE_BOOTSTRAP_ERROR_CODES = [
	"BOOTSTRAP_ADAPTER_UNSUPPORTED",
	"BOOTSTRAP_MANAGER_AMBIGUOUS",
	"BOOTSTRAP_EXECUTABLE_NOT_FOUND",
	"BOOTSTRAP_LOCK_REQUIRED",
	"BOOTSTRAP_LOCK_MISMATCH",
	"WORKSPACE_DEPENDENCY_ROOT_SYMLINK_FORBIDDEN",
	"DEPENDENCY_INSTALL_TIMEOUT",
	"DEPENDENCY_INSTALL_CANCELLED",
	"DEPENDENCY_INSTALL_FAILED",
	"DEPENDENCY_STATE_INVALID",
] as const;

export type WorkspaceBootstrapErrorCode =
	(typeof WORKSPACE_BOOTSTRAP_ERROR_CODES)[number];

export class WorkspaceBootstrapError extends Error {
	constructor(
		readonly code: WorkspaceBootstrapErrorCode,
		message: string,
		readonly details: {
			stage: "detection" | "fingerprint" | "install" | "validation";
			adapterId?: WorkspaceBootstrapAdapterId;
			componentRoot?: string;
			exitCode?: number | null;
			retryable: boolean;
			redactedStdoutExcerpt?: string;
			redactedStderrExcerpt?: string;
		},
	) {
		super(message);
		this.name = "WorkspaceBootstrapError";
	}
}
