import type { Context } from "hono";
import {
	logSerializedApiError,
	serializeApiError,
} from "../lib/api-error-response";
import { logger as globalLogger } from "../lib/logger";

export const errorHandler = async (err: Error, c: Context) => {
	const logger = c.get("logger") || globalLogger;
	const serialized = serializeApiError(err);
	logSerializedApiError(logger, serialized);
	return c.json(serialized.body, serialized.status);
};
