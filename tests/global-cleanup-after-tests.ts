export default function setupNightWorkersTestCleanup() {
  return async () => {
    if (process.env.NIGHTWORKERS_SKIP_TEST_DB_CLEANUP === '1') return;

    const { cleanupNightWorkersTestData } = await import('../api/scripts/cleanup-test-data');
    const { plan, deleted } = await cleanupNightWorkersTestData({ mode: 'execute' });

    if (deleted > 0) {
      console.log(
        `[nightworkers:test-cleanup] Deleted ${deleted} TEST repositories ` +
          `(${plan.counts.tasks} tasks, ${plan.counts.taskRuns} runs).`
      );
    }
  };
}
