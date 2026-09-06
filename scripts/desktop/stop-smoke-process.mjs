// Await exit after escalation, with a deadline even if process termination fails.
export function stopSmokeProcess(
	child,
	{ graceMs = 5_000, killMs = 5_000 } = {},
) {
	if (child.exitCode !== null || child.signalCode !== null || !child.pid)
		return Promise.resolve();
	return new Promise((resolve, reject) => {
		let forceTimer;
		let deadline;
		const cleanup = () => {
			clearTimeout(forceTimer);
			clearTimeout(deadline);
			child.off("exit", onExit);
			child.off("error", onError);
		};
		const onExit = () => {
			cleanup();
			resolve();
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		child.once("exit", onExit);
		child.once("error", onError);
		forceTimer = setTimeout(() => child.kill("SIGKILL"), graceMs);
		deadline = setTimeout(() => {
			cleanup();
			reject(new Error(`Sidecar did not exit after SIGKILL: pid=${child.pid}`));
		}, graceMs + killMs);
		child.kill("SIGTERM");
	});
}
