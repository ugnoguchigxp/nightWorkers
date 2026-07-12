import { createRoute, z } from "@hono/zod-openapi";
import {
	agentHookConfigSchema,
	agentHookInputSchema,
	agentHooksResponseSchema,
	agentHookTestResponseSchema,
	agentHookUpdateInputSchema,
} from "../../../services/hooks/hooks-config-schema";

export const getAgentHooksRoute = createRoute({
	method: "get",
	path: "/hooks",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: agentHooksResponseSchema,
				},
			},
			description: "List configured agent hooks",
		},
	},
});

export const createAgentHookRoute = createRoute({
	method: "post",
	path: "/hooks",
	request: {
		body: {
			content: {
				"application/json": {
					schema: agentHookInputSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: agentHookConfigSchema,
				},
			},
			description: "Create agent hook",
		},
	},
});

export const updateAgentHookRoute = createRoute({
	method: "put",
	path: "/hooks/{id}",
	request: {
		params: z.object({ id: z.string().uuid() }),
		body: {
			content: {
				"application/json": {
					schema: agentHookUpdateInputSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: agentHookConfigSchema,
				},
			},
			description: "Update agent hook",
		},
		404: {
			description: "Agent hook not found",
		},
	},
});

export const deleteAgentHookRoute = createRoute({
	method: "delete",
	path: "/hooks/{id}",
	request: {
		params: z.object({ id: z.string().uuid() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: agentHookConfigSchema,
				},
			},
			description: "Delete agent hook",
		},
		404: {
			description: "Agent hook not found",
		},
	},
});

export const testAgentHookRoute = createRoute({
	method: "post",
	path: "/hooks/{id}/test",
	request: {
		params: z.object({ id: z.string().uuid() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: agentHookTestResponseSchema,
				},
			},
			description: "Test agent hook",
		},
		404: {
			description: "Agent hook not found",
		},
	},
});
