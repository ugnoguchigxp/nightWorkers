import { logger } from '../../../lib/logger';
import type { CallSupervisorOptions, SupervisorLlmDebugEvent } from './types';

export async function emitSupervisorLlmDebugEvent(
  options: CallSupervisorOptions,
  event: SupervisorLlmDebugEvent
) {
  if (!options.emitEvent) return;
  try {
    await options.emitEvent(event);
  } catch (err) {
    logger.warn(
      {
        eventType: event.type,
        errorMessage: err instanceof Error ? err.message : String(err),
      },
      'Supervisor LLM debug event emission failed'
    );
  }
}
