import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const devReloadDirs = [
	path.resolve(__dirname, "./api"),
	path.resolve(__dirname, "./src"),
];
const desktopDev = process.env.NIGHTWORKERS_DESKTOP_DEV === "1";
const webPort = Number(process.env.NIGHTWORKERS_WEB_PORT || 39174);
const defaultApiPort = 39173;

function resolveApiPort() {
	for (const value of [process.env.NIGHTWORKERS_API_PORT, process.env.PORT]) {
		const port = Number(value);
		if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
	}
	return defaultApiPort;
}

const apiPort = resolveApiPort();

function isApiOrSrcPath(file: string) {
	const resolved = path.resolve(file);
	return devReloadDirs.some(
		(dir) =>
			resolved === dir ||
			resolved.startsWith(`${dir}${path.sep}`) ||
			dir.startsWith(`${resolved}${path.sep}`),
	);
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		TanStackRouterVite({
			routesDirectory: "./src/routes",
			generatedRouteTree: "./src/routeTree.gen.ts",
			autoCodeSplitting: true,
		}),
		react(),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
			"@api": path.resolve(__dirname, "./api"),
			"@nightworkers/mission-pilot/contracts": path.resolve(
				__dirname,
				"./packages/mission-pilot/src/contracts/index.ts",
			),
			"@nightworkers/mission-pilot/frontend": path.resolve(
				__dirname,
				"./packages/mission-pilot/src/frontend/index.ts",
			),
			"@nightworkers/mission-pilot/i18n": path.resolve(
				__dirname,
				"./packages/mission-pilot/src/frontend/i18n/index.ts",
			),
			"@nightworkers/mission-pilot/frontend.css": path.resolve(
				__dirname,
				"./packages/mission-pilot/src/frontend/styles.css",
			),
		},
	},
	server: {
		port: webPort,
		strictPort: true,
		hmr: false,
		watch: {
			ignored: desktopDev ? ["**/*"] : (file) => !isApiOrSrcPath(file),
		},
		proxy: {
			"/api": {
				target: `http://localhost:${apiPort}`,
				changeOrigin: true,
				ws: true,
			},
		},
	},
	build: {
		// Mermaid's parser is distributed as one ~647 KiB minified module.
		// Keep the warning above that immutable vendor chunk while the explicit
		// post-build budget check guards against application chunk regressions.
		chunkSizeWarningLimit: 700,
	},
});
