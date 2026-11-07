import type { AuthContext } from '../middleware/auth';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
