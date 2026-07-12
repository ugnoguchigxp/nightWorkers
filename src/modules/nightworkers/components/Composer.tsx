import { ArrowUp, CircleStop, LoaderCircle, X } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { PromptImageInput } from "../../../../shared/prompt-image";
import {
	isPromptImageMediaType,
	PROMPT_IMAGE_MAX_BYTES,
	PROMPT_IMAGE_MAX_COUNT,
} from "../../../../shared/prompt-image";
import type {
	ComposerThinkingDepth,
	ModelOption,
	ThinkingDepthOption,
	WorkbenchArtifactContext,
	WorkbenchChatIntent,
} from "../types";
import { getChangedFiles, getDiffStats } from "../utils/diff";
import { ModelThinkingControls } from "./ModelThinkingControls";

type ComposerProps = {
	disabled: boolean;
	model: string;
	thinkingDepth: ComposerThinkingDepth;
	modelOptions: ModelOption[];
	thinkingDepthOptions: ThinkingDepthOption[];
	latestDiffPatch?: string;
	draftStorageKey?: string;
	initialPrompt?: string;
	injectedPrompt?: { id: number; text: string } | null;
	discardStoredDraft?: boolean;
	artifactContext?: WorkbenchArtifactContext | null;
	realtimeStatus?: "initializing" | "connecting" | "connected" | "disconnected";
	isStopMode?: boolean;
	isStopping?: boolean;
	onModelChange: (model: string) => void;
	onThinkingDepthChange: (depth: ComposerThinkingDepth) => void;
	onSubmit: (
		prompt: string,
		intent: WorkbenchChatIntent,
		images: PromptImageInput[],
	) => Promise<void>;
	onClearArtifactContext?: () => void;
	onStop?: () => Promise<void>;
	connectionControls?: ReactNode;
};

const COMPOSER_TEXTAREA_MIN_HEIGHT = 58;
const COMPOSER_TEXTAREA_MAX_ROWS = 10;
const COMPOSER_TEXTAREA_FALLBACK_LINE_HEIGHT = 20;

function resizeComposerTextArea(textarea: HTMLTextAreaElement | null) {
	if (!textarea) return;
	textarea.style.height = "auto";

	const style = window.getComputedStyle(textarea);
	const lineHeight =
		Number.parseFloat(style.lineHeight) ||
		COMPOSER_TEXTAREA_FALLBACK_LINE_HEIGHT;
	const padding =
		(Number.parseFloat(style.paddingTop) || 0) +
		(Number.parseFloat(style.paddingBottom) || 0);
	const border =
		(Number.parseFloat(style.borderTopWidth) || 0) +
		(Number.parseFloat(style.borderBottomWidth) || 0);
	const maxHeight = Math.ceil(
		lineHeight * COMPOSER_TEXTAREA_MAX_ROWS + padding + border,
	);
	const nextHeight = Math.min(
		Math.max(textarea.scrollHeight, COMPOSER_TEXTAREA_MIN_HEIGHT),
		maxHeight,
	);

	textarea.style.height = `${nextHeight}px`;
	textarea.style.overflowY =
		textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

export function Composer({
	disabled,
	model,
	thinkingDepth,
	modelOptions,
	thinkingDepthOptions,
	latestDiffPatch = "",
	draftStorageKey,
	initialPrompt = "",
	injectedPrompt = null,
	discardStoredDraft = false,
	artifactContext = null,
	realtimeStatus = "initializing",
	isStopMode = false,
	isStopping = false,
	onModelChange,
	onThinkingDepthChange,
	onSubmit,
	onClearArtifactContext,
	onStop,
	connectionControls,
}: ComposerProps) {
	const { t } = useTranslation();
	const [prompt, setPrompt] = useState("");
	const [images, setImages] = useState<PromptImageInput[]>([]);
	const [imageError, setImageError] = useState<string | null>(null);
	const [isDraggingImage, setIsDraggingImage] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const dragDepthRef = useRef(0);
	const imagesRef = useRef<PromptImageInput[]>([]);
	const intent: WorkbenchChatIntent = "intake";
	const canSubmit = !disabled && (!!prompt.trim() || images.length > 0);
	const canStop = isStopMode && !!onStop && !isStopping;
	const diffSummary = useMemo(() => {
		if (!latestDiffPatch.trim()) return null;
		return {
			files: getChangedFiles(latestDiffPatch).length,
			stats: getDiffStats(latestDiffPatch),
		};
	}, [latestDiffPatch]);
	const wsStatusDotClass =
		realtimeStatus === "connected"
			? "bg-emerald-400"
			: realtimeStatus === "connecting"
				? "bg-orange-400"
				: realtimeStatus === "disconnected"
					? "bg-red-500"
					: "bg-orange-400";
	const artifactContextKind =
		typeof artifactContext?.metadata?.displayKind === "string"
			? artifactContext.metadata.displayKind
			: artifactContext?.kind;

	const updateImages = useCallback(
		(
			next:
				| PromptImageInput[]
				| ((current: PromptImageInput[]) => PromptImageInput[]),
		) => {
			const value = typeof next === "function" ? next(imagesRef.current) : next;
			imagesRef.current = value;
			setImages(value);
		},
		[],
	);

	const addImageFiles = useCallback(
		async (files: File[]) => {
			const supported = files.filter((file) =>
				isPromptImageMediaType(file.type),
			);
			let nextError =
				supported.length !== files.length
					? t("composer.imageUnsupported")
					: null;
			const sized = supported.filter((file) => {
				if (file.size <= PROMPT_IMAGE_MAX_BYTES) return true;
				nextError = t("composer.imageSizeLimit", {
					megabytes: (PROMPT_IMAGE_MAX_BYTES / 1_000_000).toFixed(2),
				});
				return false;
			});
			if (sized.length === 0) {
				setImageError(nextError);
				return;
			}

			try {
				const decoded = await Promise.all(
					sized.slice(0, PROMPT_IMAGE_MAX_COUNT).map(async (file) => ({
						id: createPromptImageId(),
						name: file.name,
						mediaType: file.type as PromptImageInput["mediaType"],
						size: file.size,
						dataUrl: await readFileAsDataUrl(file),
					})),
				);
				const available = Math.max(
					0,
					PROMPT_IMAGE_MAX_COUNT - imagesRef.current.length,
				);
				if (sized.length > available) {
					nextError = t("composer.imageCountLimit", {
						count: PROMPT_IMAGE_MAX_COUNT,
					});
				}
				const accepted = decoded.slice(0, available);
				if (accepted.length > 0) {
					updateImages((current) => [...current, ...accepted]);
					textareaRef.current?.focus();
				}
				setImageError(nextError);
			} catch {
				setImageError(t("composer.imageReadFailed"));
			}
		},
		[t, updateImages],
	);

	useEffect(() => {
		if (!draftStorageKey) {
			setPrompt("");
			return;
		}
		if (discardStoredDraft) {
			try {
				window.localStorage.removeItem(draftStorageKey);
			} catch {
				// localStorage can be unavailable in private contexts; the in-memory draft still works.
			}
			setPrompt("");
			return;
		}
		try {
			setPrompt(window.localStorage.getItem(draftStorageKey) || initialPrompt);
		} catch {
			setPrompt(initialPrompt);
		}
	}, [discardStoredDraft, draftStorageKey, initialPrompt]);

	useEffect(() => {
		if (!draftStorageKey || discardStoredDraft) return;
		try {
			if (prompt) window.localStorage.setItem(draftStorageKey, prompt);
			else window.localStorage.removeItem(draftStorageKey);
		} catch {
			// localStorage can be unavailable in private contexts; the in-memory draft still works.
		}
	}, [discardStoredDraft, draftStorageKey, prompt]);

	useEffect(() => {
		if (!injectedPrompt) return;
		setPrompt((current) => {
			const next = current.trim()
				? `${current.trim()}\n\n---\n\n${injectedPrompt.text}`
				: injectedPrompt.text;
			return next;
		});
	}, [injectedPrompt]);

	useLayoutEffect(() => {
		resizeComposerTextArea(textareaRef.current);
	});

	useEffect(() => {
		const handleResize = () => resizeComposerTextArea(textareaRef.current);
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	useEffect(() => {
		const containsFiles = (event: DragEvent) =>
			Array.from(event.dataTransfer?.types ?? []).includes("Files");
		const onDragEnter = (event: DragEvent) => {
			if (!containsFiles(event)) return;
			event.preventDefault();
			dragDepthRef.current += 1;
			setIsDraggingImage(true);
		};
		const onDragOver = (event: DragEvent) => {
			if (!containsFiles(event)) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
		};
		const onDragLeave = (_event: DragEvent) => {
			if (dragDepthRef.current === 0) return;
			dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
			if (dragDepthRef.current === 0) setIsDraggingImage(false);
		};
		const resetDragState = () => {
			dragDepthRef.current = 0;
			setIsDraggingImage(false);
		};
		const onDrop = (event: DragEvent) => {
			if (!containsFiles(event)) return;
			event.preventDefault();
			dragDepthRef.current = 0;
			setIsDraggingImage(false);
			void addImageFiles(Array.from(event.dataTransfer?.files ?? []));
		};
		window.addEventListener("dragenter", onDragEnter);
		window.addEventListener("dragover", onDragOver);
		window.addEventListener("dragleave", onDragLeave);
		window.addEventListener("drop", onDrop);
		window.addEventListener("dragend", resetDragState);
		return () => {
			window.removeEventListener("dragenter", onDragEnter);
			window.removeEventListener("dragover", onDragOver);
			window.removeEventListener("dragleave", onDragLeave);
			window.removeEventListener("drop", onDrop);
			window.removeEventListener("dragend", resetDragState);
		};
	}, [addImageFiles]);

	function clearDraft() {
		if (!draftStorageKey) return;
		try {
			window.localStorage.removeItem(draftStorageKey);
		} catch {
			// localStorage cleanup is best-effort; prompt state is authoritative for this render.
		}
	}

	function restoreDraft(text: string) {
		if (!draftStorageKey) return;
		try {
			window.localStorage.setItem(draftStorageKey, text);
		} catch {
			// localStorage can be unavailable in private contexts; the in-memory prompt still restores.
		}
	}

	async function submitCurrentPrompt() {
		if (!canSubmit) return;
		const text = prompt.trim() || t("composer.imageOnlyPrompt");
		const submittedImages = imagesRef.current;
		setPrompt("");
		updateImages([]);
		clearDraft();
		try {
			await onSubmit(text, intent, submittedImages);
		} catch (error) {
			if (isAbortError(error)) return;
			setPrompt(text);
			updateImages(submittedImages);
			restoreDraft(text);
			throw error;
		}
	}

	return (
		<div className="bg-transparent px-3 py-2">
			{isDraggingImage ? (
				<div className="pointer-events-none fixed inset-3 z-[100] flex items-center justify-center rounded-2xl border-2 border-dashed border-cyan-300/80 bg-slate-950/70 text-sm font-medium text-cyan-50 backdrop-blur-sm">
					{t("composer.dropImages")}
				</div>
			) : null}
			<div className="nightworkers-composer relative mx-auto max-w-4xl rounded-2xl border border-slate-600/55 bg-[#1e293b] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
				<div className="absolute -top-3 left-4 z-10 flex h-6 items-center gap-1.5">
					<span
						className={`h-3 w-3 shrink-0 rounded-full ${wsStatusDotClass}`}
						aria-label={t("composer.realtimeStatus", {
							status: realtimeStatus,
						})}
						role="status"
					/>
					{connectionControls}
				</div>
				{diffSummary ? (
					<div className="nightworkers-composer-badge absolute -top-3 right-4 rounded-full border border-slate-600/80 bg-slate-800 px-3 py-1 text-[11px]">
						<span className="text-slate-200">
							{t("composer.diffFiles", { count: diffSummary.files })}
						</span>{" "}
						<span className="text-emerald-400">+{diffSummary.stats.added}</span>{" "}
						<span className="text-rose-400">-{diffSummary.stats.deleted}</span>
					</div>
				) : null}
				{artifactContext ? (
					<div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-950/20 px-3 py-2 text-xs text-cyan-50">
						<span className="font-semibold">{t("composer.contextLabel")}</span>
						<span className="min-w-0 flex-1 truncate text-cyan-100/90">
							{artifactContext.title}
						</span>
						<span className="rounded border border-cyan-500/40 px-1.5 py-0.5 text-[10px] uppercase text-cyan-100/70">
							{artifactContextKind}
						</span>
						{onClearArtifactContext ? (
							<button
								type="button"
								className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-cyan-500/40 text-cyan-100 hover:bg-cyan-900/40"
								onClick={onClearArtifactContext}
								aria-label={t("composer.clearContext")}
								title={t("composer.clearContext")}
							>
								<X className="h-3.5 w-3.5" />
							</button>
						) : null}
					</div>
				) : null}
				{images.length > 0 ? (
					<fieldset
						className="mb-3 flex flex-wrap gap-2 border-0 p-0"
						aria-label={t("composer.attachedImages")}
					>
						{images.map((image) => (
							<div
								key={image.id}
								className="group relative h-20 w-20 overflow-hidden rounded-xl border border-slate-500/70 bg-slate-950/50"
							>
								<img
									src={image.dataUrl}
									alt={image.name}
									className="h-full w-full object-cover"
								/>
								<button
									type="button"
									className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-900 shadow hover:bg-white"
									onClick={() =>
										updateImages((current) =>
											current.filter((item) => item.id !== image.id),
										)
									}
									aria-label={t("composer.removeImage", { name: image.name })}
									title={t("composer.removeImage", { name: image.name })}
								>
									<X className="h-3.5 w-3.5" />
								</button>
							</div>
						))}
					</fieldset>
				) : null}
				{imageError ? (
					<div className="mb-2 text-xs text-amber-300" role="alert">
						{imageError}
					</div>
				) : null}
				<textarea
					ref={textareaRef}
					rows={2}
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					onKeyDown={async (e) => {
						const isSubmitShortcut =
							e.key === "Enter" && (e.metaKey || e.ctrlKey);
						// IME変換中のEnterでは送信しない
						const isComposing = (e.nativeEvent as KeyboardEvent).isComposing;
						if (isSubmitShortcut && !isComposing && canSubmit) {
							e.preventDefault();
							await submitCurrentPrompt();
						}
					}}
					disabled={disabled}
					placeholder={t("composer.placeholder")}
					className="nightworkers-composer-input min-h-[58px] w-full resize-none border-0 bg-transparent text-sm text-slate-100 placeholder:text-slate-300/60 focus:outline-none"
				/>
				<div className="nightworkers-composer-toolbar mt-3 flex flex-wrap items-center gap-2 border-t border-slate-600/35 pt-3">
					<div className="flex shrink-0 items-center gap-2">
						<ModelThinkingControls
							model={model}
							thinkingDepth={thinkingDepth}
							modelOptions={modelOptions}
							thinkingDepthOptions={thinkingDepthOptions}
							onModelChange={onModelChange}
							onThinkingDepthChange={onThinkingDepthChange}
						/>
					</div>
					<button
						type="button"
						onClick={async () => {
							if (isStopMode) {
								if (!canStop || !onStop) return;
								await onStop();
								return;
							}
							await submitCurrentPrompt();
						}}
						disabled={isStopMode ? !canStop : !canSubmit}
						aria-label={isStopMode ? t("composer.stop") : t("composer.send")}
						title={isStopMode ? t("composer.stop") : t("composer.send")}
						className={`nightworkers-composer-submit ml-auto flex h-8 w-8 items-center justify-center rounded-full ${
							isStopMode
								? canStop
									? "nightworkers-composer-stop bg-rose-500 text-white hover:bg-rose-400"
									: "nightworkers-composer-stop-idle bg-rose-900/50 text-rose-200"
								: canSubmit
									? "nightworkers-composer-submit-ready bg-slate-200 text-slate-900"
									: "nightworkers-composer-submit-idle bg-slate-700 text-slate-400"
						}`}
					>
						{isStopMode ? (
							isStopping ? (
								<LoaderCircle className="h-4 w-4 animate-spin" />
							) : (
								<CircleStop className="h-4 w-4" />
							)
						) : (
							<ArrowUp className="h-4 w-4" />
						)}
					</button>
				</div>
			</div>
		</div>
	);
}

function isAbortError(error: unknown) {
	return error instanceof DOMException
		? error.name === "AbortError"
		: error instanceof Error && error.name === "AbortError";
}

function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ""));
		reader.onerror = () =>
			reject(reader.error ?? new Error("Image read failed"));
		reader.readAsDataURL(file);
	});
}

function createPromptImageId() {
	return (
		globalThis.crypto?.randomUUID?.() ??
		`prompt-image-${Date.now()}-${Math.random().toString(36).slice(2)}`
	);
}
