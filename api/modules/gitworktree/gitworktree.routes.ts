import type { Context, Input } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
	createWorktreeRequestSchema,
	removeWorktreeRequestSchema,
	worktreeIdRequestSchema,
} from "../../../shared/schemas/gitworktree.schema";
import { AppError } from "../../lib/errors";
import { createOpenApiRouter } from "../../lib/openapi";
import type { AppEnv } from "../../lib/types";
import * as service from "./gitworktree.service";

export const gitworktreeRouter = createOpenApiRouter();

type GitworktreeRouteContext = Context<AppEnv, string, Input>;

function routeErrorResponse(c: GitworktreeRouteContext, error: unknown) {
	if (error instanceof AppError) {
		return c.json(
			{
				error: error.message,
				code: error.code,
				...(error.details || {}),
			},
			error.statusCode as ContentfulStatusCode,
		);
	}
	return c.json({ error: "Internal server error" }, 500);
}

function withRouteError(
	handler: (c: GitworktreeRouteContext) => Response | Promise<Response>,
) {
	return async (c: GitworktreeRouteContext) => {
		try {
			return await handler(c);
		} catch (error) {
			return routeErrorResponse(c, error);
		}
	};
}

async function readJson(c: GitworktreeRouteContext) {
	try {
		return await c.req.json();
	} catch {
		throw new AppError(400, "INVALID_JSON_BODY", "JSON body is required");
	}
}

function repositoryId(c: GitworktreeRouteContext) {
	const id = c.req.param("id");
	if (!id)
		throw new AppError(
			400,
			"REPOSITORY_ID_REQUIRED",
			"Repository id is required",
		);
	return id;
}

gitworktreeRouter.get(
	"/repositories/:id/worktrees",
	withRouteError(async (c) =>
		c.json(await service.listRepositoryWorktrees(repositoryId(c))),
	),
);

gitworktreeRouter.post(
	"/repositories/:id/worktrees",
	withRouteError(async (c) => {
		const input = createWorktreeRequestSchema.safeParse(await readJson(c));
		if (!input.success) {
			throw new AppError(
				400,
				"INVALID_WORKTREE_REQUEST",
				"Invalid worktree request",
			);
		}
		return c.json(
			await service.createRepositoryWorktree(repositoryId(c), input.data),
			201,
		);
	}),
);

gitworktreeRouter.post(
	"/repositories/:id/worktrees/diff",
	withRouteError(async (c) => {
		const input = worktreeIdRequestSchema.safeParse(await readJson(c));
		if (!input.success) {
			throw new AppError(
				400,
				"INVALID_WORKTREE_REQUEST",
				"Invalid worktree request",
			);
		}
		return c.json(
			await service.readRepositoryWorktreeDiff(
				repositoryId(c),
				input.data.worktreeId,
			),
		);
	}),
);

gitworktreeRouter.delete(
	"/repositories/:id/worktrees",
	withRouteError(async (c) => {
		const input = removeWorktreeRequestSchema.safeParse(await readJson(c));
		if (!input.success) {
			throw new AppError(
				400,
				"INVALID_WORKTREE_REQUEST",
				"Invalid worktree request",
			);
		}
		return c.json(
			await service.removeRepositoryWorktree(repositoryId(c), input.data),
		);
	}),
);

gitworktreeRouter.get(
	"/repositories/:id/worktrees/prune-preview",
	withRouteError(async (c) =>
		c.json(await service.previewRepositoryWorktreePrune(repositoryId(c))),
	),
);

gitworktreeRouter.post(
	"/repositories/:id/worktrees/prune",
	withRouteError(async (c) =>
		c.json(await service.pruneRepositoryWorktrees(repositoryId(c))),
	),
);
