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

export function createSupervisorResponseDeltaEmitter(input: {
  options: CallSupervisorOptions;
  provider: string;
  round?: 1 | 2;
}) {
  let pendingText = '';

  const flush = async () => {
    if (!pendingText) return;
    const text = pendingText;
    pendingText = '';
    await emitSupervisorLlmDebugEvent(input.options, {
      type: 'model.response_delta',
      severity: 'debug',
      message: 'Supervisor LLM response delta received.',
      data: {
        provider: input.provider,
        round: input.round ?? null,
        text,
      },
    });
  };

  return {
    async push(text: string) {
      if (!text) return;
      pendingText += text;
      if (pendingText.length >= 24 || pendingText.includes('\n')) {
        await flush();
      }
    },
    flush,
  };
}
