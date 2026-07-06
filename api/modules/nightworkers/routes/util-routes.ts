import { createRoute, z } from "@hono/zod-openapi";

export const browseFoldersRoute = createRoute({
	method: "get",
	path: "/utils/browse-folders",
	request: {
		query: z.object({
			path: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						currentPath: z.string(),
						parentPath: z.string().nullable(),
						directories: z.array(
							z.object({
								name: z.string(),
								path: z.string(),
							}),
						),
						error: z.string().optional(),
					}),
				},
			},
			description: "List directories under a path",
		},
	},
});

export const createFolderRoute = createRoute({
	method: "post",
	path: "/utils/create-folder",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						parentPath: z.string().optional(),
						name: z.string().min(1),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({
						name: z.string(),
						path: z.string(),
					}),
				},
			},
			description: "Create a directory under the selected path",
		},
		400: {
			description: "Invalid folder name",
		},
	},
});
