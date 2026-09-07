import type { ApplicationErrorCode } from "@lumen/api-contract";

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly retryable: boolean;
  readonly operationId: string | undefined;
  readonly statusCode: number;

  constructor(options: {
    code: ApplicationErrorCode;
    message: string;
    retryable?: boolean;
    operationId?: string;
    statusCode: number;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "ApplicationError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.operationId = options.operationId;
    this.statusCode = options.statusCode;
  }
}
