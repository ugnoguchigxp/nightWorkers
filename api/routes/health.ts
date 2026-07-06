import { createRoute, z } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/client";
import { createOpenApiRouter } from "../lib/openapi";

const readinessSchema = z.object({
	status: z.string().openapi({ example: "healthy" }),
	database: z.string().openapi({ example: "connected" }),
	timestamp: z.string().openapi({ example: "2026-04-02T11:47:06.000Z" }),
	version: z.string().openapi({ example: "1.0.0" }),
});

const livenessSchema = z.object({
	status: z.string().openapi({ example: "alive" }),
	timestamp: z.string().openapi({ example: "2026-04-02T11:47:06.000Z" }),
	version: z.string().openapi({ example: "1.0.0" }),
});

const liveRoute = createRoute({
	method: "get",
	path: "/live",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: livenessSchema,
				},
			},
			description: "Liveness probe (process is up)",
		},
	},
});

const readyRoute = createRoute({
	method: "get",
	path: "/ready",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: readinessSchema,
				},
			},
			description: "Readiness probe (dependencies are ready)",
		},
		503: {
			content: {
				"application/json": {
					schema: readinessSchema,
				},
			},
			description: "Readiness probe failed",
		},
	},
});

const legacyHealthRoute = createRoute({
	method: "get",
	path: "/",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: readinessSchema,
				},
			},
			description: "Backward-compatible readiness endpoint",
		},
		503: {
			content: {
				"application/json": {
					schema: readinessSchema,
				},
			},
			description: "Backward-compatible readiness endpoint failed",
		},
	},
});

const buildReadinessPayload = async () => {
	let dbStatus = "connected";
	try {
		await db.run(sql`select 1`);
	} catch (_err) {
		dbStatus = "disconnected";
	}

	return {
		status: dbStatus === "connected" ? "healthy" : "degraded",
		database: dbStatus,
		timestamp: new Date().toISOString(),
		version: "1.0.0",
	};
};

const readinessHandler = async (c: Context) => {
	const payload = await buildReadinessPayload();
	return c.json(payload, payload.status === "healthy" ? 200 : 503);
};

export const healthRouter = createOpenApiRouter()
	.openapi(liveRoute, (c) => {
		return c.json(
			{
				status: "alive",
				timestamp: new Date().toISOString(),
				version: "1.0.0",
			},
			200,
		);
	})
	.openapi(readyRoute, readinessHandler)
	.openapi(legacyHealthRoute, readinessHandler);
