import { describe, expect, it } from "vitest";
import { client } from "../api/db/client";
import { nightWorkersCodexToolManifest } from "../api/modules/codingAgent/mcp/nightworkers-tool-manifest";
import { withSecurityIntelligenceShadow } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-context-still";
import { workerToolDefinitions } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-manifest";
import { mergeSecurityContinuationResult } from "../api/modules/nightworkers/run-orchestration/security-runtime-finalization";
import { TASK_OPERATOR_ACTION_DEFINITIONS } from "../api/modules/taskOperator/policies/task-operator-action.registry";
import {
	deriveSecurityFinalJudgmentV1,
	securityFinalJudgmentV1Schema,
} from "../shared/schemas/security-intelligence-runtime.schema";

const contractRef = `sic:v1:${"1".repeat(64)}`;
const conditionA = `sicc:v1:${"2".repeat(64)}`;
const conditionB = `sicc:v1:${"3".repeat(64)}`;

function judgment(conditionRefs = [conditionA, conditionB]) {
	return deriveSecurityFinalJudgmentV1({
		version: 1,
		runId: "run-1",
		taskRevisionSnapshotId: "snapshot-1",
		securityContractRef: contractRef,
		securityContractDigest: `sha256:${"4".repeat(64)}`,
		assessmentAttemptRefs: [],
		assessmentSubjectBindingRefs: [],
		conditionEvaluations: conditionRefs.map((conditionRef) => ({
			conditionRef,
			result: "satisfied" as const,
			evidenceRefs: [],
			limitationCodes: [],
			rationale: "verified",
		})),
		residualRisk: { level: "low", rationale: "bounded" },
		createdAt: "2026-08-15T00:00:00.000Z",
	});
}

describe("Security Intelligence runtime contracts", () => {
	it("preserves cancellation and implementation evidence from the bounded continuation", () => {
		const result = mergeSecurityContinuationResult({
			previous: {
				terminalState: "completed",
				summary: "implementation complete",
				finalReport: "implementation report",
				stoppedBy: "decision",
				riskLevel: "low",
				logContent: "initial log",
				diffPatch: "initial diff",
				testResults: { passed: 3 },
			},
			continuation: {
				terminalState: "cancelled",
				summary: "cancelled by user",
				finalReport: "cancelled",
				stoppedBy: "cancelled",
				riskLevel: "low",
				logContent: "continuation log",
			},
			securityFinalJudgment: undefined,
		});
		expect(result).toMatchObject({
			terminalState: "cancelled",
			stoppedBy: "cancelled",
			diffPatch: "initial diff",
			testResults: { passed: 3 },
			logContent: "initial log\ncontinuation log",
		});
	});

	it("bootstraps every Security Intelligence persistence table in an isolated database", async () => {
		const result = await client.execute(
			"select name from sqlite_master where type = 'table' and name like 'security_%' order by name",
		);
		const names = new Set(result.rows.map((row) => String(row.name)));
		for (const name of [
			"security_scan_bindings",
			"security_assessment_receipts",
			"security_assessment_attempts",
			"security_assessment_subject_bindings",
			"security_contracts",
			"security_contract_heads",
			"security_final_judgments",
			"security_knowledge_candidate_outbox",
			"security_knowledge_candidate_receipts",
			"security_knowledge_feedback_outbox",
			"security_knowledge_feedback_receipts",
		]) {
			expect(names.has(name)).toBe(true);
		}
		const attemptColumns = await client.execute(
			"pragma table_info(security_assessment_attempts)",
		);
		expect(
			attemptColumns.rows.some(
				(column) => column.name === "execution_context_json",
			),
		).toBe(true);
	});

	it("requires set-like refs and condition evaluations to be sorted and unique", () => {
		expect(securityFinalJudgmentV1Schema.parse(judgment())).toBeDefined();
		expect(() => judgment([conditionB, conditionA])).toThrow(
			"condition_evaluations_must_be_unique_and_sorted",
		);
		expect(() => judgment([conditionA, conditionA])).toThrow(
			"condition_evaluations_must_be_unique_and_sorted",
		);
	});

	it("exposes the same Security Intelligence mutations in both runtime lanes", () => {
		const names = [
			"write_security_contract",
			"write_security_completion_condition",
			"request_post_security_assessment",
			"submit_security_final_judgment",
			"propose_security_knowledge_candidate_batch",
			"propose_security_knowledge_feedback_batch",
		] as const;
		const nativeNames = new Set(workerToolDefinitions.map((tool) => tool.name));
		for (const name of names) {
			expect(nativeNames.has(name)).toBe(true);
			expect(name in nightWorkersCodexToolManifest).toBe(true);
		}
	});

	it("connects User and Mission Pilot Task Operator actions to the shared commands", () => {
		const actionIds = new Set(
			TASK_OPERATOR_ACTION_DEFINITIONS.map((definition) => definition.actionId),
		);
		for (const actionId of [
			"security.assessment.pre.bind",
			"security.contract.write",
			"security.condition.write",
			"security.assessment.post.request",
			"security.knowledge.candidates.propose",
			"security.knowledge.feedback.propose",
		]) {
			expect(actionIds.has(actionId)).toBe(true);
			const definition = TASK_OPERATOR_ACTION_DEFINITIONS.find(
				(candidate) => candidate.actionId === actionId,
			);
			expect(definition?.inputSchema).toMatchObject({ type: "object" });
			expect(definition?.execution).toMatchObject({
				effect: "mutation",
				completion: "immediate",
				reconciliation: "query_receipt",
			});
		}
	});

	it("enables shadow retrieval only from a structured Security Contract context", () => {
		const base = {
			runId: "run-1",
			taskId: "task-1",
			contextSnapshot: {},
		} as never;
		expect(withSecurityIntelligenceShadow({ goal: "x" }, base)).toEqual({
			goal: "x",
		});
		const context = {
			...base,
			contextSnapshot: {
				securityContractContext: {
					securityContract: {
						projectRef: "project:11111111-1111-4111-8111-111111111111",
					},
				},
			},
		} as never;
		expect(withSecurityIntelligenceShadow({ goal: "x" }, context)).toEqual({
			goal: "x",
			securityIntelligenceShadow: {
				enabled: true,
				taskRef: "task:task-1",
				runRef: "run:run-1",
				projectRef: "project:11111111-1111-4111-8111-111111111111",
			},
		});
	});
});
