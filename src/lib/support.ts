// =====================================================================
//  TIKETI ZA MSAADA — sheria za pamoja (chama na timu ya DUKALANGU)
//  Muda wa jibu la kwanza (Mkataba Kifungu 9.4): Dharura saa 2, Kubwa saa 8, Kawaida siku 2 za kazi (saa 48).
// =====================================================================
import { z } from 'zod';
import { inArray } from 'drizzle-orm';
import { schema, type DbOrTx } from '../db';
import { badRequest } from './errors';

export const SLA_HOURS = { URGENT: 2, HIGH: 8, NORMAL: 48 } as const;
export type Priority = keyof typeof SLA_HOURS;
export const dueFrom = (from: Date, p: Priority) => new Date(from.getTime() + SLA_HOURS[p] * 3_600_000);

export const CATEGORY_LABEL = { PAYMENT: 'Malipo / Ada', BUG: 'Hitilafu ya mfumo', TRAINING: 'Mafunzo / Swali', FEATURE: 'Ombi la kipengele kipya', OTHER: 'Nyingine' } as const;

const MAX_BYTES = 700 * 1024;  // picha moja (baada ya kupunguzwa kwenye kivinjari)
const MAX_FILES = 3;
const MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const attachmentsSchema = z.array(z.object({
  mimeType: z.enum(MIME, { message: 'Picha iwe JPEG, PNG au WEBP' }),
  data: z.string().min(10).max(Math.ceil(MAX_BYTES * 1.37) + 16).regex(/^[A-Za-z0-9+/=]+$/, 'Picha si sahihi'),
})).max(MAX_FILES, `Picha zisizidi ${MAX_FILES} kwa ujumbe mmoja`).default([]);

export const bodySchema = z.string().trim().min(2, 'Andika ujumbe').max(5000, 'Ujumbe ni mrefu mno (mwisho herufi 5,000)');

/** Huhifadhi picha za ujumbe mmoja; kila picha inahakikiwa ukubwa wake halisi. */
export async function saveAttachments(tx: DbOrTx, ticketId: string, messageId: string, files: z.infer<typeof attachmentsSchema>) {
  if (!files.length) return;
  const rows = files.map((f) => {
    const size = Buffer.from(f.data, 'base64').length;
    if (size > MAX_BYTES) throw badRequest(`Picha ni kubwa mno (mwisho ${Math.round(MAX_BYTES / 1024)}KB)`);
    return { ticketId, messageId, mimeType: f.mimeType, data: f.data, sizeBytes: size };
  });
  await tx.insert(schema.supportAttachments).values(rows);
}

/** Orodha ya picha (bila data) kwa kila ujumbe. */
export async function attachmentsOf(tx: DbOrTx, messageIds: string[]) {
  if (!messageIds.length) return new Map<string, { id: string; mimeType: string; sizeBytes: number }[]>();
  const A = schema.supportAttachments;
  const rows = await tx.select({ id: A.id, messageId: A.messageId, mimeType: A.mimeType, sizeBytes: A.sizeBytes }).from(A).where(inArray(A.messageId, messageIds));
  const m = new Map<string, { id: string; mimeType: string; sizeBytes: number }[]>();
  for (const r of rows) m.set(r.messageId, [...(m.get(r.messageId) ?? []), { id: r.id, mimeType: r.mimeType, sizeBytes: r.sizeBytes }]);
  return m;
}

export const ticketNo = (n: number | null) => `TK-${String(n ?? 0).padStart(5, '0')}`;
