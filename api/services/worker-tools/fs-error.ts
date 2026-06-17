import { getDeepRecordString, unknownErrorMessage } from '../../../shared/json-record';

export type WorkerToolError = {
  code: string;
  message: string;
};

export function isNodeFileNotFoundError(error: unknown): boolean {
  return getDeepRecordString(error, 'code') === 'ENOENT';
}

export function formatFileSystemToolError(input: {
  error: unknown;
  notFoundCode: string;
  notFoundMessage: string;
  fallbackCode: string;
  fallbackMessagePrefix: string;
}): WorkerToolError {
  if (isNodeFileNotFoundError(input.error)) {
    return {
      code: input.notFoundCode,
      message: input.notFoundMessage,
    };
  }

  return {
    code: input.fallbackCode,
    message: `${input.fallbackMessagePrefix}: ${unknownErrorMessage(input.error)}`,
  };
}
