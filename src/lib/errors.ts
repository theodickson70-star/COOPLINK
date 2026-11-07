export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Tafadhali ingia kwanza') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Huna ruhusa ya kufanya hivi') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Rekodi') => new AppError(404, 'NOT_FOUND', `${what} haijapatikana`);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'CONFLICT', msg, details);
