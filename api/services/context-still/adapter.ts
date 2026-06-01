import { contextStillClient } from './client';

export interface CompileContextResult {
  compiledPromptText: string;
  sourceMetadata?: unknown;
  degraded: boolean;
}

export async function compileContext(
  repositoryPath: string,
  taskTitle: string,
  taskDescription: string
): Promise<CompileContextResult> {
  if (!contextStillClient.isEnabled()) {
    return {
      compiledPromptText: `[Bypassed context compile] Task: ${taskTitle}\nDescription: ${taskDescription}`,
      degraded: true,
    };
  }

  try {
    const result = (await contextStillClient.callTool('context_compile', {
      repository_path: repositoryPath,
      task_title: taskTitle,
      task_description: taskDescription,
    })) as {
      content?: Array<{ text?: string }>;
      metadata?: unknown;
    };

    if (result?.content?.[0]?.text) {
      return {
        compiledPromptText: result.content[0].text,
        sourceMetadata: result.metadata || null,
        degraded: false,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`compileContext failed. Falling back to default description. Reason: ${message}`);
  }

  // Degraded fallback
  return {
    compiledPromptText: `[Bypassed context compile] Task: ${taskTitle}\nDescription: ${taskDescription}`,
    degraded: true,
  };
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

export async function registerLessons(
  topic: string,
  content: string,
  sourceRunId: string
): Promise<boolean> {
  if (!contextStillClient.isEnabled()) return false;

  try {
    await contextStillClient.callTool('register_candidate', {
      topic,
      content,
      source_run_id: sourceRunId,
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`registerLessons failed. Reason: ${message}`);
    return false;
  }
}
