// IDHINI — Meneja anaona na kuamua maombi yote ya chama; wengine wanaona maombi yao wenyewe
import { Router } from 'express';
import { z } from 'zod';
import { aliasedTable, and, count, desc, eq, type SQL } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, decimalSchema, paged, paginationQuery, uuidParam } from '../lib/http';
import { notFound } from '../lib/errors';
import { requireAmcosPerm, requireReauth } from '../middleware/auth';
import { amcosScope } from '../middleware/tenant';
import { hasAmcosPerm } from '../lib/amcos-permissions';
import { APPROVAL_LABEL, cancelApproval, decideApproval } from '../lib/approvals';

export const approvalsRouter = Router();
const A = schema.approvalRequests;
const requester = aliasedTable(schema.users, 'requester');
const decider = aliasedTable(schema.users, 'decider');

function visible(req: Parameters<typeof amcosScope>[0]): SQL | undefined {
  // Asiye na mamlaka ya kuamua anaona maombi aliyoyaanzisha tu
  return hasAmcosPerm(req.auth!.role, 'approvals.decide') || !req.auth!.amcosId ? undefined : eq(A.requestedById, req.auth!.userId);
}

const cols = {
  approval: A,
  requestedBy: requester.fullName,
  decidedBy: decider.fullName,
};

approvalsRouter.get('/', requireAmcosPerm('approvals.read'), ah(async (req, res) => {
  const q = paginationQuery.extend({
    status: z.enum(schema.approvalStatusEnum.enumValues).optional(),
    type: z.enum(schema.approvalTypeEnum.enumValues).optional(),
  }).parse(req.query);
  const where = and(amcosScope(req, A.amcosId), visible(req), q.status ? eq(A.status, q.status) : undefined, q.type ? eq(A.type, q.type) : undefined);
  const [rows, [{ total }]] = await Promise.all([
    db.select(cols).from(A)
      .leftJoin(requester, eq(requester.id, A.requestedById))
      .leftJoin(decider, eq(decider.id, A.decidedById))
      .where(where).orderBy(desc(A.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(A).where(where),
  ]);
  res.json(paged(rows.map((r) => ({ ...r.approval, typeLabel: APPROVAL_LABEL[r.approval.type], requestedBy: r.requestedBy, decidedBy: r.decidedBy })), total, q.page, q.pageSize));
}));

approvalsRouter.get('/summary', requireAmcosPerm('approvals.read'), ah(async (req, res) => {
  const rows = await db.select({ type: A.type, n: count() }).from(A)
    .where(and(amcosScope(req, A.amcosId), visible(req), eq(A.status, 'PENDING'))).groupBy(A.type);
  res.json({ pending: Object.fromEntries(rows.map((r) => [r.type, r.n])), total: rows.reduce((s, r) => s + r.n, 0) });
}));

approvalsRouter.get('/:id', requireAmcosPerm('approvals.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const [row] = await db.select(cols).from(A)
    .leftJoin(requester, eq(requester.id, A.requestedById))
    .leftJoin(decider, eq(decider.id, A.decidedById))
    .where(and(eq(A.id, id), amcosScope(req, A.amcosId), visible(req)));
  if (!row) throw notFound('Ombi');
  res.json({ approval: { ...row.approval, typeLabel: APPROVAL_LABEL[row.approval.type], requestedBy: row.requestedBy, decidedBy: row.decidedBy } });
}));

const note = z.string().trim().min(3, 'Andika maelezo ya uamuzi (angalau herufi 3)').max(500);

approvalsRouter.post('/:id/decide', requireAmcosPerm('approvals.decide'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({
    decision: z.enum(['APPROVED', 'REJECTED']), note,
    changes: z.object({ quantity: decimalSchema({ min: 0.01 }).optional(), unitPrice: decimalSchema({ min: 0.01 }).optional() }).optional(),
  }).parse(req.body);
  // Kuidhinisha kunahitaji nenosiri la anayeidhinisha (na 2FA kama ameiwasha) — simu/kompyuta iliyoachwa wazi haitoshi kupitisha ombi
  if (body.decision === 'APPROVED') await requireReauth(req);
  const approval = await db.transaction((tx) => decideApproval(tx, req, id, body.decision, body.note, body.changes));
  res.json({ approval });
}));

approvalsRouter.post('/:id/cancel', requireAmcosPerm('approvals.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({ note }).parse(req.body);
  const approval = await db.transaction((tx) => cancelApproval(tx, req, id, body.note));
  res.json({ approval });
}));
