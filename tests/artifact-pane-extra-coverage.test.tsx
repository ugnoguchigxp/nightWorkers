import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Effect = () => void;

let stateSlots: unknown[] = [];
let stateCursor = 0;
let effects: Effect[] = [];
let selection: Record<string, unknown>;
let evidenceQuery: Record<string, unknown>;
let exportActionsInput: Record<string, unknown>;
let lazyLoaders: Array<() => Promise<unknown>> = [];

const mocks = {
	buildEvidenceCheckExportCsv: vi.fn(() => "evidence csv"),
	buildEvidenceCheckExportMarkdown: vi.fn(() => "evidence markdown"),
	buildEvidenceCheckPanelModel: vi.fn(() => ({ title: "evidence panel" })),
	useEvidenceCheckSnapshot: vi.fn(),
	resolveReviewImplementationCompletionReport: vi.fn(() => ({
		completed: true,
	})),
	artifactFileStem: vi.fn((title: string) => `stem-${title}`),
	buildMarkdownFromValue: vi.fn(() => "review markdown"),
	logArtifactPaneRendered: vi.fn(),
	useProjectArtifactRefresh: vi.fn(),
	resolveArtifactWorkspaceInitialTab: vi.fn(() => "status"),
	useArtifactPaneSelection: vi.fn(),
	buildExportedArtifactContent: vi.fn(() => "default markdown"),
	useArtifactPaneExportActions: vi.fn(),
	handleCopyMarkdown: vi.fn(async () => undefined),
	handleDownloadCsv: vi.fn(),
	handleDownloadMarkdown: vi.fn(),
	handleDownloadImage: vi.fn(async () => undefined),
};

function defaultSelection(overrides: Record<string, unknown> = {}) {
	return {
		artifactVersions: [],
		currentVersionIndex: 0,
		displayArtifact: null,
		showDiff: false,
		showBlueprintWorkspace: false,
		showReviewStatus: false,
		showEvidenceCheck: false,
		showBlueprint: false,
		showComponentDesign: false,
		taskMessageId: null,
		selectedMessage: null,
		selectedActivityArtifact: null,
		artifactBlueprint: null,
		artifactMockBlueprint: null,
		artifactValidation: null,
		artifactGeneration: null,
		...overrides,
	};
}

async function createHarness() {
	stateSlots = [];
	stateCursor = 0;
	effects = [];
	selection = defaultSelection();
	evidenceQuery = { data: undefined, isLoading: false, isError: false };
	exportActionsInput = {};
	lazyLoaders = [];
	for (const mock of Object.values(mocks)) mock.mockClear();
	mocks.buildEvidenceCheckExportCsv.mockReturnValue("evidence csv");
	mocks.buildEvidenceCheckExportMarkdown.mockReturnValue("evidence markdown");
	mocks.buildEvidenceCheckPanelModel.mockReturnValue({
		title: "evidence panel",
	});
	mocks.resolveReviewImplementationCompletionReport.mockReturnValue({
		completed: true,
	});
	mocks.artifactFileStem.mockImplementation((title: string) => `stem-${title}`);
	mocks.buildMarkdownFromValue.mockReturnValue("review markdown");
	mocks.resolveArtifactWorkspaceInitialTab.mockReturnValue("status");
	mocks.buildExportedArtifactContent.mockReturnValue("default markdown");
	mocks.useEvidenceCheckSnapshot.mockImplementation(() => evidenceQuery);
	mocks.useArtifactPaneSelection.mockImplementation(() => selection);
	mocks.useArtifactPaneExportActions.mockImplementation((input) => {
		exportActionsInput = input;
		return {
			artifactCaptureRef: { current: null },
			handleCopyMarkdown: mocks.handleCopyMarkdown,
			handleDownloadCsv: mocks.handleDownloadCsv,
			handleDownloadMarkdown: mocks.handleDownloadMarkdown,
			handleDownloadImage: mocks.handleDownloadImage,
		};
	});
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		let lazyIndex = 0;
		return {
			...actual,
			Suspense: "suspense",
			lazy: vi.fn((loader: () => Promise<unknown>) => {
				lazyLoaders.push(loader);
				return lazyIndex++ === 0 ? "plan-workspace" : "review-status";
			}),
			useEffect: (effect: Effect) => effects.push(effect),
			useMemo: <T,>(factory: () => T) => factory(),
			useState: <T,>(initial: T) => {
				const index = stateCursor++;
				if (stateSlots.length <= index) stateSlots[index] = initial;
				const setter = vi.fn((next: T | ((current: T) => T)) => {
					stateSlots[index] =
						typeof next === "function"
							? (next as (current: T) => T)(stateSlots[index] as T)
							: next;
				});
				return [stateSlots[index] as T, setter] as const;
			},
		};
	});
	vi.doMock("react-i18next", () => ({
		useTranslation: () => ({ t: (key: string) => key }),
	}));
	vi.doMock("../src/modules/codingAgent", () => ({
		buildEvidenceCheckExportCsv: mocks.buildEvidenceCheckExportCsv,
		buildEvidenceCheckExportMarkdown: mocks.buildEvidenceCheckExportMarkdown,
		buildEvidenceCheckPanelModel: mocks.buildEvidenceCheckPanelModel,
		EvidenceCheckArtifactViewer: "evidence-viewer",
		useEvidenceCheckSnapshot: mocks.useEvidenceCheckSnapshot,
	}));
	vi.doMock("../src/modules/review", () => ({
		ReviewStatusViewer: "review-status",
		resolveReviewImplementationCompletionReport:
			mocks.resolveReviewImplementationCompletionReport,
	}));
	vi.doMock("../src/modules/planMode", () => ({
		PlanModeWorkspaceViewer: "plan-workspace",
	}));
	vi.doMock("../src/modules/nightworkers/artifactExport", () => ({
		artifactFileStem: mocks.artifactFileStem,
		buildMarkdownFromValue: mocks.buildMarkdownFromValue,
	}));
	vi.doMock("../src/modules/nightworkers/artifactPerformance", () => ({
		logArtifactPaneRendered: mocks.logArtifactPaneRendered,
	}));
	vi.doMock(
		"../src/modules/nightworkers/components/ArtifactFileViewers",
		() => ({
			DiffViewer: "diff-viewer",
			FileViewer: "file-viewer",
			MarkdownViewer: "markdown-viewer",
		}),
	);
	vi.doMock(
		"../src/modules/nightworkers/components/ArtifactPane.controller",
		() => ({
			resolveArtifactWorkspaceInitialTab:
				mocks.resolveArtifactWorkspaceInitialTab,
			useProjectArtifactRefresh: mocks.useProjectArtifactRefresh,
		}),
	);
	vi.doMock(
		"../src/modules/nightworkers/components/ArtifactPaneActions",
		() => ({
			ArtifactHeaderActions: "artifact-actions",
			ProjectTreeHeaderActions: "project-actions",
		}),
	);
	vi.doMock(
		"../src/modules/nightworkers/components/ArtifactPaneContentViewers",
		() => ({
			BlueprintViewer: "blueprint-viewer",
			ComponentDesignViewer: "component-viewer",
			FilesOutline: "files-outline",
			ProjectDiffContent: "project-diff",
		}),
	);
	vi.doMock(
		"../src/modules/nightworkers/components/ArtifactPaneExportActions",
		() => ({
			useArtifactPaneExportActions: mocks.useArtifactPaneExportActions,
		}),
	);
	vi.doMock(
		"../src/modules/nightworkers/components/ArtifactPaneSelection",
		() => ({ useArtifactPaneSelection: mocks.useArtifactPaneSelection }),
	);
	vi.doMock(
		"../src/modules/nightworkers/components/ArtifactPaneVersions",
		() => ({
			buildExportedArtifactContent: mocks.buildExportedArtifactContent,
		}),
	);

	const { ArtifactPane } = await import(
		"../src/modules/nightworkers/components/ArtifactPane"
	);
	await Promise.all(lazyLoaders.map((loader) => loader()));
	return {
		usePane(input: ReturnType<typeof props>) {
			stateCursor = 0;
			effects = [];
			return ArtifactPane(input as never) as ReactElement;
		},
	};
}

function props(overrides: Record<string, unknown> = {}) {
	return {
		activeProject: null,
		activeSessionId: null,
		latestRun: undefined,
		latestRunEvents: [],
		focusType: "artifact",
		selectedArtifact: null,
		taskMessages: [],
		activityArtifacts: [],
		fileEntries: [],
		fileEntriesByDirectory: {},
		expandedDirectories: {},
		loadingDirectories: {},
		selectedFile: null,
		selectedFilePath: null,
		isFilesLoading: false,
		isFileLoading: false,
		projectDiff: null,
		isDiffLoading: false,
		onToggleDirectory: vi.fn(async () => undefined),
		onOpenFile: vi.fn(),
		onRefreshFiles: vi.fn(async () => undefined),
		onRefreshDiff: vi.fn(async () => undefined),
		...overrides,
	};
}

function elements(node: ReactNode): ReactElement[] {
	if (
		node === null ||
		node === undefined ||
		typeof node === "boolean" ||
		typeof node === "string" ||
		typeof node === "number"
	)
		return [];
	if (Array.isArray(node)) return node.flatMap(elements);
	const element = node as ReactElement<{ children?: ReactNode }>;
	return [element, ...elements(element.props?.children)];
}

function requiredElement(root: ReactElement, type: string) {
	const element = elements(root).find((candidate) => candidate.type === type);
	if (!element) throw new Error(`Element not found: ${type}`);
	return element;
}

function text(node: ReactNode): string {
	if (node === null || node === undefined || typeof node === "boolean")
		return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(text).join(" ");
	return text((node as ReactElement<{ children?: ReactNode }>).props?.children);
}

describe("ArtifactPane extra coverage", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("renders uncontrolled and controlled project tree modes", async () => {
		const harness = await createHarness();
		let root = harness.usePane(props({ focusType: "project_tree" }));
		let actions = requiredElement(root, "project-actions");
		expect(actions.props.mode).toBe("tree");
		expect(requiredElement(root, "files-outline").props).toMatchObject({
			isFilesLoading: false,
			selectedFilePath: null,
		});
		expect(text(root)).toContain("artifact.projectTree");
		expect(text(root)).toContain("artifact.selectFileOrDiff");
		expect(mocks.useProjectArtifactRefresh).toHaveBeenCalledWith(
			expect.objectContaining({ isProjectTreeVisible: true, mode: "tree" }),
		);

		actions.props.onModeChange("diff");
		actions.props.onToggleFullscreen();
		expect(stateSlots[2]).toBe("diff");
		expect(stateSlots[1]).toBe(true);
		root = harness.usePane(props({ focusType: "project_tree" }));
		expect(root.props.className).toContain("fixed inset-3");
		expect(requiredElement(root, "project-diff").props).toMatchObject({
			diff: "",
			isLoading: false,
		});

		const onModeChange = vi.fn();
		root = harness.usePane(
			props({
				focusType: "project_tree",
				projectArtifactMode: "tree",
				onProjectArtifactModeChange: onModeChange,
				selectedFilePath: "src/index.ts",
			}),
		);
		actions = requiredElement(root, "project-actions");
		actions.props.onModeChange("diff");
		expect(onModeChange).toHaveBeenCalledWith("diff");
		expect(stateSlots[2]).toBe("diff");
		expect(text(root)).toContain("src/index.ts");
	});

	it("renders project diff, file, file-loading, and empty project states", async () => {
		const harness = await createHarness();
		let root = harness.usePane(
			props({
				focusType: "project_tree",
				projectArtifactMode: "diff",
				activeProject: { id: "project-1" },
				projectDiff: null,
			}),
		);
		expect(text(root)).toContain("artifact.gitDiff");
		expect(requiredElement(root, "project-diff").props).toMatchObject({
			diff: "",
			isLoading: true,
		});

		root = harness.usePane(
			props({
				focusType: "project_tree",
				projectArtifactMode: "diff",
				projectDiff: { diff: "@@ changed" },
				isDiffLoading: true,
			}),
		);
		expect(requiredElement(root, "project-diff").props).toMatchObject({
			diff: "@@ changed",
			isLoading: true,
		});

		root = harness.usePane(
			props({
				focusType: "project_tree",
				selectedFile: { path: "src/a.ts", content: "export {}" },
			}),
		);
		expect(requiredElement(root, "file-viewer").props.file).toMatchObject({
			path: "src/a.ts",
		});
		root = harness.usePane(
			props({ focusType: "project_tree", isFileLoading: true }),
		);
		expect(text(root)).toContain("artifact.loadingFile");
	});

	it("renders diff and document artifacts and drives version/export actions", async () => {
		const harness = await createHarness();
		const artifact = { id: "artifact", kind: "document", title: "Document" };
		selection = defaultSelection({
			artifactVersions: [
				{ id: "version-1", title: "One" },
				{ id: "version-2", title: "Two" },
			],
			currentVersionIndex: 0,
			displayArtifact: artifact,
			showDiff: true,
		});
		let root = harness.usePane(
			props({ selectedArtifact: artifact, latestRun: { diffPatch: "@@ run" } }),
		);
		expect(requiredElement(root, "diff-viewer").props.diff).toBe("@@ run");
		let actions = requiredElement(root, "artifact-actions");
		expect(actions.props).toMatchObject({
			currentVersionIndex: 0,
			versionCount: 2,
			onDownloadCsv: undefined,
			exportDisabled: false,
		});
		actions.props.onPrevious();
		expect(stateSlots[0]).toBeNull();
		actions.props.onNext();
		expect(stateSlots[0]).toBe("version-2");
		actions.props.onCopyMarkdown();
		actions.props.onDownloadMarkdown();
		actions.props.onDownloadImage();
		actions.props.onToggleFullscreen();
		expect(mocks.handleCopyMarkdown).toHaveBeenCalledOnce();
		expect(mocks.handleDownloadMarkdown).toHaveBeenCalledOnce();
		expect(mocks.handleDownloadImage).toHaveBeenCalledOnce();
		expect(stateSlots[1]).toBe(true);

		selection = defaultSelection({
			displayArtifact: artifact,
			selectedMessage: { id: "message", content: "# Markdown" },
		});
		root = harness.usePane(props({ selectedArtifact: artifact }));
		expect(requiredElement(root, "markdown-viewer").props.content).toBe(
			"# Markdown",
		);
		actions = requiredElement(root, "artifact-actions");
		expect(actions.props.versionCount).toBe(1);
		actions.props.onNext();
		expect(stateSlots[0]).toBeNull();
	});

	it("renders plan workspace and uses only matching scoped export descriptors", async () => {
		const harness = await createHarness();
		const artifact = {
			id: "plan",
			kind: "plan_mode_workspace",
			title: "Plan",
			metadata: { initialTab: "feature-plan" },
		};
		selection = defaultSelection({
			displayArtifact: artifact,
			showBlueprintWorkspace: true,
		});
		let root = harness.usePane(
			props({
				activeSessionId: "task-1",
				selectedArtifact: artifact,
				onQueueSession: vi.fn(),
				onAddToQueue: vi.fn(),
				isImplementationLocked: true,
			}),
		);
		expect(text(root)).toContain("thread.planModeWorkspace");
		const viewer = requiredElement(root, "plan-workspace");
		expect(viewer.props).toMatchObject({
			sessionId: "task-1",
			initialTab: "status",
			isImplementationLocked: true,
		});
		expect(exportActionsInput.descriptor).toMatchObject({
			title: "thread.planModeWorkspace",
			markdown: "default markdown",
		});

		const scoped = {
			scopeId: "task-1",
			title: "Scoped Plan",
			fileStem: "scoped",
			markdown: "scoped markdown",
		};
		viewer.props.onExportDescriptorChange(scoped);
		root = harness.usePane(
			props({ activeSessionId: "task-1", selectedArtifact: artifact }),
		);
		expect(exportActionsInput.descriptor).toBe(scoped);

		root = harness.usePane(
			props({ activeSessionId: "task-2", selectedArtifact: artifact }),
		);
		expect(exportActionsInput.descriptor).not.toBe(scoped);
	});

	it("renders review status with explicit, metadata, and absent review detail", async () => {
		const harness = await createHarness();
		const metadataDetail = { id: "review-from-metadata" };
		const artifact = {
			id: "review",
			kind: "review_status",
			title: "Review",
			metadata: {
				reviewSession: metadataDetail,
				reviewSessionLoading: true,
			},
		};
		selection = defaultSelection({
			displayArtifact: artifact,
			showReviewStatus: true,
		});
		let root = harness.usePane(
			props({
				activeSessionId: "task-1",
				selectedArtifact: artifact,
				activeReviewSession: { id: "explicit-review" },
				activeTaskStatus: "completed",
				onCompleteAndArchiveTask: vi.fn(),
				onRestoreArchivedTask: vi.fn(),
				onSubmitReviewPrompt: vi.fn(),
				isReviewPromptDisabled: true,
			}),
		);
		expect(text(root)).toContain("reviewStatus.title");
		let viewer = requiredElement(root, "review-status");
		expect(viewer.props).toMatchObject({
			detail: { id: "explicit-review" },
			loading: true,
			activeTaskId: "task-1",
			isReviewPromptDisabled: true,
		});
		expect(
			mocks.resolveReviewImplementationCompletionReport,
		).toHaveBeenCalled();
		expect(mocks.buildMarkdownFromValue).toHaveBeenCalled();

		root = harness.usePane(props({ selectedArtifact: artifact }));
		viewer = requiredElement(root, "review-status");
		expect(viewer.props.detail).toBe(metadataDetail);

		selection = defaultSelection({
			displayArtifact: { ...artifact, metadata: {} },
			showReviewStatus: true,
		});
		root = harness.usePane(props({ selectedArtifact: artifact }));
		expect(requiredElement(root, "review-status").props.detail).toBeNull();
	});

	it("renders evidence snapshots with active polling and CSV export states", async () => {
		const harness = await createHarness();
		const artifact = { id: "evidence", kind: "evidence", title: "Evidence" };
		selection = defaultSelection({
			displayArtifact: artifact,
			showEvidenceCheck: true,
		});
		evidenceQuery = {
			data: { checks: [{ id: "check" }] },
			isLoading: false,
			isError: false,
		};
		let root = harness.usePane(
			props({
				selectedArtifact: artifact,
				latestRun: { id: "run", status: "running" },
			}),
		);
		expect(mocks.useEvidenceCheckSnapshot).toHaveBeenCalledWith(
			{ title: "evidence panel" },
			{ refetchInterval: 1500 },
		);
		expect(requiredElement(root, "evidence-viewer").props).toMatchObject({
			snapshot: { checks: [{ id: "check" }] },
			fetchSnapshot: false,
		});
		let actions = requiredElement(root, "artifact-actions");
		expect(actions.props.exportDisabled).toBe(false);
		expect(actions.props.onDownloadCsv).toBe(mocks.handleDownloadCsv);
		actions.props.onDownloadCsv();
		expect(mocks.handleDownloadCsv).toHaveBeenCalledOnce();
		expect(mocks.buildEvidenceCheckExportCsv).toHaveBeenCalled();

		evidenceQuery = { data: null, isLoading: true, isError: true };
		root = harness.usePane(
			props({
				selectedArtifact: artifact,
				latestRun: { id: "run", status: "completed" },
			}),
		);
		expect(mocks.useEvidenceCheckSnapshot).toHaveBeenLastCalledWith(
			{ title: "evidence panel" },
			{ refetchInterval: false },
		);
		actions = requiredElement(root, "artifact-actions");
		expect(actions.props.exportDisabled).toBe(true);
		expect(actions.props.onDownloadCsv).toBeUndefined();
	});

	it("renders blueprint, component-design, and unavailable artifact fallbacks", async () => {
		const harness = await createHarness();
		const blueprintArtifact = {
			id: "blueprint",
			kind: "app_blueprint",
			title: "Blueprint",
			metadata: {
				appBlueprint: { name: "metadata blueprint" },
				mockBlueprint: { name: "metadata mock" },
				validation: { valid: true },
			},
		};
		selection = defaultSelection({
			displayArtifact: blueprintArtifact,
			showBlueprint: true,
			taskMessageId: "message-1",
			artifactBlueprint: { name: "selected blueprint" },
			artifactMockBlueprint: { name: "selected mock" },
			artifactValidation: { valid: false },
			artifactGeneration: { attempt: 1 },
			selectedMessage: { content: "blueprint markdown" },
		});
		let root = harness.usePane(
			props({ activeSessionId: "task-1", selectedArtifact: blueprintArtifact }),
		);
		let viewer = requiredElement(root, "blueprint-viewer");
		expect(viewer.props).toMatchObject({
			messageId: "message-1",
			blueprint: { name: "selected blueprint" },
			mockBlueprint: { name: "selected mock" },
			validation: { valid: false },
			markdown: "blueprint markdown",
		});

		selection = defaultSelection({
			displayArtifact: blueprintArtifact,
			showBlueprint: true,
			selectedActivityArtifact: { contentText: "activity markdown" },
		});
		root = harness.usePane(props({ selectedArtifact: blueprintArtifact }));
		viewer = requiredElement(root, "blueprint-viewer");
		expect(viewer.props).toMatchObject({
			blueprint: { name: "metadata blueprint" },
			mockBlueprint: { name: "metadata mock" },
			validation: { valid: true },
			markdown: "activity markdown",
		});

		const componentArtifact = {
			id: "component",
			kind: "component_design",
			title: "Component",
			metadata: { designDelta: { components: [] } },
		};
		selection = defaultSelection({
			displayArtifact: componentArtifact,
			showComponentDesign: true,
		});
		root = harness.usePane(props({ selectedArtifact: componentArtifact }));
		expect(requiredElement(root, "component-viewer").props.artifact).toEqual({
			components: [],
		});

		selection = defaultSelection();
		root = harness.usePane(props({ selectedArtifact: { id: "missing" } }));
		expect(text(root)).toContain("Artifact target is not available.");
	});

	it("logs the rendered artifact and collection sizes", async () => {
		const harness = await createHarness();
		const artifact = { id: "artifact", title: "Untitled" };
		selection = defaultSelection({
			displayArtifact: artifact,
			artifactVersions: [{ id: "one" }],
		});
		harness.usePane(
			props({
				selectedArtifact: artifact,
				taskMessages: [{ id: "message" }],
				activityArtifacts: [{ id: "activity" }, { id: "activity-2" }],
			}),
		);
		effects[0]();
		expect(mocks.logArtifactPaneRendered).toHaveBeenCalledWith(artifact, {
			activityArtifactCount: 2,
			artifactVersionCount: 1,
			taskMessageCount: 1,
		});
	});
});
