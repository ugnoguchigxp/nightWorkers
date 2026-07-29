import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import {
	type WorkspaceArtifactRef,
	workspaceArtifactRefSchema,
} from "../../../shared/schemas/workspace-authority.schema";
import { db } from "../../db/client";
import {
	taskGitWorkspaces,
	taskRuns,
	workspaceAttestations,
} from "../../db/schema";
import { buildChildProcessEnvironment } from "../execution/child-process-environment";
import { isProjectSecretPath } from "../security/project-secret-paths";

const execFileAsync = promisify(execFile);

export async function validateWorkspaceArtifactRef(input: {
	runId: string;
	ref: WorkspaceArtifactRef;
}) {
	const ref = workspaceArtifactRefSchema.parse(input.ref);
	const [run] = await db
		.select()
		.from(taskRuns)
		.where(eq(taskRuns.id, input.runId));
	if (
		!run?.workspaceId ||
		run.workspaceId !== ref.workspaceId ||
		run.workspaceAllocationVersion !== ref.allocationVersion ||
		!run.admissionAttestationId
	) {
		throw new Error("WORKSPACE_ARTIFACT_BINDING_MISMATCH");
	}
	const [workspace] = await db
		.select()
		.from(taskGitWorkspaces)
		.where(
			and(
				eq(taskGitWorkspaces.id, ref.workspaceId),
				eq(taskGitWorkspaces.allocationVersion, ref.allocationVersion),
			),
		);
	const [attestation] = await db
		.select()
		.from(workspaceAttestations)
		.where(eq(workspaceAttestations.id, run.admissionAttestationId));
	if (
		!workspace ||
		!attestation ||
		attestation.workspaceId !== workspace.id ||
		attestation.digest !== run.admissionAttestationDigest ||
		ref.observedHeadSha !== attestation.headSha
	) {
		throw new Error("WORKSPACE_ARTIFACT_ATTESTATION_MISMATCH");
	}
	const root = await fs.realpath(
		workspace.taskWorktreePathCanonical ?? workspace.worktreePath ?? "",
	);
	const target = path.resolve(root, ref.relativePath);
	const relative = path.relative(root, target);
	if (
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative) ||
		isProjectSecretPath(target, root)
	) {
		throw new Error("WORKSPACE_ARTIFACT_PATH_DENIED");
	}
	const canonicalTarget = await fs.realpath(target);
	const canonicalRelative = path.relative(root, canonicalTarget);
	if (
		canonicalRelative === ".." ||
		canonicalRelative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(canonicalRelative) ||
		isProjectSecretPath(canonicalTarget, root)
	) {
		throw new Error("WORKSPACE_ARTIFACT_PATH_DENIED");
	}
	const containingTopLevel = await execFileAsync(
		"git",
		["-C", path.dirname(canonicalTarget), "rev-parse", "--show-toplevel"],
		{
			env: buildChildProcessEnvironment({ purpose: "git" }),
			timeout: 10_000,
			maxBuffer: 1024 * 1024,
		},
	)
		.then((result) => fs.realpath(result.stdout.trim()))
		.catch(() => null);
	if (containingTopLevel !== root) {
		throw new Error("WORKSPACE_ARTIFACT_NESTED_REPOSITORY_DENIED");
	}
	const content = await fs.readFile(canonicalTarget);
	const digest = `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
	if (digest !== ref.contentDigest) {
		throw new Error("WORKSPACE_ARTIFACT_DIGEST_MISMATCH");
	}
	return {
		...ref,
		relativePath: ref.relativePath.split(path.sep).join("/"),
		attestationId: attestation.id,
		attestationDigest: attestation.digest,
		repositoryIdentityRevision: run.repositoryIdentityRevision,
	};
}
