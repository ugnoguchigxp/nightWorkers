import { firstRecord } from "./record-utils";

export function readApiContractArtifact(metadata: Record<string, unknown>) {
	const contract = firstRecord(metadata.apiContract, metadata.artifactPayload);
	if (contract?.artifactKind === "plan_mode_api_contract") return contract;
	return metadata.artifactKind === "plan_mode_api_contract" ? metadata : null;
}

export function readZodSchemaArtifact(metadata: Record<string, unknown>) {
	const schema = firstRecord(metadata.zodSchema, metadata.artifactPayload);
	if (schema?.artifactKind === "plan_mode_zod_schema") return schema;
	return metadata.artifactKind === "plan_mode_zod_schema" ? metadata : null;
}
