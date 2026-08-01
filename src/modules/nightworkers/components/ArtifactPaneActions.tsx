import {
	ChevronLeft,
	ChevronRight,
	Copy,
	Download,
	FileSpreadsheet,
	FileText,
	FolderTree,
	GitCompare,
	Image as ImageIcon,
	LoaderCircle,
	Maximize2,
	Minimize2,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectArtifactMode } from "./ArtifactPane.controller";

export function ArtifactHeaderActions({
	currentVersionIndex,
	versionCount,
	isFullscreen,
	onPrevious,
	onNext,
	onCopyMarkdown,
	onDownloadMarkdown,
	onDownloadCsv,
	onDownloadImage,
	isExportingImage,
	exportDisabled,
	exportError,
	onToggleFullscreen,
}: {
	currentVersionIndex: number;
	versionCount: number;
	isFullscreen: boolean;
	onPrevious: () => void;
	onNext: () => void;
	onCopyMarkdown: () => void;
	onDownloadMarkdown: () => void;
	onDownloadCsv?: () => void;
	onDownloadImage: () => void;
	isExportingImage: boolean;
	exportDisabled?: boolean;
	exportError: string | null;
	onToggleFullscreen: () => void;
}) {
	const { t } = useTranslation();
	return (
		<div
			className="flex shrink-0 items-center gap-1"
			data-artifact-export-exclude
		>
			<button
				type="button"
				className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
				disabled={currentVersionIndex <= 0}
				onClick={onPrevious}
				aria-label={t("artifact.previousVersion")}
				title={t("artifact.previousVersion")}
			>
				<ChevronLeft className="h-3.5 w-3.5" />
			</button>
			<span className="min-w-[4.5rem] text-center text-[11px] text-slate-400">
				{t("artifact.versionLabel", {
					current: currentVersionIndex + 1,
					total: Math.max(versionCount, 1),
				})}
			</span>
			<button
				type="button"
				className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
				disabled={currentVersionIndex >= versionCount - 1}
				onClick={onNext}
				aria-label={t("artifact.nextVersion")}
				title={t("artifact.nextVersion")}
			>
				<ChevronRight className="h-3.5 w-3.5" />
			</button>
			<ArtifactExportMenu
				onCopyMarkdown={onCopyMarkdown}
				onDownloadMarkdown={onDownloadMarkdown}
				onDownloadCsv={onDownloadCsv}
				onDownloadImage={onDownloadImage}
				isExportingImage={isExportingImage}
				disabled={exportDisabled}
				exportError={exportError}
			/>
			<button
				type="button"
				className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 hover:border-slate-500"
				onClick={onToggleFullscreen}
				aria-label={
					isFullscreen ? t("artifact.exitFullscreen") : t("artifact.fullscreen")
				}
				title={
					isFullscreen ? t("artifact.exitFullscreen") : t("artifact.fullscreen")
				}
			>
				{isFullscreen ? (
					<Minimize2 className="h-3.5 w-3.5" />
				) : (
					<Maximize2 className="h-3.5 w-3.5" />
				)}
			</button>
		</div>
	);
}

export function ArtifactExportMenu({
	onCopyMarkdown,
	onDownloadMarkdown,
	onDownloadCsv,
	onDownloadImage,
	isExportingImage,
	exportError,
	disabled = false,
}: {
	onCopyMarkdown: () => void;
	onDownloadMarkdown: () => void;
	onDownloadCsv?: () => void;
	onDownloadImage: () => void;
	isExportingImage: boolean;
	exportError: string | null;
	disabled?: boolean;
}) {
	const { t } = useTranslation();
	const [isOpen, setIsOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	useEffect(() => {
		if (!isOpen) return;
		const focusFrame = requestAnimationFrame(() => {
			menuRef.current
				?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
				?.focus();
		});
		const closeOnOutsideClick = (event: MouseEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setIsOpen(false);
			triggerRef.current?.focus();
		};
		document.addEventListener("mousedown", closeOnOutsideClick);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			cancelAnimationFrame(focusFrame);
			document.removeEventListener("mousedown", closeOnOutsideClick);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [isOpen]);
	const select = (action: () => void) => {
		setIsOpen(false);
		action();
		requestAnimationFrame(() => triggerRef.current?.focus());
	};
	return (
		<div ref={menuRef} className="relative">
			<button
				ref={triggerRef}
				type="button"
				className={`nightworkers-artifact-export-trigger inline-flex h-7 w-7 items-center justify-center rounded border ${
					exportError ? "nightworkers-artifact-export-trigger-error" : ""
				}`}
				onClick={() => setIsOpen((value) => !value)}
				disabled={disabled}
				aria-label={t("artifact.exportMenu")}
				aria-haspopup="menu"
				aria-expanded={isOpen}
				title={exportError || t("artifact.exportMenu")}
			>
				{isExportingImage ? (
					<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
				) : (
					<Download className="h-3.5 w-3.5" />
				)}
			</button>
			{isOpen ? (
				<div
					role="menu"
					className="nightworkers-artifact-export-menu absolute right-0 top-8 z-50 grid w-56 gap-1 rounded-md border p-1.5 text-xs"
					onKeyDown={(event) => {
						if (
							event.key !== "ArrowDown" &&
							event.key !== "ArrowUp" &&
							event.key !== "Home" &&
							event.key !== "End"
						)
							return;
						const items = Array.from(
							menuRef.current?.querySelectorAll<HTMLButtonElement>(
								'[role="menuitem"]:not(:disabled)',
							) || [],
						);
						if (!items.length) return;
						event.preventDefault();
						const currentIndex = items.indexOf(
							document.activeElement as HTMLButtonElement,
						);
						const nextIndex =
							event.key === "Home"
								? 0
								: event.key === "End"
									? items.length - 1
									: event.key === "ArrowUp"
										? (currentIndex - 1 + items.length) % items.length
										: (currentIndex + 1) % items.length;
						items[nextIndex]?.focus();
					}}
				>
					<ArtifactExportMenuItem
						icon={<ImageIcon className="h-3.5 w-3.5" />}
						label={
							isExportingImage
								? t("artifact.exportingImage")
								: t("artifact.downloadImage")
						}
						disabled={isExportingImage}
						onSelect={() => select(onDownloadImage)}
					/>
					<ArtifactExportMenuItem
						icon={<FileText className="h-3.5 w-3.5" />}
						label={t("artifact.downloadMarkdown")}
						onSelect={() => select(onDownloadMarkdown)}
					/>
					{onDownloadCsv ? (
						<ArtifactExportMenuItem
							icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
							label={t("artifact.downloadCsv")}
							onSelect={() => select(onDownloadCsv)}
						/>
					) : null}
					<ArtifactExportMenuItem
						icon={<Copy className="h-3.5 w-3.5" />}
						label={t("artifact.copyMarkdown")}
						onSelect={() => select(onCopyMarkdown)}
					/>
					{exportError ? (
						<div
							role="alert"
							className="nightworkers-artifact-export-error px-2 py-1 text-[11px]"
						>
							{exportError}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function ArtifactExportMenuItem({
	icon,
	label,
	disabled = false,
	onSelect,
}: {
	icon: ReactNode;
	label: string;
	disabled?: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			className="nightworkers-artifact-export-menu-item flex w-full items-center gap-2 rounded px-2 py-1.5 text-left disabled:cursor-not-allowed"
			disabled={disabled}
			onClick={onSelect}
		>
			{icon}
			<span>{label}</span>
		</button>
	);
}

export function ProjectTreeHeaderActions({
	mode,
	isFullscreen,
	onModeChange,
	onToggleFullscreen,
}: {
	mode: ProjectArtifactMode;
	isFullscreen: boolean;
	onModeChange: (mode: ProjectArtifactMode) => void;
	onToggleFullscreen: () => void;
}) {
	const { t } = useTranslation();
	return (
		<div className="flex shrink-0 items-center gap-1">
			<button
				type="button"
				className={`inline-flex h-7 w-7 items-center justify-center rounded border text-slate-300 ${
					mode === "tree"
						? "border-sky-500/80 bg-sky-500/15 text-sky-100"
						: "border-slate-700 hover:border-slate-500"
				}`}
				onClick={() => onModeChange("tree")}
				aria-label={t("artifact.showProjectTree")}
				title={t("artifact.showProjectTree")}
			>
				<FolderTree className="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				className={`inline-flex h-7 w-7 items-center justify-center rounded border text-slate-300 ${
					mode === "diff"
						? "border-sky-500/80 bg-sky-500/15 text-sky-100"
						: "border-slate-700 hover:border-slate-500"
				}`}
				onClick={() => onModeChange("diff")}
				aria-label={t("artifact.showGitDiff")}
				title={t("artifact.showGitDiff")}
			>
				<GitCompare className="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 hover:border-slate-500"
				onClick={onToggleFullscreen}
				aria-label={
					isFullscreen ? t("artifact.exitFullscreen") : t("artifact.fullscreen")
				}
				title={
					isFullscreen ? t("artifact.exitFullscreen") : t("artifact.fullscreen")
				}
			>
				{isFullscreen ? (
					<Minimize2 className="h-3.5 w-3.5" />
				) : (
					<Maximize2 className="h-3.5 w-3.5" />
				)}
			</button>
		</div>
	);
}
