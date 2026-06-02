import { AppError } from '../../lib/errors';
import { NativeAgentRuntime } from './NativeAgentRuntime';
import type { AgentRuntime, AgentRuntimeKind } from './types';

const nativeRuntime = new NativeAgentRuntime();

export function resolveAgentRuntime(kind: AgentRuntimeKind): AgentRuntime {
  if (kind === 'native-local') {
    return nativeRuntime;
  }
  throw new AppError(501, 'RUNTIME_KIND_NOT_SUPPORTED', `Unsupported runtime kind: ${kind}`);
}
