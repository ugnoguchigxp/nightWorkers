import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import type { Context, Input } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "../../lib/errors";
import type { AppEnv } from "../../lib/types";

export type NightWorkersRouteContext<
	Path extends string = string,
	RouteInput extends Input = Input,
> = Context<AppEnv, Path, RouteInput>;
export type NightWorkersRouteHandler<
	ContextType extends NightWorkersRouteContext,
> = (c: ContextType) => Response | Promise<Response>;

export function queueRouteError<ContextType extends NightWorkersRouteContext>(
	c: ContextType,
	err: unknown,
): Response {
	if (err instanceof AppError) {
		return c.json(
			{ error: err.message, code: err.code, ...(err.details || {}) },
			err.statusCode as ContentfulStatusCode,
		);
	}
	const message = err instanceof Error ? err.message : String(err);
	return c.json({ error: message }, 500);
}

export function routeErrorResponse<
	ContextType extends NightWorkersRouteContext,
>(c: ContextType, err: unknown): never {
	return queueRouteError(c, err) as never;
}

export function withRouteError<ContextType extends NightWorkersRouteContext>(
	handler: NightWorkersRouteHandler<ContextType>,
): NightWorkersRouteHandler<ContextType> {
	return async (c) => {
		try {
			return await handler(c);
		} catch (err) {
			return queueRouteError(c, err);
		}
	};
}

export function withOpenApiRouteError<Route extends RouteConfig>(
	_route: Route,
	handler: RouteHandler<Route, AppEnv>,
): RouteHandler<Route, AppEnv> {
	return (async (...args: Parameters<RouteHandler<Route, AppEnv>>) => {
		try {
			return await handler(...args);
		} catch (err) {
			return routeErrorResponse(args[0], err);
		}
	}) as unknown as RouteHandler<Route, AppEnv>;
}
