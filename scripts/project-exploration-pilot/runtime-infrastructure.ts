import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, unlinkSync } from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getRuntimePaths } from "../../api/runtime/paths";
import { mcpClientManager } from "../../api/services/mcp/mcp-client-manager";
import {
	createMcpServer,
	listMcpServers,
	updateMcpServer,
} from "../../api/services/mcp/mcp-settings";
import {
	resolveLocalDatabasePath,
} from "../../shared/runtime-database-access.mjs";
import type { PilotOptions } from "./options";

const POLL_INTERVAL_MS = 2_000;

export function sha256Fingerprint(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function routeEvidence(contextSnapshot: unknown) {
	const snapshot = recordValue(contextSnapshot);
	const routing = recordValue(snapshot?.effectiveLlmRouting);
	const active = recordValue(routing?.active);
	return {
		runtimeLane: stringValue(snapshot?.runtimeLane),
		providerId: stringValue(active?.providerId),
		providerEndpointId: stringValue(active?.providerEndpointId),
		model: stringValue(active?.model),
		thinkingDepth: stringValue(active?.thinkingDepth),
	};
}

export function catalogPinEvidence(contextSnapshot: unknown) {
	const snapshot = recordValue(contextSnapshot);
	const pin = recordValue(snapshot?.projectExplorationCatalog);
	if (!pin) return null;
	const readiness = recordValue(pin.readiness);
	const freshness = recordValue(pin.freshness);
	const preparation = recordValue(pin.preparation);
	return {
		version: numberValue(pin.version),
		available: pin.available === true,
		reason: stringValue(pin.reason),
		preparedAt: stringValue(pin.preparedAt),
		preparationStatus: stringValue(pin.preparationStatus),
		freshness: freshness
			? {
					status: stringValue(freshness.status),
					sourceRevisionKind: stringValue(freshness.sourceRevisionKind),
					sourceRevisionValue: stringValue(freshness.sourceRevisionValue),
				}
			: null,
		readiness: readiness
			? {
					codeStructure: stringValue(readiness.codeStructure),
					usability: stringValue(readiness.usability),
					reasonCodes: Array.isArray(readiness.reasonCodes)
						? readiness.reasonCodes.filter(
								(value): value is string => typeof value === "string",
							)
						: [],
					coverage: recordValue(readiness.coverage),
				}
			: null,
		preparation: preparation
			? {
					reused: preparation.reused === true,
					durationMs: numberValue(preparation.durationMs),
					pollCount: numberValue(preparation.pollCount),
				}
			: null,
	};
}

export async function preparePilotMcpServer(input: {
	producerRoot: string;
	repositoryRoot: string;
	producerDatabase: string;
	formal: boolean;
	preparationTimeoutSeconds: number;
	targetHead: string;
}) {
	const bootstrap = await ensurePilotMcpServer({
		...input,
		projectCreationPolicy: "create_within_allowed_roots",
	});
	try {
		await mcpClientManager.callTool(
			bootstrap.id,
			"vuln_prepare_project_intelligence",
			{ projectPath: input.repositoryRoot },
		);
	} finally {
		await mcpClientManager.disconnect(bootstrap.id);
	}
	const formalServer = await ensurePilotMcpServer({
		...input,
		projectCreationPolicy: "registered_only",
	});
	if (input.formal) {
		await waitForReadyProducerCatalog({
			serverId: formalServer.id,
			repositoryRoot: input.repositoryRoot,
			timeoutSeconds: input.preparationTimeoutSeconds,
			targetHead: input.targetHead,
		});
		const registrationCheck = await verifyProducerProjectRegistration({
			producerRoot: input.producerRoot,
			producerDatabase: input.producerDatabase,
			repositoryRoot: input.repositoryRoot,
		});
		if (!registrationCheck.ok) {
			throw new Error("Formal pilot producer database has an invalid project inventory.");
		}
	}
	return {
		mcpServer: formalServer,
		catalogReady: input.formal,
		exactProjectRegistration: input.formal,
	};
}

export async function initializeProducerPilotDatabase(input: {
	producerRoot: string;
	producerDatabase: string;
	formal: boolean;
}) {
	if (
		input.formal &&
		!/project[-_]?intelligence[-_].*pilot|pilot[-_].*project[-_]?intelligence/i.test(
			path.basename(input.producerDatabase),
		)
	) {
		throw new Error(
			"Formal producer database filename must identify this as a project-intelligence pilot database.",
		);
	}
	await mkdir(path.dirname(input.producerDatabase), {
		recursive: true,
		mode: 0o700,
	});
	await chmod(path.dirname(input.producerDatabase), 0o700);
	const child = Bun.spawn(["bun", "api/cli/migrate.ts"], {
		cwd: input.producerRoot,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			PATH: process.env.PATH ?? "",
			DATABASE_URL: pathToFileURL(input.producerDatabase).href,
			NODE_ENV: "development",
		},
	});
	const [exitCode, stderr] = await Promise.all([
		child.exited,
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(`Producer pilot database migration failed: ${stderr.trim()}`);
	}
}

async function ensurePilotMcpServer(input: {
	producerRoot: string;
	repositoryRoot: string;
	producerDatabase: string;
	projectCreationPolicy: "registered_only" | "create_within_allowed_roots";
}) {
	const desired = {
		name: "vulnWorkbench Project Intelligence Pilot",
		enabled: true,
		transport: "stdio" as const,
		command: "bun",
		args: ["api/cli/static-intelligence-mcp-server.ts"],
		cwd: input.producerRoot,
		env: {
			DATABASE_URL: pathToFileURL(input.producerDatabase).href,
			STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS: input.repositoryRoot,
			STATIC_INTELLIGENCE_PROJECT_CREATION_POLICY: input.projectCreationPolicy,
		},
		toolPrefix: "vuln_pilot",
	};
	const existing = listMcpServers().find(
		(server) => server.toolPrefix === desired.toolPrefix,
	);
	if (!existing) return createMcpServer(desired);
	const updated = await updateMcpServer(existing.id, desired);
	if (!updated) throw new Error("Failed to update the pilot MCP server.");
	return updated;
}

async function waitForReadyProducerCatalog(input: {
	serverId: string;
	repositoryRoot: string;
	timeoutSeconds: number;
	targetHead: string;
}) {
	const deadline = Date.now() + input.timeoutSeconds * 1_000;
	while (Date.now() < deadline) {
		const status = await mcpClientManager.callTool(
			input.serverId,
			"vuln_get_project_intelligence_status",
			{ projectPath: input.repositoryRoot },
		);
		const payload = mcpToolPayload(status);
		if (payload?.ok === true && payload.status === "ready") {
			const source = recordValue(payload.source);
			const revision = recordValue(source?.revision);
			if (revision?.kind === "git" && revision.head === input.targetHead) return;
			throw new Error("Producer catalog ready state is bound to a different target revision.");
		}
		if (payload?.status === "failed" || payload?.status === "stale") {
			throw new Error("Producer catalog did not reach a ready, revision-matched state.");
		}
		progress({ event: "producer.preparation_wait", status: payload?.status ?? "invalid" });
		await sleep(POLL_INTERVAL_MS);
	}
	throw new Error("Producer catalog did not reach ready state before the pre-registered timeout.");
}

async function verifyProducerProjectRegistration(input: {
	producerRoot: string;
	producerDatabase: string;
	repositoryRoot: string;
}) {
	const child = Bun.spawn(
		[
			"bun",
			"api/cli/verify-project-intelligence-pilot-registration.ts",
			"--project-root",
			input.repositoryRoot,
		],
		{
			cwd: input.producerRoot,
			stdout: "pipe",
			stderr: "pipe",
			env: {
				PATH: process.env.PATH ?? "",
				DATABASE_URL: pathToFileURL(input.producerDatabase).href,
			},
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(`Producer registration verification failed: ${stderr.trim()}`);
	}
	try {
		const result = recordValue(JSON.parse(stdout));
		return {
			ok: result?.ok === true,
			projectCount: numberValue(result?.projectCount),
			exactTargetCount: numberValue(result?.exactTargetCount),
		};
	} catch (error) {
		throw new Error("Producer registration verification returned invalid JSON.", {
			cause: error,
		});
	}
}

function mcpToolPayload(value: unknown) {
	const record = recordValue(value);
	const content = Array.isArray(record?.content) ? record.content : [];
	for (const block of content) {
		const text = recordValue(block)?.text;
		if (typeof text !== "string") continue;
		try {
			const payload = recordValue(JSON.parse(text));
			if (payload) return payload;
		} catch {
			// Try the next MCP content block.
		}
	}
	return null;
}

export async function writeRawCheckpoint(output: string, payload: unknown) {
	await writeAtomicJson(`${output}.checkpoint.json`, payload);
}

export async function writeAtomicJson(output: string, payload: unknown) {
	const outputDirectory = path.dirname(output);
	await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
	await chmod(outputDirectory, 0o700);
	const temporary = `${output}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await rename(temporary, output);
}

export function acquirePilotRuntimeLease(options: PilotOptions): () => void {
	if (!options.dedicatedDatabase) return () => {};
	const runtimePaths = getRuntimePaths();
	const databasePath = resolveLocalDatabasePath(process.env.DATABASE_URL);
	if (!existsSync(databasePath)) {
		throw new Error(
			`Dedicated pilot database does not exist: ${databasePath}`,
		);
	}
	const leasePath = path.join(
		runtimePaths.runtimeRoot,
		"project-intelligence-pilot.lock",
	);
	let descriptor: number;
	try {
		descriptor = openSync(leasePath, "wx", 0o600);
	} catch (error) {
		throw new Error(
			`Dedicated pilot database already has a runtime lease: ${leasePath}`,
			{ cause: error },
		);
	}
	return () => {
		closeSync(descriptor);
		unlinkSync(leasePath);
	};
}

export async function gitOutput(cwd: string, args: string[]) {
	return commandOutput(cwd, ["git", ...args]);
}

export async function listCompetingNightWorkersProcesses() {
	const output = await commandOutput(process.cwd(), [
		"ps",
		"-axo",
		"pid=,command=",
	]);
	return output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => {
			const [rawPid] = line.split(/\s+/, 1);
			if (Number(rawPid) === process.pid) return false;
			return (
				line.includes("bun api/index.ts") ||
				line.includes("bun run dev:api")
			);
		});
}

async function commandOutput(cwd: string, command: string[]) {
	const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
	}
	return stdout.trim();
}

export function progress(payload: Record<string, unknown>) {
	process.stderr.write(`${JSON.stringify({ ...payload, at: new Date().toISOString() })}\n`);
}

export function recordValue(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function stringValue(value: unknown) {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function sleep(durationMs: number) {
	return new Promise((resolve) => setTimeout(resolve, durationMs));
}
