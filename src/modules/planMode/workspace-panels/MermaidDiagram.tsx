import { useEffect, useId, useMemo, useRef, useState } from "react";

export type MermaidRenderFailureStage =
	| "module_load"
	| "chart_parse"
	| "chart_render"
	| "svg_import";

export type MermaidRenderFailure = {
	stage: MermaidRenderFailureStage;
	message: string;
	chart: string;
};

export function MermaidDiagram({
	chart,
	idPrefix = "data-model",
	onRenderFailure,
}: {
	chart: string;
	idPrefix?: string;
	onRenderFailure?: (failure: MermaidRenderFailure) => void;
}) {
	const rawId = useId();
	const diagramId = useMemo(
		() => `${idPrefix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
		[idPrefix, rawId],
	);
	const containerRef = useRef<HTMLButtonElement | null>(null);
	const fullscreenContainerRef = useRef<HTMLButtonElement | null>(null);
	const [rendered, setRendered] = useState(false);
	const [renderedSvg, setRenderedSvg] = useState("");
	const [error, setError] = useState("");
	const [errorStage, setErrorStage] =
		useState<MermaidRenderFailureStage | null>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const renderFailureHandlerRef = useRef(onRenderFailure);
	renderFailureHandlerRef.current = onRenderFailure;

	useEffect(() => {
		let cancelled = false;
		containerRef.current?.replaceChildren();
		setRendered(false);
		setRenderedSvg("");
		setError("");
		setErrorStage(null);
		setIsFullscreen(false);
		const reportFailure = (stage: MermaidRenderFailureStage, err: unknown) => {
			if (cancelled) return;
			const message = err instanceof Error ? err.message : String(err);
			setError(message);
			setErrorStage(stage);
			renderFailureHandlerRef.current?.({ stage, message, chart });
		};
		void (async () => {
			let mermaid: typeof import("mermaid")["default"];
			try {
				({ default: mermaid } = await import("mermaid"));
			} catch (err) {
				reportFailure("module_load", err);
				return;
			}
			try {
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: "strict",
					theme: "dark",
					themeVariables: {
						darkMode: true,
						background: "#020617",
						mainBkg: "#0f172a",
						primaryColor: "#164e63",
						primaryTextColor: "#e2e8f0",
						lineColor: "#67e8f9",
						textColor: "#e2e8f0",
					},
				});
				await mermaid.parse(chart);
			} catch (err) {
				reportFailure("chart_parse", err);
				return;
			}
			try {
				const rendered = await mermaid.render(diagramId, chart);
				if (cancelled) return;
				if (!replaceMermaidSvg(containerRef.current, rendered.svg)) {
					reportFailure(
						"svg_import",
						new Error("Mermaid SVG could not be imported into the document."),
					);
					return;
				}
				setRenderedSvg(rendered.svg);
				setRendered(true);
			} catch (err) {
				reportFailure("chart_render", err);
			}
		})().catch((err: unknown) => reportFailure("chart_render", err));
		return () => {
			cancelled = true;
		};
	}, [chart, diagramId]);

	useEffect(() => {
		if (isFullscreen && renderedSvg) {
			replaceMermaidSvg(fullscreenContainerRef.current, renderedSvg);
		}
	}, [isFullscreen, renderedSvg]);

	return (
		<div className="grid gap-2">
			<div className="relative">
				<button
					type="button"
					ref={containerRef}
					className={`w-full overflow-x-auto rounded border border-slate-800 bg-slate-950 p-3 text-left [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full ${
						rendered ? "cursor-zoom-in" : "hidden"
					}`}
					onClick={() => {
						if (renderedSvg) setIsFullscreen(true);
					}}
					aria-label="Open Mermaid diagram fullscreen"
					title={renderedSvg ? "Open Mermaid diagram fullscreen" : undefined}
				/>
			</div>
			{!rendered ? (
				<pre className="nightworkers-code-block overflow-x-auto rounded border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-200">
					<code>{chart}</code>
				</pre>
			) : null}
			{error ? (
				<div
					className="text-[11px] text-amber-300"
					data-mermaid-error-stage={errorStage || undefined}
				>
					Mermaid {formatMermaidFailureStage(errorStage)} failed: {error}
				</div>
			) : null}
			<details className="text-[11px] text-slate-400">
				<summary className="cursor-pointer text-slate-300">
					Mermaid source
				</summary>
				<pre className="mt-2 overflow-x-auto rounded border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-300">
					<code>{chart}</code>
				</pre>
			</details>
			{isFullscreen && renderedSvg ? (
				<div
					className="fixed inset-0 z-50 grid bg-slate-950/95 p-4"
					data-artifact-export-exclude
				>
					<button
						type="button"
						ref={fullscreenContainerRef}
						className="min-h-0 cursor-zoom-out overflow-auto rounded border border-cyan-500/40 bg-slate-950 p-4 text-left [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-h-[calc(100vh-4rem)] [&_svg]:max-w-full"
						aria-label="Close fullscreen Mermaid diagram"
						title="Close fullscreen Mermaid diagram"
						onClick={() => setIsFullscreen(false)}
					/>
				</div>
			) : null}
		</div>
	);
}

export function replaceMermaidSvg(target: Element | null, svg: string) {
	if (!target) return false;
	const parsedSvg = new DOMParser().parseFromString(svg, "text/html");
	const svgElement = parsedSvg.querySelector("svg");
	if (!svgElement) return false;
	target.replaceChildren(document.importNode(svgElement, true));
	return true;
}

function formatMermaidFailureStage(stage: MermaidRenderFailureStage | null) {
	if (stage === "chart_parse") return "parse";
	if (stage === "chart_render") return "render";
	if (stage === "svg_import") return "SVG import";
	if (stage === "module_load") return "module load";
	return "render";
}
