import { createRoute, z } from "@hono/zod-openapi";
import { projectGitIntegrationPolicySchema } from "../../../../shared/schemas/git-integration.schema";
import {
	createRepositorySchema,
	repositorySchema,
	safetyPolicySchema,
	updateRepositoryGitIntegrationSchema,
} from "../../../../shared/schemas/nightworkers.schema";

export const listRepositoriesRoute = createRoute({
	method: "get",
	path: "/repositories",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.array(repositorySchema),
				},
			},
			description: "List of all repositories",
		},
	},
});

export const createRepositoryRoute = createRoute({
	method: "post",
	path: "/repositories",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createRepositorySchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: repositorySchema,
				},
			},
			description: "Repository created successfully",
		},
	},
});

export const getRepositoryRoute = createRoute({
	method: "get",
	path: "/repositories/:id",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "repo-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: repositorySchema,
				},
			},
			description: "Repository detail",
		},
		404: {
			description: "Repository not found",
		},
	},
});

export const updateRepositoryRoute = createRoute({
	method: "patch",
	path: "/repositories/:id",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "repo-uuid" }),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						queueEnabled: z.boolean().optional(),
						maxConcurrentSessions: z.number().int().positive().optional(),
						safetyPolicy: safetyPolicySchema.optional(),
						branch:
							updateRepositoryGitIntegrationSchema.shape.branch.optional(),
						gitIntegrationPolicy: projectGitIntegrationPolicySchema.optional(),
						expectedGitIntegrationVersion:
							updateRepositoryGitIntegrationSchema.shape.expectedGitIntegrationVersion.optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: repositorySchema,
				},
			},
			description: "Repository updated successfully",
		},
		404: {
			description: "Repository not found",
		},
	},
});

export const listProjectFilesRoute = createRoute({
	method: "get",
	path: "/repositories/:id/files",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "repo-uuid" }),
		}),
		query: z.object({
			path: z.string().optional(),
			runId: z.string().uuid().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.array(
						z.object({
							name: z.string(),
							path: z.string(),
							type: z.enum(["file", "directory"]),
							size: z.number().optional(),
						}),
					),
				},
			},
			description: "Project file tree entries",
		},
		404: { description: "Repository not found" },
	},
});

export const readProjectFileRoute = createRoute({
	method: "get",
	path: "/repositories/:id/file",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "repo-uuid" }),
		}),
		query: z.object({
			path: z.string(),
			runId: z.string().uuid().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						path: z.string(),
						content: z.string(),
						size: z.number(),
						truncated: z.boolean(),
					}),
				},
			},
			description: "Project file content",
		},
		404: { description: "Repository not found" },
	},
});

export const readRepositoryDiffRoute = createRoute({
	method: "get",
	path: "/repositories/:id/diff",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "repo-uuid" }),
		}),
		query: z.object({
			runId: z.string().uuid().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						diff: z.string(),
						diffStat: z.string(),
						hasChanges: z.boolean(),
					}),
				},
			},
			description: "Current repository git diff",
		},
		404: { description: "Repository not found" },
	},
});

export const deleteRepositoryRoute = createRoute({
	method: "delete",
	path: "/repositories/:id",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "repo-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: repositorySchema,
				},
			},
			description: "Repository deleted successfully",
		},
		404: {
			description: "Repository not found",
		},
	},
});
