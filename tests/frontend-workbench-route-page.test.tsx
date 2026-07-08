import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchRoutePage } from "../src/modules/nightworkers/routing/WorkbenchRoutePage";
import type { WorkbenchRouteState } from "../src/modules/nightworkers/routing/workbench-route-state";

const mockNavigate = vi.fn();
const mockLocation = { pathname: "/workbench", searchStr: "" };
type MockShellProps = {
	onNavigate: (
		state: WorkbenchRouteState,
		options?: { replace?: boolean },
	) => void;
	onOpenFolderBrowser: () => void;
	onCloseFolderBrowser: () => void;
};

vi.mock("@tanstack/react-router", () => ({
	useLocation: () => mockLocation,
	useNavigate: () => mockNavigate,
}));

// Mock custom hooks and components that RoutePage wraps
vi.mock("../src/modules/nightworkers/hooks/useNightWorkersWorkspace", () => ({
	useNightWorkersWorkspace: () => ({
		id: "repo-1",
		name: "NightWorkers",
		localPath: "/tmp",
	}),
}));

vi.mock("../src/modules/nightworkers/components/NightWorkersShell", () => ({
	NightWorkersShell: ({
		onNavigate,
		onOpenFolderBrowser,
		onCloseFolderBrowser,
	}: MockShellProps) => {
		// Render buttons to test actions
		return (
			<div>
				<button
					type="button"
					onClick={() =>
						onNavigate(
							{
								taskId: "task-2",
								runId: "run-2",
								workspaceMode: "branch",
							},
							{ replace: true },
						)
					}
					id="btn-navigate"
				>
					Navigate
				</button>
				<button type="button" onClick={onOpenFolderBrowser} id="btn-open">
					Open
				</button>
				<button type="button" onClick={onCloseFolderBrowser} id="btn-close">
					Close
				</button>
			</div>
		);
	},
}));

vi.mock(
	"../src/modules/nightworkers/contexts/WorkspaceAppearanceContext",
	() => ({
		WorkspaceAppearanceProvider: ({ children }: { children: ReactNode }) => (
			<div className="appearance">{children}</div>
		),
	}),
);

vi.mock("../src/modules/nightworkers/contexts/WorkspaceLayoutContext", () => ({
	WorkspaceLayoutProvider: ({ children }: { children: ReactNode }) => (
		<div className="layout">{children}</div>
	),
}));

vi.mock("../src/modules/nightworkers/routing/last-workbench-route", () => ({
	writeLastWorkbenchRoute: vi.fn(),
}));

describe("WorkbenchRoutePage Component", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLocation.pathname = "/workbench";
		mockLocation.searchStr = "";
	});

	it("renders children, layout and appearance wrappers", () => {
		const state: WorkbenchRouteState = {
			taskId: "task-1",
			runId: "run-1",
			workspaceMode: "inherit",
		};
		const markup = renderToStaticMarkup(
			<WorkbenchRoutePage routeState={state} />,
		);
		expect(markup).toContain("appearance");
		expect(markup).toContain("layout");
	});

	it("canonicalizes route and calls navigate if pathname does not match target route url", () => {
		// Mock canonicalization parameters so that shouldCanonicalizeWorkbenchRoute returns true
		// /workbench is not the standard shape /workspaces/... etc
		mockLocation.pathname = "/wrong-path";

		const state: WorkbenchRouteState = {
			taskId: "task-1",
			runId: "run-1",
			workspaceMode: "inherit",
		};

		renderToStaticMarkup(<WorkbenchRoutePage routeState={state} />);
		expect(mockNavigate).toHaveBeenCalled();
	});
});
