import { createRoute, z } from "@hono/zod-openapi";
import {
	evidenceCheckDescriptorSchema,
	evidenceCheckSnapshotSchema,
} from "../../../shared/modules/codingAgent";
import { createOpenApiRouter } from "../../lib/openapi";
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

export const codingAgentRouter = createOpenApiRouter()
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
