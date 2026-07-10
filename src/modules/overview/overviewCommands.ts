import { apiFetch } from "../../lib/api-base";

export function fetchOverview(query: string) {
	return apiFetch(`/api/overview?${query}`);
}
