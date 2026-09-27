/**
 * Errors meant for the member or staff member on the other side. `message` is Persian and shown
 * as-is; `code` is stable for clients that need to branch on it.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const unauthorized = (message = 'ابتدا وارد حساب خود شوید') =>
  new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'دسترسی به این بخش را ندارید') =>
  new AppError(403, 'forbidden', message);
export const notFound = (message = 'پیدا نشد') => new AppError(404, 'not_found', message);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
