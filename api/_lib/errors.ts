export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly safeMessage: string;

  constructor(
    status: number,
    code: string,
    safeMessage: string,
  ) {
    super(safeMessage);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}