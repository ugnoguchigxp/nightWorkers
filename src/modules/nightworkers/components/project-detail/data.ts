import type { ProjectDetailMetrics } from "../../../../../shared/schemas/project-detail.schema";

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

export async function readJsonResponse<T>(response: Response): Promise<T> {
	const payload = (await response.json().catch(() => null)) as unknown;
	if (!response.ok) {
		const errorValue =
			payload && typeof payload === "object" && "error" in payload
				? payload.error
				: null;
		const message =
			typeof errorValue === "string"
				? errorValue
				: errorValue &&
						typeof errorValue === "object" &&
						"message" in errorValue &&
						typeof errorValue.message === "string"
					? errorValue.message
					: `Request failed: ${response.status}`;
		throw new Error(message);
	}
	return payload as T;
}
