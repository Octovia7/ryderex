export interface AppErrorOptions {
  statusCode: number;
  code: string;
  message: string;
  cause?: unknown;
}

/**
 * Canonical application error. `cause` carries diagnostic detail for logs
 * only — it must never be serialized into an HTTP response.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.statusCode = options.statusCode;
    this.code = options.code;

    Object.setPrototypeOf(this, AppError.prototype);
  }
}
