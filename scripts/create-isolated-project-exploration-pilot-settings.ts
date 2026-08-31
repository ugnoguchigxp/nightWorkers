import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

type RecordValue = Record<string, unknown>;

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2).filter((arg) => arg !== "--"),
		options: {
			source: { type: "string" },
			output: { type: "string" },
			"endpoint-id": { type: "string" },
			model: { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});
	const source = requiredPath("--source", args.values.source);
	const output = requiredPath("--output", args.values.output);
	const endpointId = required("--endpoint-id", args.values["endpoint-id"]);
	const model = required("--model", args.values.model);
	const sourceSettings = record(
		JSON.parse(await readFile(source, "utf8")),
		"source settings",
	);
	const endpoints = sourceSettings.providerEndpoints;
	if (!Array.isArray(endpoints)) {
		throw new Error("source settings.providerEndpoints must be an array.");
	}
	const endpoint = endpoints
		.map((value) => record(value, "source provider endpoint"))
		.find((value) => value.id === endpointId);
	if (!endpoint) {
		throw new Error("--endpoint-id was not found in source providerEndpoints.");
	}
	if (endpoint.kind !== "azure" || endpoint.enabled !== true) {
		throw new Error("Pilot endpoint must be an enabled Azure endpoint.");
	}
	if (typeof endpoint.apiKey !== "string" || endpoint.apiKey.length === 0) {
		throw new Error("Pilot endpoint must have a non-empty API key.");
	}
	if (typeof endpoint.endpoint !== "string" || endpoint.endpoint.length === 0) {
		throw new Error("Pilot endpoint must have a non-empty Azure endpoint.");
	}
	if (!Array.isArray(endpoint.models) || !endpoint.models.includes(model)) {
		throw new Error("--model must be listed by the selected pilot endpoint.");
	}

	const isolated = {
		settingsRevision: "isolated-project-exploration-pilot-v1",
		endpointIdSchemaVersion: sourceSettings.endpointIdSchemaVersion,
		providerEndpoints: [
			{
				id: endpointId,
				name: text(endpoint.name, "source provider endpoint.name"),
				kind: "azure",
				enabled: true,
				apiKey: endpoint.apiKey,
				endpoint: endpoint.endpoint,
				apiVersion: optionalText(endpoint.apiVersion),
				models: [model],
			},
		],
		roleRoutes: [
			{
				role: "implementation",
				primary: { providerEndpointId: endpointId, model },
				fallbacks: [],
			},
		],
	};
	const contents = `${JSON.stringify(isolated, null, 2)}\n`;
	await mkdir(path.dirname(output), { recursive: true });
	await writeFile(output, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
	const fingerprint = `sha256:${createHash("sha256").update(contents).digest("hex")}`;
	process.stdout.write(
		`${JSON.stringify({ output, settingsFingerprint: fingerprint, model })}\n`,
	);
}

function required(option: string, value: string | undefined) {
	if (!value?.trim()) throw new Error(`${option} is required.`);
	return value.trim();
}

function requiredPath(option: string, value: string | undefined) {
	return path.resolve(required(option, value));
}

function record(value: unknown, name: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${name} must be an object.`);
	}
	return value as RecordValue;
}

function text(value: unknown, name: string) {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${name} must be a non-empty string.`);
	}
	return value;
}

function optionalText(value: unknown) {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
