import { useEffect, useId, useMemo, useRef, useState } from "react";

export function MermaidDiagram({
	chart,
	idPrefix = "data-model",
}: {
	chart: string;
	idPrefix?: string;
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
	const [isFullscreen, setIsFullscreen] = useState(false);

	useEffect(() => {
		let cancelled = false;
		containerRef.current?.replaceChildren();
		setRendered(false);
		setRenderedSvg("");
		setError("");
		setIsFullscreen(false);
		import("mermaid")
			.then(async ({ default: mermaid }) => {
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
				const rendered = await mermaid.render(diagramId, chart);
				if (cancelled || !containerRef.current) return;
				if (!replaceMermaidSvg(containerRef.current, rendered.svg)) {
					throw new Error("Mermaid did not return SVG output.");
				}
				setRenderedSvg(rendered.svg);
				setRendered(true);
			})
			.catch((err: unknown) => {
				if (!cancelled)
					setError(err instanceof Error ? err.message : String(err));
			});
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
				<div className="text-[11px] text-amber-300">
					Mermaid render failed: {error}
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

function replaceMermaidSvg(target: Element | null, svg: string) {
	if (!target) return false;
	const parsedSvg = new DOMParser().parseFromString(svg, "image/svg+xml");
	const svgElement = parsedSvg.documentElement;
	if (svgElement.nodeName.toLowerCase() !== "svg") return false;
	target.replaceChildren(document.importNode(svgElement, true));
	return true;
}
