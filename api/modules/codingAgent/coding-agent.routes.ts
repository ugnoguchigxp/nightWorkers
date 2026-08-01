import { createRoute, z } from "@hono/zod-openapi";
import {
	codingAgentCommandRequestV1Schema,
	codingAgentCommandResponseV1Schema,
	evidenceCheckDescriptorSchema,
	evidenceCheckSnapshotSchema,
} from "../../../shared/modules/codingAgent";
import { createOpenApiRouter } from "../../lib/openapi";
import { humanTaskOperatorPrincipal } from "../taskOperator";
import { executeCodingAgentTransportCommand } from "./application/coding-agent-command.service";
import {
	getEvidenceCheckSnapshot,
	getLatestEvidenceCheckDescriptor,
} from "./verification/evidence-check-query.service";

const getLatestEvidenceCheckRoute = createRoute({
	method: "get",
	path: "/coding-agent/tasks/:taskId/evidence-check/latest",
	request: {
		params: z.object({ taskId: z.string().uuid() }),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: evidenceCheckDescriptorSchema },
			},
			description: "Latest active Evidence Check descriptor for the Task",
		},
		204: {
			description: "No active Evidence Check is available yet",
		},
	},
});

const getEvidenceCheckRoute = createRoute({
	method: "get",
	path: "/coding-agent/tasks/:taskId/evidence-check/:verificationDocumentId",
	request: {
		params: z.object({
			taskId: z.string().uuid(),
			verificationDocumentId: z.string().uuid(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: evidenceCheckSnapshotSchema },
			},
			description: "Persisted evidence checklist for the active specification",
		},
		404: {
			description: "Evidence checklist not found",
		},
	},
});

const codingAgentCommandResponse = {
	content: {
		"application/json": { schema: codingAgentCommandResponseV1Schema },
	},
};

const executeCodingAgentCommandRoute = createRoute({
	method: "post",
	path: "/coding-agent/commands",
	request: {
		body: {
			required: true,
			content: {
				"application/json": { schema: codingAgentCommandRequestV1Schema },
			},
		},
	},
	responses: {
		200: {
			...codingAgentCommandResponse,
			description: "Coding Agent command completed or replayed",
		},
		400: {
			...codingAgentCommandResponse,
			description: "Invalid Coding Agent command",
		},
		401: {
			...codingAgentCommandResponse,
			description: "Coding Agent command authentication failed",
		},
		403: {
			...codingAgentCommandResponse,
			description: "Coding Agent command is not permitted",
		},
		404: {
			...codingAgentCommandResponse,
			description: "Coding Agent command resource was not found",
		},
		409: {
			...codingAgentCommandResponse,
			description: "Coding Agent command conflicts with current state",
		},
		422: {
			...codingAgentCommandResponse,
			description: "Coding Agent command failed schema validation",
		},
		429: {
			...codingAgentCommandResponse,
			description: "Coding Agent command exceeded a resource limit",
		},
		500: {
			...codingAgentCommandResponse,
			description: "Coding Agent command failed internally",
		},
	},
});

export const codingAgentRouter = createOpenApiRouter()
	.openapi(
		executeCodingAgentCommandRoute,
		async (c) => {
			const result = await executeCodingAgentTransportCommand(
				c.req.valid("json"),
				humanTaskOperatorPrincipal(),
			);
			switch (result.statusCode) {
				case 200:
					return c.json(result.response, 200);
				case 400:
					return c.json(result.response, 400);
				case 401:
					return c.json(result.response, 401);
				case 403:
					return c.json(result.response, 403);
				case 404:
					return c.json(result.response, 404);
				case 409:
					return c.json(result.response, 409);
				case 422:
					return c.json(result.response, 422);
				case 429:
					return c.json(result.response, 429);
				default:
					return c.json(result.response, 500);
			}
		},
		(result, c) => {
			if (result.success) return;
			return c.json(
				{
					version: 1 as const,
					type: "coding_agent.command.result" as const,
					requestId: crypto.randomUUID(),
					result: {
						ok: false as const,
						error: {
							kind: "schema_validation" as const,
							code: "TASK_OPERATOR_SCHEMA_VALIDATION",
							message: "Invalid Coding Agent command.",
							retryable: false,
							currentRevision: null,
						},
					},
				},
				400,
			);
		},
	)
	.openapi(getLatestEvidenceCheckRoute, async (c) => {
		const descriptor = await getLatestEvidenceCheckDescriptor(
			c.req.param("taskId"),
		);
		if (!descriptor) return c.body(null, 204);
		return c.json(descriptor, 200);
	})
	.openapi(getEvidenceCheckRoute, async (c) => {
		const snapshot = await getEvidenceCheckSnapshot(c.req.param());
		if (!snapshot)
			return c.json({ message: "Evidence checklist not found" }, 404);
		return c.json(snapshot, 200);
	});
