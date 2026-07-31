import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "../../lib/errors";

export function withOpenApiRouteError<Route extends RouteConfig>(
	_route: Route,
	handler: RouteHandler<Route>,
): RouteHandler<Route> {
	return (async (...args: Parameters<RouteHandler<Route>>) => {
		try {
			return await handler(...args);
		} catch (error) {
			const context = args[0];
			if (error instanceof AppError) {
				return context.json(
					{
						error: error.message,
						code: error.code,
						...(error.details ?? {}),
					},
					error.statusCode as ContentfulStatusCode,
				) as never;
			}
			return context.json(
				{ error: error instanceof Error ? error.message : String(error) },
				500,
			) as never;
		}
	}) as unknown as RouteHandler<Route>;
}
