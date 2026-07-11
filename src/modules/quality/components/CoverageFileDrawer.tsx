import { FileCode2, Loader2, ShieldCheck, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import type { CoverageFileReport } from "../../../../shared/schemas/quality.schema";
import { FileViewer } from "../../nightworkers/components/ArtifactFileViewers";
import { fetchRepositoryFile } from "../../nightworkers/nightWorkersCommands";
import type { ProjectFileContent } from "../../nightworkers/types";
import { fetchCoverageFileReport } from "../api/qualityCommands";
import type { CoverageFileRow } from "../model/qualityRows";
import { controlStyle, panelStyle, primaryTextStyle } from "./qualityStyles";

type ViewerTab = "source" | "coverage";

export function CoverageFileDrawer({
	repositoryId,
	runId,
	row,
	onClose,
}: {
	repositoryId: string;
	runId: string;
	row: CoverageFileRow;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const [tab, setTab] = useState<ViewerTab>("source");
	const [source, setSource] = useState<ProjectFileContent | null>(null);
	const [report, setReport] = useState<CoverageFileReport | null>(null);
	const [sourceError, setSourceError] = useState("");
	const [reportError, setReportError] = useState("");
	const [sourceLoading, setSourceLoading] = useState(true);
	const [reportLoading, setReportLoading] = useState(false);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const drawerRef = useRef<HTMLElement>(null);

	useEffect(() => {
		const previouslyFocused = document.activeElement;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		closeButtonRef.current?.focus();
		return () => {
			document.body.style.overflow = previousOverflow;
			if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
		};
	}, []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
				return;
			}
			if (event.key !== "Tab") return;
			const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
				'button:not([disabled]), iframe, [href], [tabindex]:not([tabindex="-1"])',
			);
			if (!focusable || focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	useEffect(() => {
		let cancelled = false;
		setTab("source");
		setSource(null);
		setReport(null);
		setSourceError("");
		setReportError("");
		setSourceLoading(true);
		fetchRepositoryFile(repositoryId, row.file)
			.then(async (response) => {
				if (!response.ok)
					throw new Error(t("projectDetail.quality.sourceLoadFailed"));
				return (await response.json()) as ProjectFileContent;
			})
			.then((value) => {
				if (!cancelled) setSource(value);
			})
			.catch((error) => {
				if (!cancelled)
					setSourceError(
						error instanceof Error ? error.message : String(error),
					);
			})
			.finally(() => {
				if (!cancelled) setSourceLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [repositoryId, row.file, t]);

	useEffect(() => {
		if (tab !== "coverage" || report || reportError) return;
		let cancelled = false;
		setReportLoading(true);
		fetchCoverageFileReport(repositoryId, runId, row.key)
			.then(async (response) => {
				if (!response.ok)
					throw new Error(t("projectDetail.quality.coverageReportLoadFailed"));
				return (await response.json()) as CoverageFileReport;
			})
			.then((value) => {
				if (!cancelled) setReport(value);
			})
			.catch((error) => {
				if (!cancelled)
					setReportError(
						error instanceof Error ? error.message : String(error),
					);
			})
			.finally(() => {
				if (!cancelled) setReportLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [report, reportError, repositoryId, row.key, runId, t, tab]);

	return (
		<div className="fixed inset-0 z-50">
			<button
				type="button"
				className="absolute inset-0 h-full w-full bg-black/50"
				onClick={onClose}
			>
				<span className="sr-only">
					{t("projectDetail.quality.coverageViewerClose")}
				</span>
			</button>
			<aside
				ref={drawerRef}
				aria-label={t("projectDetail.quality.coverageViewer")}
				aria-modal="true"
				className="relative ml-auto flex h-full w-full flex-col border-l shadow-2xl md:w-1/2"
				role="dialog"
				style={panelStyle}
			>
				<header
					className="flex items-center gap-3 border-b px-4 py-3"
					style={controlStyle}
				>
					<FileCode2 className="h-4 w-4" />
					<div className="min-w-0 flex-1">
						<div className="text-xs font-semibold" style={primaryTextStyle}>
							{t("projectDetail.quality.coverageViewer")}
						</div>
						<div className="truncate font-mono text-[11px]" title={row.file}>
							{row.file}
						</div>
					</div>
					<Button
						ref={closeButtonRef}
						type="button"
						variant="ghost"
						className="h-8 w-8 p-0"
						onClick={onClose}
					>
						<X className="h-4 w-4" />
						<span className="sr-only">
							{t("projectDetail.quality.coverageViewerClose")}
						</span>
					</Button>
				</header>

				<div
					aria-label={t("projectDetail.quality.coverageViewerTabs")}
					className="flex gap-1 border-b px-4 pt-2"
					role="tablist"
				>
					<ViewerTabButton
						active={tab === "source"}
						controls="coverage-source-panel"
						id="coverage-source-tab"
						onClick={() => setTab("source")}
					>
						<FileCode2 className="h-3.5 w-3.5" />
						{t("projectDetail.quality.sourceViewerTab")}
					</ViewerTabButton>
					<ViewerTabButton
						active={tab === "coverage"}
						controls="coverage-report-panel"
						id="coverage-report-tab"
						onClick={() => setTab("coverage")}
					>
						<ShieldCheck className="h-3.5 w-3.5" />
						{t("projectDetail.quality.coverageViewerTab")}
					</ViewerTabButton>
				</div>

				<div
					aria-labelledby={`${tab === "source" ? "coverage-source" : "coverage-report"}-tab`}
					className="min-h-0 flex-1 overflow-hidden"
					id={`${tab === "source" ? "coverage-source" : "coverage-report"}-panel`}
					role="tabpanel"
				>
					{tab === "source" ? (
						sourceLoading ? (
							<DrawerLoading />
						) : source ? (
							<FileViewer file={source} />
						) : (
							<DrawerMessage message={sourceError} />
						)
					) : reportLoading ? (
						<DrawerLoading />
					) : report?.available && report.html ? (
						<iframe
							className="h-full w-full border-0"
							sandbox=""
							srcDoc={report.html}
							title={`${t("projectDetail.quality.coverageViewerTab")}: ${row.file}`}
						/>
					) : (
						<DrawerMessage
							message={
								reportError ||
								t(
									`projectDetail.quality.coverageReportUnavailable.${report?.reason ?? "report_missing"}`,
								)
							}
						/>
					)}
				</div>
			</aside>
		</div>
	);
}

function ViewerTabButton({
	active,
	children,
	controls,
	id,
	onClick,
}: {
	active: boolean;
	children: ReactNode;
	controls: string;
	id: string;
	onClick: () => void;
}) {
	return (
		<button
			aria-controls={controls}
			aria-selected={active}
			className="flex h-9 items-center gap-2 border-b-2 px-3 text-xs font-semibold"
			id={id}
			onClick={onClick}
			role="tab"
			style={{
				borderColor: active ? "var(--nw-primary)" : "transparent",
				color: active ? "var(--nw-primary)" : "var(--nw-muted)",
			}}
			type="button"
		>
			{children}
		</button>
	);
}

function DrawerLoading() {
	const { t } = useTranslation();
	return (
		<div
			aria-label={t("projectDetail.quality.coverageViewerLoading")}
			className="flex h-full items-center justify-center"
			role="status"
		>
			<Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
		</div>
	);
}

function DrawerMessage({ message }: { message: string }) {
	return (
		<div
			className="flex h-full items-center justify-center p-8 text-center text-sm"
			role="status"
			style={{ color: "var(--nw-muted)" }}
		>
			{message}
		</div>
	);
}
