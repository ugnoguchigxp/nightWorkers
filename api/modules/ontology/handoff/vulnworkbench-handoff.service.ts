import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ontologyHandoffManifestResultSchema } from "../../../../shared/schemas/ontology-handoff.schema";
import {
	buildVulnWorkbenchCliEnv,
	DEFAULT_VULNWORKBENCH_CWD,
	resolveVulnWorkbenchBunExecutable,
} from "../../../services/vulnworkbench-cli-runtime";
import * as repo from "../../nightworkers/nightworkers.repository";

const execFileAsync = promisify(execFile);
const HANDOFF_ACTION = "ontology.vulnworkbench_handoff_finished";

export async function collectVulnWorkbenchOntologyHandoff(input: {
	runId: string;
	taskId: string;
	scanRunId: string;
}) {
	const existing = await findExistingHandoff(input.runId, input.scanRunId);
	if (existing) return existing;
	const cwd =
		process.env.NIGHTWORKERS_VULNWORKBENCH_CWD || DEFAULT_VULNWORKBENCH_CWD;
	const timeoutSeconds = readPositiveInt(
		process.env.NIGHTWORKERS_VULNWORKBENCH_HANDOFF_TIMEOUT_SECONDS,
		30,
	);
	try {
		const result = await execFileAsync(
			resolveVulnWorkbenchBunExecutable(),
			[
				"run",
				"api/cli/intelligence-knowledge-source.ts",
				"--scan-run-id",
				input.scanRunId,
			],
			{
				cwd,
				env: buildVulnWorkbenchCliEnv(),
				timeout: timeoutSeconds * 1000,
				maxBuffer: 10 * 1024 * 1024,
			},
		);
		const parsed = ontologyHandoffManifestResultSchema.safeParse(
			JSON.parse(result.stdout.trim()),
		);
		if (!parsed.success) {
			return persistHandoffUnavailable(input, "schema_invalid");
		}
		const manifest = parsed.data.manifest;
		const artifact = await repo.createArtifact({
			runId: input.runId,
			kind: "ontology_handoff_manifest",
			path: `vulnworkbench://static-intelligence/${manifest.source.sourceId}`,
			metadataJson: {
				toolProfile: "ontology_extended",
				scanRunId: input.scanRunId,
				manifest,
			},
		});
		const handoff = {
			status: "available" as const,
			scanRunId: input.scanRunId,
			sourceId: manifest.source.sourceId,
			artifactId: artifact.id,
			generationStatus: manifest.generation?.status ?? null,
			bundleKinds: manifest.availableBundles.map((bundle) => bundle.kind),
			reason: null,
		};
		await persistHandoffEvent(input, handoff, "checkpoint");
		return handoff;
	} catch {
		return persistHandoffUnavailable(input, "unavailable");
	}
}

async function persistHandoffUnavailable(
	input: { runId: string; taskId: string; scanRunId: string },
	reason: "schema_invalid" | "unavailable",
) {
	const handoff = {
		status: "unavailable" as const,
		scanRunId: input.scanRunId,
		sourceId: null,
		artifactId: null,
		generationStatus: null,
		bundleKinds: [] as string[],
		reason,
	};
	await persistHandoffEvent(input, handoff, "warning");
	return handoff;
}

async function persistHandoffEvent(
	input: { runId: string; taskId: string },
	handoff: Record<string, unknown>,
	severity: "checkpoint" | "warning",
) {
	await repo.createRunEvent({
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: new Date().toISOString(),
		type: "system.info",
		severity,
		actor: "system",
		message:
			handoff.status === "available"
				? "Read-only vulnWorkbench ontology handoff collected."
				: "Read-only vulnWorkbench ontology handoff is unavailable; Security Oracle evidence is preserved.",
		data: { action: HANDOFF_ACTION, ontologyHandoff: handoff },
	});
}

async function findExistingHandoff(runId: string, scanRunId: string) {
	const events = await repo.listTaskEventsForRun(runId);
	for (const event of [...events].reverse()) {
		const payload = asRecord(event.payloadJson);
		const runEvent = asRecord(payload.runEvent);
		const data = asRecord(runEvent.data);
		const handoff = asRecord(data.ontologyHandoff);
		if (data.action === HANDOFF_ACTION && handoff.scanRunId === scanRunId) {
			return handoff;
		}
	}
	return null;
}

function readPositiveInt(value: string | undefined, fallback: number) {
	const parsed = Number.parseInt(value || "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
