/**
 * TEMPORARY SAFETY GUARD (remove later)
 * -------------------------------------
 * This project's internal NightWorkers agent does NOT support external MCP tool namespaces
 * like `mcp__*` or `functions.*`.
 *
 * Why this exists:
 * - When external system context leaks into the internal agent output,
 *   the model may emit unsupported tool names (e.g. mcp__context_still.initial_instructions).
 * - That causes schema failures / execution loops.
 *
 * Removal plan:
 * - Remove this file and related call sites once NightWorkers supports those external namespaces,
 *   or when prompt/system-context isolation is fully guaranteed.
 */
export function isTemporarilyBlockedExternalToolName(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower.startsWith('mcp__') || lower.startsWith('functions.') || lower.includes('.');
}
