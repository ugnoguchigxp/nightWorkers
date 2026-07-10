import {
	createWorktreeRequestSchema,
	removeWorktreeRequestSchema,
	worktreeAdviceRequestSchema,
	worktreeIdRequestSchema,
} from "../../../shared/schemas/git-worktree.schema";
import { AppError } from "../../lib/errors";
import { createOpenApiRouter } from "../../lib/openapi";
import {
	type NightWorkersRouteContext,
	withRouteError,
} from "./nightworkers.route-utils";
import * as service from "./nightworkers.worktrees.service";

export const worktreeRouter = createOpenApiRouter();

async function readJson(c: NightWorkersRouteContext) {
	try {
		return await c.req.json();
	} catch {
		throw new AppError(400, "INVALID_JSON_BODY", "JSON body is required");
	}
}

function repositoryId(c: NightWorkersRouteContext) {
	const id = c.req.param("id");
	if (!id)
		throw new AppError(
			400,
			"REPOSITORY_ID_REQUIRED",
			"Repository id is required",
		);
	return id;
}

worktreeRouter.get(
	"/repositories/:id/worktrees",
	withRouteError(async (c) =>
		c.json(await service.listRepositoryWorktrees(repositoryId(c))),
	),
);

worktreeRouter.post(
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

worktreeRouter.post(
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

worktreeRouter.delete(
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

worktreeRouter.get(
	"/repositories/:id/worktrees/prune-preview",
	withRouteError(async (c) =>
		c.json(await service.previewRepositoryWorktreePrune(repositoryId(c))),
	),
);

worktreeRouter.post(
	"/repositories/:id/worktrees/prune",
	withRouteError(async (c) =>
		c.json(await service.pruneRepositoryWorktrees(repositoryId(c))),
	),
);

worktreeRouter.post(
	"/repositories/:id/worktrees/advice",
	withRouteError(async (c) => {
		const input = worktreeAdviceRequestSchema.safeParse(await readJson(c));
		if (!input.success) {
			throw new AppError(
				400,
				"INVALID_ADVICE_REQUEST",
				"Invalid advice request",
			);
		}
		return c.json(
			await service.adviseRepositoryWorktrees(repositoryId(c), input.data),
		);
	}),
);
