import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { mockBlueprintToPreviewBlueprintSafely } from "../../blueprint-preview";
import type { ProjectFileEntry } from "../types";
import { DiffViewer, MarkdownViewer, ProjectTree } from "./ArtifactFileViewers";

const BlueprintArtifactViewer = lazy(() =>
	import("../../blueprint-preview").then((module) => ({
		default: module.BlueprintArtifactViewer,
	})),
);
const ComponentDesignArtifactViewer = lazy(() =>
	import("../../blueprint-preview").then((module) => ({
		default: module.ComponentDesignArtifactViewer,
	})),
);

export function FilesOutline({
	isFilesLoading,
	fileEntries,
	fileEntriesByDirectory,
	expandedDirectories,
	loadingDirectories,
	selectedFilePath,
	onToggleDirectory,
	onOpenFile,
}: {
	isFilesLoading: boolean;
	fileEntries: ProjectFileEntry[];
	fileEntriesByDirectory: Record<string, ProjectFileEntry[]>;
	expandedDirectories: Record<string, boolean>;
	loadingDirectories: Record<string, boolean>;
	selectedFilePath: string | null;
	onToggleDirectory: (path: string) => Promise<void>;
	onOpenFile: (path: string) => void;
}) {
	const { t } = useTranslation();

	return (
		<>
			{isFilesLoading ? (
				<div className="px-2 py-1 text-[11px] text-slate-500">
					{t("artifact.loading")}
				</div>
			) : (
				<ProjectTree
					entries={fileEntries}
					entriesByDirectory={fileEntriesByDirectory}
					expandedDirectories={expandedDirectories}
					loadingDirectories={loadingDirectories}
					selectedFilePath={selectedFilePath}
					onToggleDirectory={onToggleDirectory}
					onOpenFile={onOpenFile}
				/>
			)}
		</>
	);
}

export function ProjectDiffContent({
	diff,
	isLoading,
	onOpenProjectFile,
}: {
	diff: string;
	isLoading: boolean;
	onOpenProjectFile?: (path: string) => void;
}) {
	const { t } = useTranslation();
	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center text-xs text-slate-500">
				{t("artifact.loadingDiff")}
			</div>
		);
	}
	return (
		<div className="h-full overflow-y-auto p-3">
			<DiffViewer diff={diff} onOpenProjectFile={onOpenProjectFile} />
		</div>
	);
}

export function BlueprintViewer({
	sessionId,
	messageId,
	blueprint,
	mockBlueprint,
	validation,
	generation,
	markdown,
	onOpenProjectFile,
}: {
	sessionId: string | null;
	messageId: string | null;
	blueprint: unknown;
	mockBlueprint?: unknown;
	validation: unknown;
	generation?: unknown;
	markdown?: string;
	onOpenProjectFile?: (path: string) => void;
}) {
	const { t } = useTranslation();
	const previewBlueprint = isObject(mockBlueprint)
		? mockBlueprintToPreviewBlueprintSafely(mockBlueprint)
		: blueprint;

	if (!isObject(previewBlueprint)) {
		if (isObject(mockBlueprint)) {
			return (
				<div className="flex h-full items-center justify-center p-6 text-xs text-amber-100">
					<div className="rounded border border-amber-700/70 bg-amber-950/20 p-3">
						Blueprint preview conversion failed.
					</div>
				</div>
			);
		}
		return (
			<MarkdownViewer
				content={markdown || t("artifact.noBlueprintContent")}
				onOpenProjectFile={onOpenProjectFile}
			/>
		);
	}
	return (
		<Suspense
			fallback={<ArtifactViewerLoading label={t("artifact.loading")} />}
		>
			<BlueprintArtifactViewer
				sessionId={sessionId}
				messageId={messageId}
				blueprint={previewBlueprint}
				validation={validation}
				generation={generation}
			/>
		</Suspense>
	);
}

export function ComponentDesignViewer({
	artifact,
	markdown,
	onOpenProjectFile,
}: {
	artifact: unknown;
	markdown?: string;
	onOpenProjectFile?: (path: string) => void;
}) {
	const { t } = useTranslation();

	if (!isObject(artifact))
		return (
			<MarkdownViewer
				content={markdown || t("artifact.noComponentDesign")}
				onOpenProjectFile={onOpenProjectFile}
			/>
		);
	return (
		<Suspense
			fallback={<ArtifactViewerLoading label={t("artifact.loading")} />}
		>
			<ComponentDesignArtifactViewer artifact={artifact} />
		</Suspense>
	);
}

function ArtifactViewerLoading({ label }: { label: string }) {
	return (
		<div
			className="flex h-full items-center justify-center text-xs text-slate-500"
			role="status"
		>
			{label}
		</div>
	);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
