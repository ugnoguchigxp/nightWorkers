import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	proposeSecurityKnowledgeCandidateBatchTool,
	proposeSecurityKnowledgeFeedbackBatchTool,
	requestPostSecurityAssessmentTool,
	submitSecurityFinalJudgmentTool,
	writeSecurityCompletionConditionTool,
	writeSecurityContractTool,
} from "../../../services/worker-tools/security-intelligence";
import type { NightWorkersMcpRequestContext } from "./nightworkers-codex-mcp";
import {
	controlledToolResult,
	requestContextMismatchToMcp,
	resolveRequestScopedIdentity,
} from "./nightworkers-codex-mcp-support";
import { nightWorkersCodexToolManifest } from "./nightworkers-tool-manifest";

function requestIdentity(
	context: NightWorkersMcpRequestContext,
	suppliedRunId: string | undefined,
) {
	return resolveRequestScopedIdentity({
		context,
		suppliedRunId,
		fallbackTaskId: process.env.NIGHTWORKERS_TASK_ID,
		fallbackRunId: process.env.NIGHTWORKERS_RUN_ID,
	});
}

export function registerSecurityIntelligenceMcpTools(
	server: McpServer,
	context: NightWorkersMcpRequestContext,
) {
	server.registerTool(
		"write_security_contract",
		{ ...nightWorkersCodexToolManifest.write_security_contract },
		async ({ runId, ...command }) => {
			const identity = requestIdentity(context, runId);
			if (identity.discrepancies.length > 0 || !identity.runId) {
				return requestContextMismatchToMcp({
					toolName: "write_security_contract",
					resolution: identity,
					retryArguments: { ...command, runId: identity.runId },
				});
			}
			return controlledToolResult({
				context,
				runId: identity.runId,
				toolName: "write_security_contract",
				arguments: command,
				idempotentSideEffect: true,
				execute: () =>
					writeSecurityContractTool({ runId: identity.runId, args: command }),
			});
		},
	);

	server.registerTool(
		"write_security_completion_condition",
		{ ...nightWorkersCodexToolManifest.write_security_completion_condition },
		async ({ runId, ...command }) => {
			const identity = requestIdentity(context, runId);
			if (identity.discrepancies.length > 0 || !identity.runId) {
				return requestContextMismatchToMcp({
					toolName: "write_security_completion_condition",
					resolution: identity,
					retryArguments: { ...command, runId: identity.runId },
				});
			}
			return controlledToolResult({
				context,
				runId: identity.runId,
				toolName: "write_security_completion_condition",
				arguments: command,
				idempotentSideEffect: true,
				execute: () =>
					writeSecurityCompletionConditionTool({
						runId: identity.runId,
						args: command,
					}),
			});
		},
	);

	server.registerTool(
		"request_post_security_assessment",
		{ ...nightWorkersCodexToolManifest.request_post_security_assessment },
		async ({ runId, ...command }) => {
			const identity = requestIdentity(context, runId);
			if (identity.discrepancies.length > 0 || !identity.runId) {
				return requestContextMismatchToMcp({
					toolName: "request_post_security_assessment",
					resolution: identity,
					retryArguments: { ...command, runId: identity.runId },
				});
			}
			const args = { ...command, runId: identity.runId };
			return controlledToolResult({
				context,
				runId: identity.runId,
				toolName: "request_post_security_assessment",
				arguments: args,
				idempotentSideEffect: true,
				execute: () =>
					requestPostSecurityAssessmentTool({
						runId: identity.runId,
						args,
					}),
			});
		},
	);

	server.registerTool(
		"submit_security_final_judgment",
		{ ...nightWorkersCodexToolManifest.submit_security_final_judgment },
		async ({ runId, ...command }) => {
			const identity = requestIdentity(context, runId);
			if (identity.discrepancies.length > 0 || !identity.runId) {
				return requestContextMismatchToMcp({
					toolName: "submit_security_final_judgment",
					resolution: identity,
					retryArguments: { ...command, runId: identity.runId },
				});
			}
			const args = { ...command, runId: identity.runId };
			return controlledToolResult({
				context,
				runId: identity.runId,
				toolName: "submit_security_final_judgment",
				arguments: args,
				idempotentSideEffect: true,
				execute: () =>
					submitSecurityFinalJudgmentTool({ runId: identity.runId, args }),
			});
		},
	);

	server.registerTool(
		"propose_security_knowledge_candidate_batch",
		{
			...nightWorkersCodexToolManifest.propose_security_knowledge_candidate_batch,
		},
		async ({ runId, ...command }) => {
			const identity = requestIdentity(context, runId);
			if (identity.discrepancies.length > 0 || !identity.runId) {
				return requestContextMismatchToMcp({
					toolName: "propose_security_knowledge_candidate_batch",
					resolution: identity,
					retryArguments: { ...command, runId: identity.runId },
				});
			}
			const args = { ...command, runId: identity.runId };
			return controlledToolResult({
				context,
				runId: identity.runId,
				toolName: "propose_security_knowledge_candidate_batch",
				arguments: args,
				idempotentSideEffect: true,
				execute: () =>
					proposeSecurityKnowledgeCandidateBatchTool({
						runId: identity.runId,
						args,
					}),
			});
		},
	);

	server.registerTool(
		"propose_security_knowledge_feedback_batch",
		{
			...nightWorkersCodexToolManifest.propose_security_knowledge_feedback_batch,
		},
		async ({ runId, ...command }) => {
			const identity = requestIdentity(context, runId);
			if (identity.discrepancies.length > 0 || !identity.runId) {
				return requestContextMismatchToMcp({
					toolName: "propose_security_knowledge_feedback_batch",
					resolution: identity,
					retryArguments: { ...command, runId: identity.runId },
				});
			}
			const args = { ...command, runId: identity.runId };
			return controlledToolResult({
				context,
				runId: identity.runId,
				toolName: "propose_security_knowledge_feedback_batch",
				arguments: args,
				idempotentSideEffect: true,
				execute: () =>
					proposeSecurityKnowledgeFeedbackBatchTool({
						runId: identity.runId,
						args,
					}),
			});
		},
	);
}
