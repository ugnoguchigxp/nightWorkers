import { afterEach, describe, expect, it } from "vitest";
import { implementationProviderFixtureRouter } from "../api/e2eFixtures/implementation-provider-fixture.routes";
import { e2eFixtureRouter } from "../api/modules/nightworkers/routes/e2e-fixture-routes";
import { missionCandidatesFixtureRouter } from "../api/modules/nightworkers/routes/mission-candidates-fixture-route";

const taskId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "22222222-2222-4222-8222-222222222222";
const goalId = "33333333-3333-4333-8333-333333333333";

function request(
	router: { request: (input: RequestInfo) => Promise<Response> },
	path: string,
	body: unknown,
) {
	return router.request(
		new Request(`http://localhost${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

describe("isolated E2E fixture error contract", () => {
	afterEach(() => {
		delete process.env.NIGHTWORKERS_E2E_ISOLATED;
	});

	it("hides all fixture routes behind the canonical NotFound envelope", async () => {
		const responses = await Promise.all([
			request(
				implementationProviderFixtureRouter,
				"/e2e/fixtures/coding-agent-scenario",
				{ taskId, scenario: "direct-run" },
			),
			request(e2eFixtureRouter, "/e2e/fixtures/task-markdown", {
				taskId,
				content: "fixture",
				intent: "implementation_plan",
			}),
			request(
				missionCandidatesFixtureRouter,
				"/e2e/fixtures/mission-candidates",
				{
					repositoryId,
					goalId,
					candidates: [],
				},
			),
		]);

		for (const response of responses) {
			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({
				error: { code: "NOT_FOUND", message: "Not found" },
			});
		}
	});
});
