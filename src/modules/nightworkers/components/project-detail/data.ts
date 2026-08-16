import type { ProjectDetailMetrics } from "../../../../../shared/schemas/project-detail.schema";

export { readJsonResponse } from "../../../../lib/api-error";

export const emptyMetrics: ProjectDetailMetrics = {
	stackProfile: {
		summary: "",
		manifestStatus: "missing",
		manifestPath: "",
		packageManager: null,
		technologies: [],
	},
	codeSizeSnapshot: null,
	projectMeta: null,
};
