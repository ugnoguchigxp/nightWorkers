import { logger } from '../../../lib/logger';
import type {
  CallSupervisorOptions,
  NormalizedSupervisorLlmRequest,
  ProviderCapabilityPolicy,
  SupervisorLlmDebugEvent,
} from './types';

export class ProviderActivityRejectedError extends Error {
  readonly providerId: string;
  readonly providerClass: string;
  readonly activityType: string;
  readonly toolName: string | null;
  readonly preview: string;
  readonly policy: ProviderCapabilityPolicy;

  constructor(input: {
    request: NormalizedSupervisorLlmRequest;
    activityType: string;
    toolName?: string | null;
    preview?: string;
  }) {
    super(`Provider activity rejected: ${input.activityType}`);
    this.name = 'ProviderActivityRejectedError';
    this.providerId = input.request.providerId;
    this.providerClass = input.request.providerClass;
    this.activityType = input.activityType;
    this.toolName = input.toolName ?? null;
    this.preview = input.preview ?? '';
    this.policy = input.request.capabilityPolicy;
  }
}

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

export async function rejectProviderActivity(input: {
  options: CallSupervisorOptions;
  request: NormalizedSupervisorLlmRequest;
  activityType: string;
  toolName?: string | null;
  preview?: string;
}): Promise<never> {
  await emitSupervisorLlmDebugEvent(input.options, {
    type:
      input.activityType === 'tool_call' || input.activityType === 'tool_use'
        ? 'model.provider_tool_call_detected'
        : 'model.provider_activity_detected',
    severity: 'warning',
    message: `Provider response included unsupported activity. type=${input.activityType}`,
    data: providerActivityEventData(input),
  });
  await emitSupervisorLlmDebugEvent(input.options, {
    type: 'model.provider_activity_rejected',
    severity: 'error',
    message: `Provider activity rejected by capability policy. type=${input.activityType}`,
    data: providerActivityEventData(input),
  });
  throw new ProviderActivityRejectedError(input);
}

function providerActivityEventData(input: {
  request: NormalizedSupervisorLlmRequest;
  activityType: string;
  toolName?: string | null;
  preview?: string;
}) {
  return {
    providerId: input.request.providerId,
    providerClass: input.request.providerClass,
    activityType: input.activityType,
    toolName: input.toolName ?? null,
    preview: redactedPreview(input.preview),
    capabilityPolicy: input.request.capabilityPolicy,
    diagnostics: input.request.diagnostics,
  };
}

function redactedPreview(value?: string) {
  if (!value) return '';
  return value.replace(/[A-Za-z0-9_=-]{24,}/g, '[redacted]').slice(0, 500);
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
