import type { ServiceErrorCode } from './types.ts';

/** Expected validation, conflict, not-found, or resource-limit failure at a service boundary. */
export class ServiceError extends Error {
  public constructor(
    public readonly code: ServiceErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

/** Converts an unknown exception into a safe API error without leaking host paths or source. */
export function asServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) {
    return error;
  }
  return new ServiceError(
    'INTERNAL_ERROR',
    'The local service encountered an internal error.',
    500,
    true,
  );
}
