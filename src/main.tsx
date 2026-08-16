import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const DESKTOP_CONFIG_RETRY_COUNT = 30;
const DESKTOP_CONFIG_RETRY_DELAY_MS = 100;

function shouldLoadDesktopConfig() {
	return (
		typeof window !== "undefined" &&
		(import.meta.env.VITE_NIGHTWORKERS_DESKTOP === "1" ||
			"__TAURI_INTERNALS__" in window)
	);
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadDesktopConfig() {
	if (!shouldLoadDesktopConfig()) return;
	if (window.__NIGHTWORKERS_DESKTOP_CONFIG__?.apiOrigin) return;
	let lastError: unknown;
	for (let attempt = 0; attempt <= DESKTOP_CONFIG_RETRY_COUNT; attempt += 1) {
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			window.__NIGHTWORKERS_DESKTOP_CONFIG__ =
				await invoke("get_desktop_config");
			return;
		} catch (err) {
			lastError = err;
			if (attempt < DESKTOP_CONFIG_RETRY_COUNT)
				await sleep(DESKTOP_CONFIG_RETRY_DELAY_MS);
		}
	}
	console.warn(
		"Tauri desktop config unavailable, continuing with browser API defaults.",
		lastError,
	);
}

const rootElement = document.getElementById("root");
if (rootElement && !rootElement.innerHTML) {
	const root = createRoot(rootElement);
	// Keep route modules, locale dictionaries, and desktop-only UI outside the
	// initial entry while their code is fetched in parallel with the desktop
	// configuration handshake.
	const appModule = import("./App");

	root.render(
		<StrictMode>
			<StartupScreen />
		</StrictMode>,
	);

	loadDesktopConfig()
		.catch((err) => {
			console.warn("App bootstrap warning, continuing with defaults.", err);
		})
		.then(async () => {
			try {
				const { default: App } = await appModule;
				root.render(
					<StrictMode>
						<App />
					</StrictMode>,
				);
			} catch (err) {
				console.error("App module failed to load.", err);
				root.render(
					<StrictMode>
						<StartupFailureScreen />
					</StrictMode>,
				);
			}
		});
}

function StartupScreen() {
	return (
		<div
			className="flex min-h-screen items-center justify-center bg-[#141416] text-sm text-slate-300"
			role="status"
		>
			起動しています…
		</div>
	);
}

function StartupFailureScreen() {
	return (
		<div
			className="flex min-h-screen items-center justify-center bg-[#141416] px-6 text-center text-sm text-rose-300"
			role="alert"
		>
			アプリケーションを読み込めませんでした。再読み込みしてください。
		</div>
	);
}
