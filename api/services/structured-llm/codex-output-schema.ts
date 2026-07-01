const CODEX_PROMPT_VALIDATED_SCHEMA_NAMES = new Set([
  'app_blueprint',
  'app_blueprint_data_design',
  'mock_blueprint',
]);

export function shouldOmitCodexOutputSchema(schemaName: string | null | undefined): boolean {
  return Boolean(schemaName && CODEX_PROMPT_VALIDATED_SCHEMA_NAMES.has(schemaName));
}
