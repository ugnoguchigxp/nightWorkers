import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";

export const registerAgentTurnsFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/mission-pilot-agent-turns",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						taskId: z.string().uuid(),
						turns: z.array(
							z.object({
								content: z.string(),
								toolCalls: z.array(
									z.object({
										id: z.string().min(1),
										name: z.string().min(1),
										arguments: z.record(z.string(), z.unknown()),
									}),
								),
							}),
						),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": { schema: z.object({ ok: z.literal(true) }) },
			},
			description: "Register isolated Mission Pilot native tool turns.",
		},
		404: { description: "Route unavailable" },
	},
});
