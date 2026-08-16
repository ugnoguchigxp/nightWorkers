import { apiFetch } from "../../lib/api-base";

export function fetchOverview(query: string, init?: RequestInit) {
	return apiFetch(`/api/overview?${query}`, init);
}
