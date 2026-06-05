export function readSchemaFirstFixtureOutput(round?: 1 | 2): string {
  const roundSpecificKey =
    round === 1 ? 'SUPERVISOR_FIXTURE_ROUND1_OUTPUT' : 'SUPERVISOR_FIXTURE_ROUND2_OUTPUT';
  const output = process.env[roundSpecificKey] || process.env.SUPERVISOR_FIXTURE_OUTPUT;
  if (!output?.trim()) {
    throw new Error(
      `Fixture provider requires ${roundSpecificKey} or SUPERVISOR_FIXTURE_OUTPUT to be set.`
    );
  }
  return output;
}
