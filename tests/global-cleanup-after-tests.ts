export default async function setupNightWorkersTestCleanup() {
	const {
		applyVitestDatabaseEnv,
		assertVitestDatabaseIsolation,
		assertVitestWorkspaceIsolation,
	} = await import("./vitest-db-env");
	applyVitestDatabaseEnv();
	assertVitestDatabaseIsolation(process.env.DATABASE_URL);
	assertVitestWorkspaceIsolation();

	const { ensureNightWorkersSchema } = await import("../api/db/bootstrap");
	await ensureNightWorkersSchema();

	return async () => {
		if (process.env.NIGHTWORKERS_SKIP_TEST_DB_CLEANUP === "1") return;
		applyVitestDatabaseEnv();
		assertVitestDatabaseIsolation(process.env.DATABASE_URL);
		assertVitestWorkspaceIsolation();

		const { cleanupNightWorkersTestData } = await import(
			"../api/scripts/cleanup-test-data"
		);
		const { plan, deleted } = await cleanupNightWorkersTestData({
			mode: "execute",
			all: true,
		});

		if (deleted > 0) {
			console.log(
				`[nightworkers:test-cleanup] Deleted ${deleted} isolated repositories ` +
					`(${plan.counts.tasks} tasks, ${plan.counts.taskRuns} runs).`,
			);
		}
	};
}
