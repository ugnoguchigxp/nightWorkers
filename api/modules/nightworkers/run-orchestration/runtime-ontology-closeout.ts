import {
	boundaryAuditEventSeverity,
	buildOntologyBoundaryAuditSnapshot,
} from "../../ontology";
import * as repo from "../nightworkers.repository";
import { parseChangedPathsFromDiff } from "./git-ownership";

export async function createRuntimeOntologyBoundaryAudit(input: {
	skip: boolean;
	repoRoot: string;
	contextSnapshot: unknown;
	diffPatch: string;
	runId: string;
	taskId: string;
}) {
	if (input.skip) return null;
	const context =
		input.contextSnapshot &&
		typeof input.contextSnapshot === "object" &&
		!Array.isArray(input.contextSnapshot)
			? (input.contextSnapshot as Record<string, unknown>)
			: null;
	const ontologyBoundaryAudit = await buildOntologyBoundaryAuditSnapshot({
		repoRoot: input.repoRoot,
		ontologyContext: context?.ontologyContext,
		touchedFiles: parseChangedPathsFromDiff(input.diffPatch),
	});
	await repo.createRunEvent({
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: new Date().toISOString(),
		type: "system.info",
		severity: boundaryAuditEventSeverity(ontologyBoundaryAudit),
		actor: "runtime",
		message: ontologyBoundaryAudit.available
			? `Ontology boundary audit completed with decision=${ontologyBoundaryAudit.decision}.`
			: "Ontology boundary audit skipped or unavailable.",
		data: {
			action: "ontology.boundary_closeout_audit",
			ontologyBoundaryAudit,
		},
	});
	return ontologyBoundaryAudit;
}
