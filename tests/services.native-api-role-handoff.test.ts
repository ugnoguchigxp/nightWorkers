import { describe, expect, it } from "vitest";
import {
	buildDeterministicRoleHandoffArtifact,
	validateRoleHandoffArtifact,
} from "../api/services/agent-runtime/native-api-runner/native-api-role-handoff";
import {
	buildDeterministicRoleWorkingContext,
	validateRoleWorkingContext,
} from "../api/services/agent-runtime/native-api-runner/native-api-role-working-context";
import type { AgentRunContext } from "../api/services/agent-runtime/types";

describe("native-api role handoff", () => {
	it("builds deterministic handoff and working context from Todo, state card, and references", () => {
		const context = buildContext();
		const handoff = buildDeterministicRoleHandoffArtifact({
			context,
			createdAt: "2026-06-19T00:00:00.000Z",
		});
		const working = buildDeterministicRoleWorkingContext({
			context,
			handoff,
			createdAt: "2026-06-19T00:00:00.000Z",
		});

		expect(validateRoleHandoffArtifact(handoff)).toMatchObject({ ok: true });
		expect(validateRoleWorkingContext(working.context)).toMatchObject({
			ok: true,
		});
		expect(handoff.currentTodo).toMatchObject({ id: "todo-2", seq: 2 });
		expect(handoff.designReferences).toEqual([
			expect.objectContaining({
				path: "spec/role-owned-context-compaction-plan.md",
			}),
		]);
		expect(working.renderedText).toContain('<ROLE_WORKING_CONTEXT version="1"');
		expect(working.renderedText).toContain(
			"currentTodo=#2 Implement role context",
		);
		expect(working.renderedText).toContain(
			"designReference path=spec/role-owned-context-compaction-plan.md",
		);
		expect(working.renderedText).toContain("<STATE_CARD>");
	});

	it("rejects empty identifiers, document bodies, and non-string evidence refs", () => {
		const context = buildContext();
		const handoff = buildDeterministicRoleHandoffArtifact({ context });
		const invalid = {
			...handoff,
			runId: "",
			designReferences: [
				{
					path: "",
					reason: "bad",
					content: "full design document body must not be stored",
				},
			],
			runtimeFacts: [
				{
					summary: "bad evidence",
					source: "todo",
					evidenceRefs: [{ raw: "payload" }],
				},
			],
			toExecutionMode: "debug_anything",
			toRole: "writer",
		};

		expect(validateRoleHandoffArtifact(invalid)).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				"runId must be a non-empty string",
				"toExecutionMode is invalid",
				"toRole is invalid",
				"designReferences[0].path must be a non-empty string",
				"designReferences[0] must not include document body",
				"runtimeFacts[0].evidenceRefs[0] must be a string",
			]),
		});
	});

	it("rejects invalid working context execution mode and role", () => {
		const context = buildContext();
		const handoff = buildDeterministicRoleHandoffArtifact({ context });
		const working = buildDeterministicRoleWorkingContext({ context, handoff });

		expect(
			validateRoleWorkingContext({
				...working.context,
				executionMode: "debug_anything",
				role: "writer",
			}),
		).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				"executionMode is invalid",
				"role is invalid",
			]),
		});
	});
});

function buildContext(): AgentRunContext {
	return {
		runId: "run-role",
		taskId: "task-role",
		repositoryId: "repo-role",
		repoRoot: "/Users/y.noguchi/Code/nightWorkers",
		compiledPrompt:
			"Implement spec/role-owned-context-compaction-plan.md without full doc carryover.",
		latestUserMessage: "Execute the plan.",
		timeoutSeconds: 60,
		runtimeOptions: { executionMode: "implementation" },
		contextSnapshot: {
			compiledPrompt: "Implement spec/role-owned-context-compaction-plan.md",
			source: "task_prompt",
			conversationContext: {
				snapshotId: "snapshot-1",
				stateCardIncluded: true,
				stateCardText: "<STATE_CARD>\nProjected state only\n</STATE_CARD>",
				snapshotJson: {
					contextBaseline: {
						stateCardDigest: "sha256:state-card",
					},
				},
				projection: {
					role: "implementation",
					source: "role_projection",
					omittedSections: [],
				},
				usage: {
					latestUserMessageTokens: 4,
					stateCardTokens: 8,
					runtimeUserPromptTokens: 12,
				},
			},
		},
		todoPlan: [
			{
				id: "todo-1",
				seq: 1,
				title: "Inspect current contracts",
				taskType: "inspection",
				status: "passed",
				procedureId: null,
			},
			{
				id: "todo-2",
				seq: 2,
				title: "Implement role context",
				taskType: "implementation",
				status: "running",
				procedureId: "context.role",
			},
		],
		currentTodo: {
			id: "todo-2",
			seq: 2,
			title: "Implement role context",
			taskType: "implementation",
			status: "running",
			procedureId: "context.role",
		},
	};
}
