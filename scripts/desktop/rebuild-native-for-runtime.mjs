import { spawnSync } from "node:child_process";

const runtimePath = process.env.NIGHTWORKERS_NODE_RUNTIME_PATH;
const version = process.env.NIGHTWORKERS_NODE_RUNTIME_VERSION;
if (!runtimePath || !version) {
	console.log("[desktop] no pinned runtime configured; keeping local native modules");
	process.exit(0);
}
const result = spawnSync("npm", [
	"rebuild",
		"better-sqlite3",
		"--build-from-source",
		"--runtime=node",
		`--target=${version}`,
	], { stdio: "inherit", shell: process.platform === "win32" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`[desktop] rebuilt better-sqlite3 for Node ${version}`);
