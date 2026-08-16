// biome-ignore-all lint/correctness/useHookAtTopLevel: these hook factories run against a mocked React dispatcher to exercise returned request actions directly.
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	apiFetch: vi.fn(),
	updatePlanModeRouting: vi.fn(),
	mutationOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tanstack/react-query", () => ({
	useMutation: (options: Record<string, unknown>) => {
		mocks.mutationOptions.push(options);
		return options;
	},
}));
vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return { ...actual, useCallback: <T>(callback: T) => callback };
});
vi.mock("../src/lib/api-base", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("../src/modules/specification", () => ({
	updatePlanModeRouting: mocks.updatePlanModeRouting,
}));

import { useCodingAgentCommandMutations } from "../src/modules/codingAgent/codingAgentCommandMutations";
import { usePlanModeRoutingEditor } from "../src/modules/planMode/usePlanModeRoutingEditor";

const taskId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

function errorResponse(status: number, code: string, message: string) {
	return new Response(JSON.stringify({ error: { code, message } }), { status });
}

describe("general REST consumer decoder regressions", () => {
	it("keeps command-protocol execution separate while decoding the follow-up Run REST error", async () => {
		mocks.mutationOptions.length = 0;
		mocks.apiFetch.mockResolvedValueOnce(
			errorResponse(404, "RUN_NOT_FOUND", "The Run no longer exists"),
		);
		const mutations = useCodingAgentCommandMutations({
			client: {
				execute: vi.fn(async () => ({ data: { runId } })),
			} as never,
		});
		const mutationFn = mutations.startRunMutation.mutationFn as (input: {
			taskId: string;
			expectedTaskRevision: number;
		}) => Promise<unknown>;

		await expect(
			mutationFn({ taskId, expectedTaskRevision: 3 }),
		).rejects.toMatchObject({
			status: 404,
			code: "RUN_NOT_FOUND",
			message: "The Run no longer exists",
		});
	});

	it("uses the shared error envelope for plan-routing updates instead of response text", async () => {
		mocks.updatePlanModeRouting.mockResolvedValueOnce(
			errorResponse(409, "REVISION_CONFLICT", "Routing has changed"),
		);
		const runAction = vi.fn(
			async (_action: string, fn: () => Promise<void>) => {
				await fn();
				return true;
			},
		);
		const updateRouting = usePlanModeRoutingEditor({
			sessionId: taskId,
			routing: { revision: 2 } as never,
			runAction,
		});

		await expect(updateRouting("blueprint", "include")).rejects.toMatchObject({
			status: 409,
			code: "REVISION_CONFLICT",
			message: "Routing has changed",
		});
		expect(mocks.updatePlanModeRouting).toHaveBeenCalledWith(
			taskId,
			expect.objectContaining({ expectedRevision: 2 }),
		);
	});
});
