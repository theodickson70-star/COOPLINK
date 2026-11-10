// Jina la mwenye namba ya simu (Abliner Name Lookup) — kwa fomu zote zenye namba ya simu na jina
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ah } from '../lib/http';
import { lookupEnabled, resolvePhoneName, splitName } from '../lib/name-lookup';

export const lookupRouter = Router();

// Kuzuia matumizi mabaya (kila lookup ina gharama): maombi 40 kwa dakika kwa kila mtumiaji
const limiter = rateLimit({
  windowMs: 60_000, limit: 40, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? 'anon', // njia hii inahitaji kuingia
  message: { error: { code: 'TOO_MANY_LOOKUPS', message: 'Maombi mengi ya kutafuta majina. Subiri dakika moja.' } },
});

lookupRouter.get('/name', limiter, ah(async (req, res) => {
  const { phone } = z.object({ phone: z.string().trim().min(9).max(20) }).parse(req.query);
  const r = await resolvePhoneName(phone);
  const local = r.phone.startsWith('255') ? '0' + r.phone.slice(3) : r.phone;
  if (r.status === 'FOUND') return res.json({ enabled: true, status: r.status, phone: local, name: r.name, network: r.network, ...splitName(r.name) });
  res.json({ enabled: lookupEnabled() && r.status !== 'DISABLED', status: r.status, phone: local });
}));
