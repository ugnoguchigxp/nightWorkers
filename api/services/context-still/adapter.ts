import { extractIncludedMemoryRefs } from '../memory-feedback/injection-matcher';
import type { IncludedMemoryRef, LearningCandidate } from '../memory-feedback/types';
import { contextStillClient } from './client';

export interface CompileContextRequest {
  repositoryPath: string;
  taskTitle: string;
  taskDescription: string;
  taskId: string;
  runId: string;
  goal?: string;
  domains?: string[];
  technologies?: string[];
}

export interface CompileContextResponse {
  compiledPromptText: string;
  degraded: boolean;
  degradedReason?: string;
  sourceMetadata?: unknown;
  includedMemoryRefs: IncludedMemoryRef[];
}

export interface RegisterCandidateResponse {
  status: 'registered' | 'degraded' | 'failed';
  externalId?: string;
  errorCode?: string;
  errorMessage?: string;
}

function fallbackPrompt(request: CompileContextRequest) {
  return `[Bypassed context compile] Task: ${request.taskTitle}\nDescription: ${request.taskDescription}`;
}

export async function compileContext(
  request: CompileContextRequest
): Promise<CompileContextResponse> {
  if (!contextStillClient.isEnabled()) {
    return {
      compiledPromptText: fallbackPrompt(request),
      degraded: true,
      degradedReason: 'context_still_disabled',
      includedMemoryRefs: [],
    };
  }

  try {
    const result = (await contextStillClient.callTool('context_compile', {
      repository_path: request.repositoryPath,
      task_title: request.taskTitle,
      task_description: request.taskDescription,
      task_id: request.taskId,
      run_id: request.runId,
      goal: request.goal,
      domains: request.domains,
      technologies: request.technologies,
    })) as {
      content?: Array<{ text?: string }>;
      metadata?: unknown;
      structuredContent?: unknown;
    };

    const compiledPromptText = result?.content?.[0]?.text;
    if (compiledPromptText) {
      const sourceMetadata = result.metadata || result.structuredContent || null;
      return {
        compiledPromptText,
        sourceMetadata,
        degraded: false,
        includedMemoryRefs: extractIncludedMemoryRefs(sourceMetadata),
      };
    }

    return {
      compiledPromptText: fallbackPrompt(request),
      degraded: true,
      degradedReason: 'context_compile_empty_result',
      sourceMetadata: result?.metadata || result?.structuredContent || null,
      includedMemoryRefs: [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`compileContext failed. Falling back to default description. Reason: ${message}`);
    return {
      compiledPromptText: fallbackPrompt(request),
      degraded: true,
      degradedReason: message,
      includedMemoryRefs: [],
    };
  }
}

export async function evaluateContext(
  runId: string,
  resultSummary: string,
  wasSuccessful: boolean
): Promise<boolean> {
  if (!contextStillClient.isEnabled()) return false;

  try {
    await contextStillClient.callTool('compile_eval', {
      run_id: runId,
      result_summary: resultSummary,
      was_successful: wasSuccessful,
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`evaluateContext failed. Reason: ${message}`);
    return false;
  }
}

export async function registerCandidate(
  candidate: LearningCandidate
): Promise<RegisterCandidateResponse> {
  if (!contextStillClient.isEnabled()) {
    return {
      status: 'degraded',
      errorCode: 'context_still_disabled',
      errorMessage: 'contextStill integration is disabled.',
    };
  }

  try {
    const result = (await contextStillClient.callTool('register_candidate', {
      type: candidate.kind === 'procedure' ? 'procedure' : 'rule',
      title: candidate.title,
      body: candidate.body,
      confidence:
        candidate.confidence === 'high' ? 0.9 : candidate.confidence === 'medium' ? 0.65 : 0.35,
      repoPath: candidate.appliesTo.repoPath,
      technologies: candidate.appliesTo.technologies,
      changeTypes: candidate.appliesTo.changeTypes,
      domains: candidate.appliesTo.domains,
      metadata: {
        source: 'nightworkers',
        candidateId: candidate.id,
        sourceRunId: candidate.sourceRunId,
        sourceTaskId: candidate.sourceTaskId,
        sourceEventIds: candidate.sourceEventIds,
      },
    })) as { id?: string; candidateId?: string; memoryId?: string };
    return {
      status: 'registered',
      externalId: result?.id || result?.candidateId || result?.memoryId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`registerCandidate failed. Reason: ${message}`);
    return {
      status: 'failed',
      errorCode: 'context_still_register_failed',
      errorMessage: message,
    };
  }
}

export async function registerLessons(
  topic: string,
  content: string,
  sourceRunId: string
): Promise<boolean> {
  const result = await registerCandidate({
    id: sourceRunId,
    version: 1,
    sourceRunId,
    sourceTaskId: sourceRunId,
    sourceEventIds: [sourceRunId],
    kind: 'procedure',
    title: topic,
    body: content,
    appliesTo: {},
    confidence: 'medium',
    status: 'approved',
    createdAt: new Date().toISOString(),
  });
  return result.status === 'registered';
}
