import type { AuthContext } from '../middleware/auth';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /** Ada ya CoopLink: nani analipa chama hiki (Mhasibu / Meneja) */
      feePayer?: { role: 'ACCOUNTANT' | 'AMCOS_ADMIN'; isPayer: boolean };
    }
  }
}

export {};
