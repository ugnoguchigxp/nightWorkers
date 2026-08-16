// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buttonByLabel,
	clickDom,
	flushDom,
	mountDom,
	setInputValue,
} from "./dom-test-utils";

type RepositoryPageState = {
	isLoading?: boolean;
	createError?: Error | null;
};

async function loadRepositoriesPage(state: RepositoryPageState = {}) {
	vi.resetModules();
	const queryClient = { invalidateQueries: vi.fn() };
	const create = vi.fn(
		async () => new Response(JSON.stringify({ id: "repo-2" })),
	);
	const remove = vi.fn(
		async () => new Response(JSON.stringify({ id: "repo-1" })),
	);
	let mutationCount = 0;

	vi.doMock("react-i18next", () => ({
		useTranslation: () => ({ t: (key: string) => key }),
	}));
	vi.doMock("@tanstack/react-query", async () => {
		const actual = await vi.importActual<
			typeof import("@tanstack/react-query")
		>("@tanstack/react-query");
		return {
			...actual,
			useQuery: () => ({
				data: [
					{
						id: "repo-1",
						name: "Existing repository",
						localPath: "/work/existing",
						branch: "main",
					},
				],
				isLoading: state.isLoading ?? false,
			}),
			useQueryClient: () => queryClient,
			useMutation: (options: {
				mutationFn: (value: unknown) => Promise<unknown>;
				onSuccess?: () => void;
			}) => {
				const isCreate = mutationCount++ === 0;
				return {
					isPending: false,
					error: isCreate ? (state.createError ?? null) : null,
					mutate: (value: unknown) => {
						void options.mutationFn(value).then(options.onSuccess);
					},
				};
			},
		};
	});
	vi.doMock("../src/lib/api", () => ({
		client: {
			repositories: {
				$post: create,
				":id": { $delete: remove },
			},
		},
	}));

	const { RepositoriesPage } = await import("../src/routes/repositories");
	return { RepositoriesPage, create, remove, queryClient };
}

describe("RepositoriesPage behavior", () => {
	afterEach(() => {
		document.body.replaceChildren();
		vi.unstubAllGlobals();
	});

	it("renders loading and API errors, then creates and removes repositories through the canonical cache", async () => {
		let module = await loadRepositoriesPage({ isLoading: true });
		let screen = await mountDom(<module.RepositoriesPage />);
		expect(screen.container.querySelector('[aria-busy="true"]')).not.toBeNull();
		await screen.unmount();

		module = await loadRepositoriesPage({
			createError: new Error("Repository request failed"),
		});
		screen = await mountDom(<module.RepositoriesPage />);
		expect(
			screen.container.querySelector('[role="alert"]')?.textContent,
		).toContain("Repository request failed");

		await setInputValue(
			screen.container.querySelector(
				'input[placeholder="repositories.friendlyNamePlaceholder"]',
			) as HTMLInputElement,
			"New repository",
		);
		await setInputValue(
			screen.container.querySelector(
				'input[placeholder="repositories.localPathPlaceholder"]',
			) as HTMLInputElement,
			"/work/new",
		);
		await clickDom(
			buttonByLabel(screen.container, "repositories.registerWorkspace"),
		);
		await flushDom();
		expect(module.create).toHaveBeenCalledWith({
			json: expect.objectContaining({
				name: "New repository",
				localPath: "/work/new",
				branch: "main",
			}),
		});
		expect(module.queryClient.invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["repositories"],
		});

		vi.stubGlobal("confirm", () => true);
		await clickDom(buttonByLabel(screen.container, "repositories.delete"));
		await flushDom();
		expect(module.remove).toHaveBeenCalledWith({ param: { id: "repo-1" } });
		expect(module.queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
		await screen.unmount();
	});
});
