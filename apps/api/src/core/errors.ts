/** Erro de domínio com status HTTP e código estável para a interface. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} não encontrado(a)`);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);
/** Operação bloqueada por configuração obrigatória ausente. */
export const precondition = (code: string, message: string, details?: unknown) => new AppError(412, code, message, details);
