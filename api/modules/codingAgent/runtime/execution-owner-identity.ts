import crypto from "node:crypto";
import type { CodingAgentRunExecutionOwnerKind } from "../persistence/runtime-execution-schema";

export type CodingAgentExecutionOwnerIdentity = {
	kind: CodingAgentRunExecutionOwnerKind;
	instanceId: string;
	pid: number;
};

const bootId = crypto.randomUUID();
const ownerKind: CodingAgentRunExecutionOwnerKind =
	process.env.NIGHTWORKERS_EXECUTION_ROLE === "worker"
		? "worker_process"
		: "api_process";

const currentIdentity: CodingAgentExecutionOwnerIdentity = {
	kind: ownerKind,
	instanceId: `${ownerKind}:${bootId}`,
	pid: process.pid,
};

export function getCodingAgentExecutionOwnerIdentity() {
	return currentIdentity;
}
