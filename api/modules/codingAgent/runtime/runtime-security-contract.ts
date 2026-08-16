import { createHash } from "node:crypto";
import { listExistingProjectSecretPaths } from "../../../services/security/project-secret-paths";
import { readRuntimeWorkspaceContext } from "./runtime-workspace-context";
import type { AgentRunContext } from "./types";

export type CodexRuntimeSecurityCapability = {
	version: 1;
	matrix: {
		sdkVersion: string;
		cliVersion: string;
		platform: NodeJS.Platform;
		arch: string;
		sandboxMode: "workspace-write";
		approvalPolicy: "never";
		networkAccessEnabled: boolean;
	};
	results: {
		projectEnvRead: boolean;
		projectEnvLocalRead: boolean;
		projectPemRead: boolean;
		registryCredentialRead: boolean;
		workspaceWrite: boolean;
		outsideFileRead: boolean;
		symlinkOutsideRead: boolean;
		outsideFileWrite: boolean;
		childProcess: boolean;
		networkAccess: boolean;
		mcpApprovalMode: "not_measured" | "allowed" | "denied";
		serverAuthorizationRejection: "not_measured" | "allowed" | "denied";
	};
};

export type RuntimeSecurityPreflight =
	| {
			ok: true;
			contract: {
				version: 1;
				workspaceRoot: string;
				secretPathCount: number;
				secretPathDigest: string;
				capability: CodexRuntimeSecurityCapability;
			};
	  }
	| {
			ok: false;
			code:
				| "CODEX_RUNTIME_CAPABILITY_UNMEASURED"
				| "CODEX_RUNTIME_SECURITY_CONTRACT_UNSATISFIED";
			message: string;
			contract: {
				version: 1;
				workspaceRoot: string;
				secretPathCount: number;
				secretPathDigest: string;
				capability: CodexRuntimeSecurityCapability | null;
			};
	  };

const CODEX_RUNTIME_CAPABILITIES: readonly CodexRuntimeSecurityCapability[] = [
	{
		version: 1,
		matrix: {
			sdkVersion: "0.144.4",
			cliVersion: "0.144.4",
			platform: "darwin",
			arch: "arm64",
			sandboxMode: "workspace-write",
			approvalPolicy: "never",
			networkAccessEnabled: false,
		},
		results: {
			projectEnvRead: true,
			projectEnvLocalRead: true,
			projectPemRead: true,
			registryCredentialRead: true,
			workspaceWrite: true,
			outsideFileRead: true,
			symlinkOutsideRead: true,
			outsideFileWrite: true,
			childProcess: true,
			networkAccess: false,
			mcpApprovalMode: "not_measured",
			serverAuthorizationRejection: "not_measured",
		},
	},
];

export async function preflightCodexRuntimeSecurityContract(
	context: AgentRunContext,
): Promise<RuntimeSecurityPreflight> {
	const workspace = readRuntimeWorkspaceContext(context);
	const secretPaths = await listExistingProjectSecretPaths(
		workspace.executionRoot,
	);
	const capability = resolveCodexRuntimeSecurityCapability();
	const contract = {
		version: 1 as const,
		workspaceRoot: workspace.executionRoot,
		secretPathCount: secretPaths.length,
		secretPathDigest: digestSecretPaths(secretPaths),
		capability,
	};
	if (!capability) {
		return {
			ok: false,
			code: "CODEX_RUNTIME_CAPABILITY_UNMEASURED",
			message:
				"Codex runtime security capability has not been measured for this OS and architecture; the runtime is disabled fail-closed.",
			contract,
		};
	}
	if (!isSecurityEquivalent(capability)) {
		return {
			ok: false,
			code: "CODEX_RUNTIME_SECURITY_CONTRACT_UNSATISFIED",
			message:
				"The measured Codex workspace-write sandbox can read project secrets or access paths outside the registered workspace; the runtime is disabled until OS/server enforcement is supplied.",
			contract,
		};
	}
	return {
		ok: true,
		contract: {
			...contract,
			capability,
		},
	};
}

export function resolveCodexRuntimeSecurityCapability(
	platform = process.platform,
	arch = process.arch,
) {
	return (
		CODEX_RUNTIME_CAPABILITIES.find(
			(capability) =>
				capability.matrix.platform === platform &&
				capability.matrix.arch === arch,
		) ?? null
	);
}

function isSecurityEquivalent(capability: CodexRuntimeSecurityCapability) {
	return (
		!capability.results.projectEnvRead &&
		!capability.results.projectEnvLocalRead &&
		!capability.results.projectPemRead &&
		!capability.results.registryCredentialRead &&
		!capability.results.outsideFileRead &&
		!capability.results.symlinkOutsideRead &&
		!capability.results.outsideFileWrite &&
		capability.results.mcpApprovalMode !== "not_measured" &&
		capability.results.serverAuthorizationRejection === "denied"
	);
}

function digestSecretPaths(secretPaths: readonly string[]) {
	return `sha256:${createHash("sha256")
		.update(JSON.stringify(secretPaths))
		.digest("hex")}`;
}
