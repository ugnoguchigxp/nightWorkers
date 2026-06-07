import { AppError } from '../../lib/errors';
import { CodexAgentRuntime } from './CodexAgentRuntime';
import { NativeAgentRuntime } from './NativeAgentRuntime';
import type { AgentRuntime, AgentRuntimeKind } from './types';

const nativeRuntime = new NativeAgentRuntime();
const codexRuntime = new CodexAgentRuntime();

export function resolveAgentRuntime(kind: AgentRuntimeKind): AgentRuntime {
  if (kind === 'native-local') {
    return nativeRuntime;
  }
  if (kind === 'codex-agent') {
    return codexRuntime;
  }
  throw new AppError(501, 'RUNTIME_KIND_NOT_SUPPORTED', `Unsupported runtime kind: ${kind}`);
}
