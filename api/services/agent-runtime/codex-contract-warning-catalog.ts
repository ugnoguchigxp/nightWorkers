export const CODEX_CONTRACT_WARNING_CATALOG = {
  codex_import_project_cancelled: {
    defaultSeverity: 'error',
    terminalPolicy: 'cancelled',
    description: 'nightworkers.import_project was cancelled; fallback implementation is forbidden.',
  },
  codex_import_project_failed: {
    defaultSeverity: 'error',
    terminalPolicy: 'failed',
    description: 'nightworkers.import_project returned a failure result.',
  },
  codex_unexpected_nightworkers_mcp_tool: {
    defaultSeverity: 'warning',
    terminalPolicy: 'none',
    description: 'A NightWorkers MCP tool outside the manifest source of truth was observed.',
  },
  codex_mcp_degraded: {
    defaultSeverity: 'warning',
    terminalPolicy: 'none',
    description: 'A NightWorkers MCP tool did not complete successfully.',
  },
  codex_global_mcp_tool_observed: {
    defaultSeverity: 'warning',
    terminalPolicy: 'none',
    description: 'A non-NightWorkers MCP tool was observed in the Codex runtime lane.',
  },
  codex_native_command_execution: {
    defaultSeverity: 'warning',
    terminalPolicy: 'none',
    description: 'A Codex native command_execution event was observed.',
  },
  codex_high_risk_native_import_command: {
    defaultSeverity: 'error',
    terminalPolicy: 'needs_human_when_no_import_project_success',
    description: 'A native command looked like a high-risk project import alternative.',
  },
  codex_import_project_alternative_command: {
    defaultSeverity: 'warning',
    terminalPolicy: 'none',
    description: 'A native command looked like an import_project alternative.',
  },
  codex_file_change_without_current_todo: {
    defaultSeverity: 'warning',
    terminalPolicy: 'none',
    description: 'Codex changed files while no current running Todo evidence was found.',
  },
  codex_todo_evidence_db_read_failed: {
    defaultSeverity: 'warning',
    terminalPolicy: 'none',
    description: 'Todo evidence DB read failed and runtime context fallback was used if available.',
  },
  codex_file_change_before_todo_replace: {
    defaultSeverity: 'warning',
    terminalPolicy: 'none',
    description: 'Codex changed files before nightworkers.todo_list operation=replace.',
  },
  codex_file_change_while_mcp_degraded: {
    defaultSeverity: 'warning',
    terminalPolicy: 'none',
    description: 'Codex changed files after NightWorkers MCP degradation was observed.',
  },
  codex_import_project_recommended_verification_mismatch: {
    defaultSeverity: 'warning',
    terminalPolicy: 'none',
    description:
      'A successful post-import verification command did not match recommendedVerificationCommands.',
  },
  codex_import_project_verification_missing: {
    defaultSeverity: 'warning',
    terminalPolicy: 'none',
    description:
      'nightworkers.import_project recommended verification commands existed, but no successful post-import verification was observed.',
  },
  codex_native_import_without_import_project: {
    defaultSeverity: 'error',
    terminalPolicy: 'needs_human',
    description:
      'A native project import command completed without nightworkers.import_project success.',
  },
} as const satisfies Record<
  string,
  {
    defaultSeverity: 'info' | 'warning' | 'error';
    terminalPolicy: string;
    description: string;
  }
>;

export type CodexContractWarningCode = keyof typeof CODEX_CONTRACT_WARNING_CATALOG;
