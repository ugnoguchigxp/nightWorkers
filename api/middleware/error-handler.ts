import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { config } from "../config";
import { AppError } from "../lib/errors";
import { logger as globalLogger } from "../lib/logger";

export const errorHandler = async (err: Error, c: Context) => {
	const logger = c.get("logger") || globalLogger;

	if (err instanceof AppError) {
		if (err.statusCode >= 500) {
			logger.error(err, "AppError");
		} else {
			logger.warn(
				{ code: err.code, message: err.message, details: err.details },
				"AppError",
			);
		}
		return c.json(
			{
				error: {
					code: err.code,
					message: err.message,
					details: err.details,
				},
			},
			err.statusCode as ContentfulStatusCode,
		);
	}

	if (err instanceof HTTPException) {
		logger.warn({ status: err.status, message: err.message }, "HTTPException");
		return c.json(
			{
				error: {
					code: err.name || "HTTP_EXCEPTION",
					message: err.message || "HTTP request exception",
				},
			},
			err.status as ContentfulStatusCode,
		);
	}

	logger.error(err, "Unhandled Error");
	return c.json(
		{
			error: {
				code: "INTERNAL_SERVER_ERROR",
				message:
					config.NODE_ENV === "production"
						? "An unexpected error occurred"
						: err.message || "An unexpected error occurred",
				stack: config.NODE_ENV !== "production" ? err.stack : undefined,
			},
		},
		500,
	);
};
