import { createHash } from "node:crypto";
import { nativeApiToolRegistrations } from "../../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-manifest";

export function sha256Fingerprint(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function nativeApiToolManifestFingerprint() {
	return sha256Fingerprint(
		JSON.stringify(
			nativeApiToolRegistrations.map((tool) => ({
				name: tool.name,
				kind: tool.kind,
				workerToolName: tool.workerToolName ?? null,
				definition: tool.definition,
			})),
		),
	);
}
