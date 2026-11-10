import type { AuthContext } from '../middleware/auth';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /** Ada ya CoopLink: nani analipa chama hiki (Mhasibu / Meneja) */
      feePayer?: { role: 'ACCOUNTANT' | 'AMCOS_ADMIN'; isPayer: boolean };
      /** Portal ya mkulima: mkulima aliyeingia (si mtumishi) */
      farmer?: import('../db').Member;
    }
  }
}

export {};
